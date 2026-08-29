/* =====================================================================
 * OFD 版式预览插件 for Directory Opus
 * ---------------------------------------------------------------------
 * 基于 GP Software Viewer Plugin SDK（接口版本 4，DOpus 9 ~ 13 通用）。
 *
 * 工作原理：
 *   1. DVP_Identify*   告诉 DOpus 本插件处理 .ofd 扩展名；
 *   2. DVP_IdentifyFile* 校验 ZIP 魔数与 OFD.xml 特征，决定是否接管；
 *   3. DVP_CreateViewer 创建子窗口，在其中宿主一个 WebView2 控件；
 *   4. 收到 DVPLUGINMSG_LOAD 后读取整个 .ofd 文件，Base64 编码，
 *      通过 PostWebMessageAsString 发给内嵌的 ofd_viewer.html
 *      （纯 JavaScript 的 OFD 解包 / SVG 渲染引擎，与本工具网页版同源）；
 *   5. 缩放 / 清除 / 尺寸变化等 DVP 消息同步转发给页面。
 *
 * 编译：见项目根目录 build.bat（x64，静态链接 WebView2Loader 与 CRT）。
 * ===================================================================== */

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <windows.h>
#include <shlwapi.h>
#include <wrl.h>
#include <WebView2.h>

#include <string>
#include <vector>

#include "dopus/viewer_plugins.h"

#pragma comment(lib, "shlwapi.lib")

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

/* ----------------------------- 常量 -------------------------------- */

static const WCHAR *const WINDOW_CLASS  = L"DOpusOFDViewerWnd";
static const WCHAR *const VIRTUAL_HOST  = L"ofd.local";
static const WCHAR *const PAGE_URL      = L"https://ofd.local/ofd_viewer.html";

// 插件唯一标识（固定 GUID，勿改动）
static const GUID PLUGIN_GUID =
    { 0x6F666456, 0x5072, 0x6576, { 0x69, 0x65, 0x77, 0x32, 0x30, 0x32, 0x36, 0x31 } };

static HINSTANCE g_hInst = NULL;

/* --------------------------- 小工具 -------------------------------- */

static std::wstring ToWide(const std::string &s)
{
    if (s.empty()) return std::wstring();
    int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), NULL, 0);
    std::wstring w((size_t)n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), (int)s.size(), &w[0], n);
    return w;
}

static std::string ToUtf8(const std::wstring &w)
{
    if (w.empty()) return std::string();
    int n = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), NULL, 0, NULL, NULL);
    std::string s((size_t)n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.c_str(), (int)w.size(), &s[0], n, NULL, NULL);
    return s;
}

static std::string JsonEscape(const std::string &s)
{
    std::string out;
    out.reserve(s.size() + 8);
    for (unsigned char c : s) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b";  break;
            case '\f': out += "\\f";  break;
            case '\n': out += "\\n";  break;
            case '\r': out += "\\r";  break;
            case '\t': out += "\\t";  break;
            default:
                if (c < 0x20) {
                    char buf[8];
                    wsprintfA(buf, "\\u%04x", c);
                    out += buf;
                } else {
                    out += (char)c;
                }
        }
    }
    return out;
}

static const char *const B64 =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static std::string Base64Encode(const BYTE *data, size_t len)
{
    std::string out;
    out.reserve(((len + 2) / 3) * 4);
    for (size_t i = 0; i < len; i += 3) {
        UINT v = (UINT)data[i] << 16;
        if (i + 1 < len) v |= (UINT)data[i + 1] << 8;
        if (i + 2 < len) v |= (UINT)data[i + 2];
        out += B64[(v >> 18) & 63];
        out += B64[(v >> 12) & 63];
        out += (i + 1 < len) ? B64[(v >> 6) & 63] : '=';
        out += (i + 2 < len) ? B64[v & 63] : '=';
    }
    return out;
}

// 插件 DLL 所在目录（带尾部反斜杠）
static std::wstring PluginDir()
{
    WCHAR path[MAX_PATH] = { 0 };
    GetModuleFileNameW(g_hInst, path, MAX_PATH);
    PathRemoveFileSpecW(path);
    std::wstring dir = path;
    if (!dir.empty() && dir[dir.size() - 1] != L'\\') dir += L'\\';
    return dir;
}

