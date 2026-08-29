# OFD 版式预览台 × Directory Opus OFD 插件

一套解决「**Directory Opus 无法预览 OFD（GB/T 33190-2016）**」的双线方案：

1. **网页版 OFD 预览台**（本仓库即站点）——纯前端 OFD 解析/渲染引擎：拖入 `.ofd` 即解开 ZIP 容器、还原文本版式，支持翻页、缩放、导出 PNG、包结构检查。全程本地解析，文件不出机器。
2. **Directory Opus 原生插件源码**（[`dopus-ofd-plugin/`](./dopus-ofd-plugin)）——基于 GP Software 官方 Viewer Plugin SDK（接口 v4，DOpus 9~13 通用）的完整 C++ 工程，Windows 上一条命令编译出 `ofd_viewer.dop`，让 Opus 查看器原生预览 OFD。

> 目前 GP Software 官方与 resource.dopus.com 社区均无现成的 OFD 查看器插件，`dopus-ofd-plugin/` 即为自行开发的实现。

## 目录结构

```
├─ src/                        网页版预览台（React + Vite + Tailwind）
├─ dopus-ofd-plugin/           Directory Opus 原生插件源码
│  ├─ build.bat                一键构建脚本（产出 ofd_viewer.dop）
│  ├─ src/ofd_viewer_plugin.cpp  DVP 导出函数 + WebView2 宿主
│  ├─ include/dopus/viewer_plugins.h  GP Software 官方 SDK 头文件
│  └─ web/ofd_viewer.html      内嵌渲染页（可单独用浏览器打开测试）
├─ .github/workflows/          GitHub Actions：自动部署网页版到 Pages
└─ README.md
```

## 本地运行（网页版）

```bash
npm install
npm run dev      # 开发预览
npm run build    # 产出 dist/
```

## 编译安装 DOpus 插件（Windows）

1. 安装 Visual Studio 2022（勾选「使用 C++ 的桌面开发」）；
2. 打开 **x64 Native Tools Command Prompt for VS 2022**，进入 `dopus-ofd-plugin/`；
3. 运行 `build.bat` → 得到 `ofd_viewer.dop`；
4. 将 `ofd_viewer.dop` 与 `web\ofd_viewer.html` 复制到 Directory Opus 安装目录
   （如 `C:\Program Files\GPSoftware\Directory Opus\`，HTML 保持 `web\` 子目录）；
5. Directory Opus → 设置 → 首选项 → 查看器 → 插件，勾选 **OFD**，应用。

细节见 [`dopus-ofd-plugin/README.md`](./dopus-ofd-plugin/README.md)。

## 部署到 GitHub Pages

仓库已内置工作流 `.github/workflows/deploy-pages.yml`：

1. 推送仓库到 GitHub；
2. 仓库 → **Settings → Pages**，Source 选择 **GitHub Actions**；
3. 之后每次 push 到 `main` 会自动构建并发布，访问 `https://<用户名>.github.io/<仓库名>/` 即可在线使用预览台。

## 常见问题

**Q：在第三方平台点击「发布到 GitHub」提示"环境未找到"？**
该动作需要平台侧已配置 GitHub 凭证（token / OAuth 环境）。若未配置，发布工具找不到可用环境即报此错，与本项目代码无关。解决办法：在本机用 git 直接推送（见下方命令），或在该平台的设置里完成 GitHub 授权后再发布。

**Q：没有 GitHub 凭证时如何手动发布？**

```bash
git init
git add .
git commit -m "OFD 预览台 + Directory Opus OFD 插件源码"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

## 许可证

- `dopus-ofd-plugin/include/dopus/viewer_plugins.h`：(c) GP Software，随 Directory Opus SDK 分发；
- 其余代码：[MIT](./LICENSE)。
