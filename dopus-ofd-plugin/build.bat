@echo off
chcp 65001 >nul
rem ================================================================
rem  OFD 版式预览插件 · 一键构建脚本（生成 x64 的 ofd_viewer.dop）
rem
rem  使用方法：
rem    1. 安装 Visual Studio 2022（勾选"使用 C++ 的桌面开发"工作负载）
rem    2. 从开始菜单打开 "x64 Native Tools Command Prompt for VS 2022"
rem    3. cd 到本目录，运行：build.bat
rem    4. 成功后把 ofd_viewer.dop 和 web\ofd_viewer.html 复制到
rem       Directory Opus 安装目录（见 README.md）
rem
rem  依赖：nuget.exe（用于下载 WebView2 SDK，可离线后免网编译）
rem ================================================================
setlocal enabledelayedexpansion

where cl >nul 2>&1
if errorlevel 1 (
    echo [错误] 找不到 cl.exe。请在 "x64 Native Tools Command Prompt for VS 2022" 中运行本脚本。
    exit /b 1
)

rem ---- 1. 获取 WebView2 SDK（首次需要联网，之后缓存到 packages 目录） ----
if not exist packages (
    where nuget >nul 2>&1
    if errorlevel 1 (
        echo [错误] 找不到 nuget.exe。请先下载 nuget.exe 并加入 PATH：
        echo        https://www.nuget.org/downloads
        exit /b 1
    )
    echo [1/3] 正在下载 WebView2 SDK ...
    nuget install Microsoft.Web.WebView2 -Version 1.0.2903.40 -OutputDirectory packages
    if errorlevel 1 (
        echo [错误] WebView2 SDK 下载失败，请检查网络后重试。
        exit /b 1
    )
)

set WV2=
for /d %%d in (packages\Microsoft.Web.WebView2.*) do set WV2=%%~fd
if "%WV2%"=="" (
    echo [错误] 未在 packages 目录找到 WebView2 SDK。
    exit /b 1
)

rem ---- 2. 编译链接 ----
echo [2/3] 正在编译 ofd_viewer_plugin.cpp ...
cl /nologo /LD /O2 /EHsc /MT /std:c++17 /DWIN32 /DNDEBUG ^
   /I include /I "%WV2%\build\native\include" ^
   src\ofd_viewer_plugin.cpp ^
   /link /DEF:src\plugin.def /OUT:ofd_viewer.dop ^
   user32.lib gdi32.lib shell32.lib ole32.lib advapi32.lib shlwapi.lib version.lib ^
   "%WV2%\build\native\x64\WebView2LoaderStatic.lib"

if errorlevel 1 (
    echo [错误] 编译失败，请查看上方错误信息。
    exit /b 1
)

rem ---- 3. 清理中间文件 ----
del /q ofd_viewer_plugin.obj 2>nul
del /q ofd_viewer.exp 2>nul
del /q ofd_viewer.lib 2>nul

echo.
echo [3/3] 构建成功！产物：
echo        %CD%\ofd_viewer.dop
echo        %CD%\web\ofd_viewer.html
echo.
echo  安装：把这两个文件复制到 Directory Opus 安装目录，例如
echo        C:\Program Files\GPSoftware\Directory Opus\
echo        （ofd_viewer.dop 放根目录，ofd_viewer.html 保持 web\ 子目录）
echo  然后在 设置-首选项-查看器-插件 中勾选 "OFD" 并应用。
echo.
endlocal