static std::wstring TempUserDataDir()
{
    WCHAR tmp[MAX_PATH] = { 0 };
    GetTempPathW(MAX_PATH, tmp);
    return std::wstring(tmp) + L"DOpusOFDViewer";
}

/* ------------------------- 查看器状态 ------------------------------- */

struct ViewerState
{
    HWND                                     hwndHost  = NULL;
    ComPtr<ICoreWebView2Controller>          controller;
    ComPtr<ICoreWebView2>                    webview;
    bool                                     ready     = false;
    bool                                     failed    = false;
    std::vector<std::string>                 pending;   // UTF-8 JSON 消息队列

    void Post(const std::string &utf8Json)
    {
        if (ready && webview) {
            std::wstring w = ToWide(utf8Json);
            webview->PostWebMessageAsString(w.c_str());
        } else if (!failed) {
            pending.push_back(utf8Json);
        }
    }
};

static ViewerState *GetState(HWND hwnd)
{
    return reinterpret_cast<ViewerState *>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
}

static void ShowErrorText(ViewerState *st, const char *msg)
{
    if (!st || !st->hwndHost) return;
    RECT rc;
    GetClientRect(st->hwndHost, &rc);
    HWND hErr = CreateWindowExA(
        0, "STATIC", msg,
        WS_CHILD | WS_VISIBLE | SS_CENTER | SS_CENTERIMAGE | SS_PATHELLIPSIS,
        16, 16, (rc.right - rc.left) > 32 ? rc.right - rc.left - 32 : 200, 90,
        st->hwndHost, NULL, g_hInst, NULL);
    if (hErr) {
        SendMessageA(hErr, WM_SETFONT,
                     (WPARAM)GetStockObject(DEFAULT_GUI_FONT), TRUE);
    }
}

/* ----------------------- WebView2 初始化 ---------------------------- */

static void InitWebView(ViewerState *st)
{
    HRESULT hrCo = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    (void)hrCo; // DOpus 线程通常已初始化 COM，忽略 RPC_E_CHANGED_MODE

    std::wstring userDir = TempUserDataDir();

    HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
        NULL, userDir.c_str(), NULL,
        Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [st](HRESULT result, ICoreWebView2Environment *env) -> HRESULT
            {
                if (FAILED(result) || !env) {
                    st->failed = true;
                    ShowErrorText(st,
                        "WebView2 \xE8\xBF\x90\xE8\xA1\x8C\xE6\x97\xB6\xE5\x88\x9D\xE5\xA7\x8B\xE5\x8C\x96\xE5\xA4\xB1\xE8\xB4\xA5\xE3\x80\x82\n"
                        "\xE8\xAF\xB7\xE5\xAE\x89\xE8\xA3\x85 Microsoft Edge WebView2 Evergreen \xE8\xBF\x90\xE8\xA1\x8C\xE6\x97\xB6\xE5\x90\x8E\xE9\x87\x8D\xE8\xAF\x95\xE3\x80\x82");
                    return result;
                }
                return env->CreateCoreWebView2Controller(
                    st->hwndHost,
                    Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                        [st](HRESULT result, ICoreWebView2Controller *ctrl) -> HRESULT
                        {
                            if (FAILED(result) || !ctrl) {
                                st->failed = true;
                                ShowErrorText(st,
                                    "WebView2 \xE6\x8E\xA7\xE4\xBB\xB6\xE5\x88\x9B\xE5\xBB\xBA\xE5\xA4\xB1\xE8\xB4\xA5\xE3\x80\x82");
                                return result;
                            }
                            st->controller = ctrl;
                            ctrl->get_CoreWebView2(&st->webview);
                            if (!st->webview) return E_FAIL;

                            ComPtr<ICoreWebView2Settings> settings;
                            if (SUCCEEDED(st->webview->get_Settings(&settings)) && settings) {
                                settings->put_AreDefaultContextMenusEnabled(FALSE);
                                settings->put_AreDevToolsEnabled(FALSE);
                                settings->put_IsStatusBarEnabled(FALSE);
                            }

                            // 把插件目录下的 web 文件夹映射为虚拟主机
                            std::wstring webDir = PluginDir() + L"web";
                            st->webview->AddVirtualHostNameToFolderMapping(
                                VIRTUAL_HOST, webDir.c_str(),
                                COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);

                            EventRegistrationToken tok = {};
                            st->webview->add_NavigationCompleted(
                                Callback<ICoreWebView2NavigationCompletedEventHandler>(
                                    [st](ICoreWebView2 *,
                                         ICoreWebView2NavigationCompletedEventArgs *) -> HRESULT
                                    {
                                        st->ready = true;
                                        for (const std::string &m : st->pending) {
                                            std::wstring w = ToWide(m);
                                            st->webview->PostWebMessageAsString(w.c_str());
                                        }
                                        st->pending.clear();
                                        RECT rc;
                                        GetClientRect(st->hwndHost, &rc);
                                        st->controller->put_Bounds(rc);
                                        return S_OK;
                                    }).Get(),
                                &tok);

                            st->webview->Navigate(PAGE_URL);
                            return S_OK;
                        }).Get());
            }).Get());

    if (FAILED(hr)) {
        st->failed = true;
        ShowErrorText(st,
            "WebView2 \xE7\x8E\xAF\xE5\xA2\x83\xE5\x88\x9B\xE5\xBB\xBA\xE5\xA4\xB1\xE8\xB4\xA5\xE3\x80\x82\n"
            "\xE8\xAF\xB7\xE7\xA1\xAE\xE8\xAE\xA4\xE5\xB7\xB2\xE5\xAE\x89\xE8\xA3\x85 WebView2 Evergreen \xE8\xBF\x90\xE8\xA1\x8C\xE6\x97\xB6\xEF\xBC\x88Win10/11 \xE9\x80\x9A\xE5\xB8\xB8\xE5\x86\x85\xE7\xBD\xAE\xEF\xBC\x89\xE3\x80\x82");
    }
}

/* ------------------------- 文件装载 -------------------------------- */

static void LoadOfdFile(ViewerState *st, const std::wstring &pathW, const std::wstring &nameW)
{
    HANDLE hFile = CreateFileW(pathW.c_str(), GENERIC_READ,
                               FILE_SHARE_READ | FILE_SHARE_WRITE,
                               NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) {
        std::string json = "{\"type\":\"error\",\"message\":\""
            + JsonEscape(ToUtf8(L"\xE6\x97\xA0\xE6\xB3\x95\xE6\x89\x93\xE5\xBC\x80\xE6\x96\x87\xE4\xBB\xB6\xEF\xBC\x9A" + nameW)) + "\"}";
        st->Post(json);
        return;
    }

    LARGE_INTEGER liSize = {};
    GetFileSizeEx(hFile, &liSize);
    size_t size = (size_t)liSize.QuadPart;

    std::vector<BYTE> buf(size ? size : 1);
    DWORD rd = 0;
    BOOL ok = ReadFile(hFile, buf.data(), (DWORD)size, &rd, NULL);
    CloseHandle(hFile);

    if (!ok || rd != size) {
        std::string json = "{\"type\":\"error\",\"message\":\""
            + JsonEscape(ToUtf8(L"\xE8\xAF\xBB\xE5\x8F\x96\xE6\x96\x87\xE4\xBB\xB6\xE5\xA4\xB1\xE8\xB4\xA5\xEF\xBC\x9A" + nameW)) + "\"}";
        st->Post(json);
        return;
    }

    std::string json = "{\"type\":\"load\",\"name\":\"" + JsonEscape(ToUtf8(nameW))
                     + "\",\"size\":" + std::to_string((unsigned long long)size)
                     + ",\"data\":\"" + Base64Encode(buf.data(), size) + "\"}";
    st->Post(json);
}

static void HandleLoadA(ViewerState *st, LPCSTR pszFileA)
{
    if (!st || !pszFileA) return;
    int n = MultiByteToWideChar(CP_ACP, 0, pszFileA, -1, NULL, 0);
    std::wstring w((size_t)(n > 0 ? n - 1 : 0), L'\0');
    if (n > 1) MultiByteToWideChar(CP_ACP, 0, pszFileA, -1, &w[0], n);
    std::wstring name = w;
    size_t pos = name.find_last_of(L"\\/");
    if (pos != std::wstring::npos) name = name.substr(pos + 1);
    LoadOfdFile(st, w, name);
}

static void HandleLoadW(ViewerState *st, LPCWSTR pszFileW)
{
    if (!st || !pszFileW) return;
    std::wstring w = pszFileW;
    std::wstring name = w;
    size_t pos = name.find_last_of(L"\\/");
    if (pos != std::wstring::npos) name = name.substr(pos + 1);
    LoadOfdFile(st, w, name);
}

/* ------------------------- 窗口过程 -------------------------------- */

static LRESULT CALLBACK ViewerWndProc(HWND hwnd, UINT uMsg, WPARAM wParam, LPARAM lParam)
{
    ViewerState *st = GetState(hwnd);

    switch (uMsg) {
        case WM_CREATE: {
            st = new ViewerState();
            st->hwndHost = hwnd;
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(st));
            InitWebView(st);
            return 0;
        }

        case WM_SIZE: {
            if (st && st->controller) {
                RECT rc = { 0, 0, (LONG)LOWORD(lParam), (LONG)HIWORD(lParam) };
                st->controller->put_Bounds(rc);
            }
            return 0;
        }

        case WM_DESTROY: {
            if (st) {
                if (st->controller) st->controller->Close();
                delete st;
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            }
            return 0;
        }

        default: {
            /* ---- Directory Opus 发来的 DVPLUGINMSG_* 消息 ---- */
            if (!st) break;

            if (uMsg == DVPLUGINMSG_LOADA) {
                HandleLoadA(st, reinterpret_cast<LPCSTR>(lParam));
                return 0;
            }
            if (uMsg == DVPLUGINMSG_LOADW) {
                HandleLoadW(st, reinterpret_cast<LPCWSTR>(lParam));
                return 0;
            }
            if (uMsg == DVPLUGINMSG_CLEAR) {
                st->Post("{\"type\":\"clear\"}");
                return 0;
            }
            if (uMsg == DVPLUGINMSG_RESIZE) {
                int w = (int)(SHORT)LOWORD(lParam);
                int h = (int)(SHORT)HIWORD(lParam);
                if (w > 0 && h > 0) {
                    SetWindowPos(hwnd, NULL, 0, 0, w, h,
                                 SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOMOVE);
                }
                return 0;
            }
            if (uMsg == DVPLUGINMSG_SETZOOM || uMsg == DVPLUGINMSG_ZOOM) {
                // 0 = 原始大小；-1 = 适合页面；-2 = 平铺；正数 = 百分比
                char buf[64];
                wsprintfA(buf, "{\"type\":\"zoom\",\"value\":%d}", (int)wParam);
                st->Post(buf);
                return 0;
            }
            if (uMsg == DVPLUGINMSG_GETCAPABILITIES) {
                return VPCAPABILITY_RESIZE_FIT | VPCAPABILITY_RESIZE_ANY |
                       VPCAPABILITY_WANTFOCUS | VPCAPABILITY_WANTMOUSEWHEEL |
                       VPCAPABILITY_NOFULLSCREEN;
            }
            if (uMsg == DVPLUGINMSG_GETPICSIZE || uMsg == DVPLUGINMSG_GETZOOMFACTOR ||
                uMsg == DVPLUGINMSG_REDRAW || uMsg == DVPLUGINMSG_SHOWHIDESCROLLBARS ||
                uMsg == DVPLUGINMSG_SETROTATION || uMsg == DVPLUGINMSG_MOUSEWHEEL) {
                return 0;
            }
            break;
        }
    }
    return DefWindowProcW(hwnd, uMsg, wParam, lParam);
}

/* ------------------- SDK 导出函数（A / W 双版本） -------------------- */

extern "C" BOOL WINAPI DVP_Init(void)
{
    WNDCLASSW wc = {};
    wc.lpfnWndProc   = ViewerWndProc;
    wc.hInstance     = g_hInst;
    wc.lpszClassName = WINDOW_CLASS;
    wc.hCursor       = LoadCursor(NULL, IDC_ARROW);
    wc.hbrBackground = (HBRUSH)(COLOR_WINDOW + 1);
    RegisterClassW(&wc);
    return TRUE;
}

extern "C" BOOL WINAPI DVP_InitEx(LPDVPINITEXDATA pData)
{
    (void)pData;
    return DVP_Init();
}

extern "C" void WINAPI DVP_Uninit(void)
{
    UnregisterClassW(WINDOW_CLASS, g_hInst);
}

extern "C" BOOL WINAPI DVP_IdentifyA(LPVIEWERPLUGININFOA pInfo)
{
    if (!pInfo) return FALSE;
    UINT cb = pInfo->cbSize;

    if (cb >= VIEWERPLUGININFOA_V1_SIZE) {
        pInfo->dwFlags          = DVPFIF_ExtensionsOnly | DVPFIF_CanShowAbout;
        pInfo->dwVersionHigh    = 1;
        pInfo->dwVersionLow     = 0;
        if (pInfo->lpszHandleExts)
            lstrcpynA(pInfo->lpszHandleExts, ".ofd", (int)pInfo->cchHandleExtsMax);
        if (pInfo->lpszName)
            lstrcpynA(pInfo->lpszName, "OFD", (int)pInfo->cchNameMax);
        if (pInfo->lpszDescription)
            lstrcpynA(pInfo->lpszDescription,
                      "OFD Layout Viewer (GB/T 33190-2016)",
                      (int)pInfo->cchDescriptionMax);
        if (pInfo->lpszCopyright)
            lstrcpynA(pInfo->lpszCopyright, "(c) 2026 OFD Inspector",
                      (int)pInfo->cchCopyrightMax);
        if (pInfo->lpszURL)
            lstrcpynA(pInfo->lpszURL, "https://resource.dopus.com",
                      (int)pInfo->cchURLMax);
        pInfo->dwlMinFileSize = 64;
        pInfo->dwlMaxFileSize = 0;
        pInfo->dwlMinPreviewFileSize = 64;
        pInfo->dwlMaxPreviewFileSize = 0;
        pInfo->uiMajorFileType = DVPMajorType_Text;
        pInfo->idPlugin = PLUGIN_GUID;
    }
    return TRUE;
}

extern "C" BOOL WINAPI DVP_IdentifyW(LPVIEWERPLUGININFOW pInfo)
{
    if (!pInfo) return FALSE;
    UINT cb = pInfo->cbSize;

    if (cb >= VIEWERPLUGININFOW_V1_SIZE) {
        pInfo->dwFlags          = DVPFIF_ExtensionsOnly | DVPFIF_CanShowAbout;
        pInfo->dwVersionHigh    = 1;
        pInfo->dwVersionLow     = 0;
        if (pInfo->lpszHandleExts)
            lstrcpynW(pInfo->lpszHandleExts, L".ofd", (int)pInfo->cchHandleExtsMax);
        if (pInfo->lpszName)
            lstrcpynW(pInfo->lpszName, L"OFD", (int)pInfo->cchNameMax);
        if (pInfo->lpszDescription)
            lstrcpynW(pInfo->lpszDescription,
                      L"OFD \x7248\x5F0F\x6587\x6863\x9884\x89C8 (GB/T 33190-2016)",
                      (int)pInfo->cchDescriptionMax);
        if (pInfo->lpszCopyright)
            lstrcpynW(pInfo->lpszCopyright, L"(c) 2026 OFD Inspector",
                      (int)pInfo->cchCopyrightMax);
        if (pInfo->lpszURL)
            lstrcpynW(pInfo->lpszURL, L"https://resource.dopus.com",
                      (int)pInfo->cchURLMax);
        pInfo->dwlMinFileSize = 64;
        pInfo->dwlMaxFileSize = 0;
        pInfo->dwlMinPreviewFileSize = 64;
        pInfo->dwlMaxPreviewFileSize = 0;
        pInfo->uiMajorFileType = DVPMajorType_Text;
        pInfo->idPlugin = PLUGIN_GUID;
    }
    return TRUE;
}

// 判断文件是否为本插件可处理的 OFD：
//   扩展名 .ofd + ZIP 魔数 PK\x03\x04 + 尾部可搜到 "OFD.xml"
static BOOL LooksLikeOfd(LPCWSTR pszFileW)
{
    if (!pszFileW) return FALSE;
    LPCWSTR dot = wcsrchr(pszFileW, L'.');
    if (!dot || _wcsicmp(dot, L".ofd") != 0) return FALSE;

    HANDLE h = CreateFileW(pszFileW, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                           NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) return FALSE;

    BYTE magic[4] = { 0 };
    DWORD rd = 0;
    if (!ReadFile(h, magic, 4, &rd, NULL) || rd != 4 ||
        magic[0] != 'P' || magic[1] != 'K' || magic[2] != 3 || magic[3] != 4) {
        CloseHandle(h);
        return FALSE;
    }

    // 在文件尾部 512KB 内搜索 "OFD.xml"（OFD 包必有该入口名）
    const DWORD SCAN_MAX = 512 * 1024;
    LARGE_INTEGER li = {};
    GetFileSizeEx(h, &li);
    DWORD scan = (DWORD)(li.QuadPart < SCAN_MAX ? li.QuadPart : SCAN_MAX);
    if (scan < 12) { CloseHandle(h); return FALSE; }

    std::vector<BYTE> tail(scan);
    LARGE_INTEGER pos = {};
    pos.QuadPart = li.QuadPart - scan;
    SetFilePointerEx(h, pos, NULL, FILE_BEGIN);
    if (!ReadFile(h, tail.data(), scan, &rd, NULL) || rd == 0) {
        CloseHandle(h);
        return FALSE;
    }
    CloseHandle(h);

    static const char NEEDLE[] = "OFD.xml";
    const size_t NL = sizeof(NEEDLE) - 1;
    for (DWORD i = 0; i + NL <= rd; i++) {
        if (memcmp(tail.data() + i, NEEDLE, NL) == 0) return TRUE;
    }
    return FALSE;
}

extern "C" BOOL WINAPI DVP_IdentifyFileA(HWND hWnd, LPSTR lpszName,
                                         LPVIEWERPLUGINFILEINFOA lpInfo, HANDLE hAbortEvent)
{
    (void)hWnd; (void)hAbortEvent;
    if (!lpszName || !lpInfo) return FALSE;
    int n = MultiByteToWideChar(CP_ACP, 0, lpszName, -1, NULL, 0);
    std::wstring w((size_t)(n > 0 ? n - 1 : 0), L'\0');
    if (n > 1) MultiByteToWideChar(CP_ACP, 0, lpszName, -1, &w[0], n);
    if (!LooksLikeOfd(w.c_str())) return FALSE;

    lpInfo->dwFlags |= DVPFIF_CanReturnViewer;
    if (lpInfo->lpszInfo)
        lstrcpynA(lpInfo->lpszInfo, "OFD (GB/T 33190-2016)", (int)lpInfo->cchInfoMax);
    return TRUE;
}

extern "C" BOOL WINAPI DVP_IdentifyFileW(HWND hWnd, LPWSTR lpszName,
                                         LPVIEWERPLUGINFILEINFOW lpInfo, HANDLE hAbortEvent)
{
    (void)hWnd; (void)hAbortEvent;
    if (!lpszName || !lpInfo) return FALSE;
    if (!LooksLikeOfd(lpszName)) return FALSE;

    lpInfo->dwFlags |= DVPFIF_CanReturnViewer;
    if (lpInfo->lpszInfo)
        lstrcpynW(lpInfo->lpszInfo, L"OFD (GB/T 33190-2016)", (int)lpInfo->cchInfoMax);
    return TRUE;
}

extern "C" HWND WINAPI DVP_CreateViewer(HWND hWndParent, LPRECT lpRc, DWORD dwFlags)
{
    (void)dwFlags;
    int x = lpRc ? lpRc->left : 0;
    int y = lpRc ? lpRc->top : 0;
    int w = lpRc ? (lpRc->right - lpRc->left) : 400;
    int h = lpRc ? (lpRc->bottom - lpRc->top) : 400;

    HWND hwnd = CreateWindowExW(
        0, WINDOW_CLASS, L"",
        WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN,
        x, y, w, h, hWndParent, NULL, g_hInst, NULL);
    return hwnd;
}

extern "C" HWND WINAPI DVP_About(HWND hWndParent)
{
    MessageBoxW(
        hWndParent,
        L"OFD \x7248\x5F0F\x9884\x89C8\x63D2\x4EF6\x20\x20v1.0\n\n"
        L"\x57FA\x4E8E GP Software Viewer Plugin SDK (v4)\n"
        L"\x6E32\x67D3\x5F15\x64CE\xFF1AWebView2 + \x5185\x5D4C ofd_viewer.html\n"
        L"\x652F\x6301\x683C\x5F0F\xFF1AOFD (GB/T 33190-2016)\n\n"
        L"OFD Inspector \xB7\x20\x4E3A Directory Opus \x7528\x6237\x6253\x9020",
        L"About OFD Viewer Plugin", MB_OK | MB_ICONINFORMATION);
    return NULL;
}

/* ----------------------------- DllMain ------------------------------ */

BOOL APIENTRY DllMain(HINSTANCE hInstance, DWORD reason, LPVOID)
{
    if (reason == DLL_PROCESS_ATTACH) {
        g_hInst = hInstance;
        DisableThreadLibraryCalls(hInstance);
    }
    return TRUE;
}
