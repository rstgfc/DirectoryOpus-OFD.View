# OFD 版式预览插件 · for Directory Opus

让 Directory Opus 的查看器（Viewer / Viewer Pane）原生支持 **OFD（GB/T 33190-2016）** 版式文件。
基于 GP Software 官方 Viewer Plugin SDK（接口版本 4，DOpus 9 ~ 13 通用），编译产物为 x64 的
`ofd_viewer.dop`。

> 目前公开渠道（GP Software 官方与 resource.dopus.com 社区）没有现成的 OFD 查看器插件，
> 本源码包即为自行开发的完整实现。

## 工作原理

```
Directory Opus
   │  选中 .ofd → 调用插件导出函数
   ▼
ofd_viewer.dop（本插件，C++ / Win32）
   │  DVP_Identify*        声明处理 .ofd
   │  DVP_IdentifyFile*    校验 ZIP 魔数 + OFD.xml 特征
   │  DVP_CreateViewer     创建子窗口，宿主 WebView2 控件
   │  DVPLUGINMSG_LOAD     读取整个文件 → Base64 → PostWebMessageAsString
   ▼
web/ofd_viewer.html（内嵌渲染页，纯 JavaScript，零依赖）
   ZIP 解包 → OFD.xml/Document.xml/Content.xml 解析 → 逐页 SVG 渲染
```

缩放、清除、窗口尺寸等 `DVPLUGINMSG_*` 消息由插件转发给内嵌页面，页内提供翻页、
缩放（含响应 Opus 工具栏的缩放指令）、页尺寸与对象统计。

## 文件清单

```
dopus-ofd-plugin/
├─ build.bat                      一键构建脚本（x64）
├─ README.md                      本文档
├─ include/dopus/viewer_plugins.h GP Software 官方 SDK 头文件（勿改）
├─ src/ofd_viewer_plugin.cpp      插件实现（DVP 导出 + WebView2 宿主）
├─ src/plugin.def                 导出定义
└─ web/ofd_viewer.html            内嵌渲染页（需随 .dop 一起部署）
```

## 构建前提

| 组件 | 说明 |
|---|---|
| Windows 10 / 11（x64） | Directory Opus 12/13 均为 64 位 |
| Visual Studio 2022 | 安装时勾选「使用 C++ 的桌面开发」工作负载 |
| nuget.exe | 首次构建时下载 WebView2 SDK（之后离线可用）；https://www.nuget.org/downloads |
| WebView2 Evergreen 运行时 | 渲染依赖；Win10/11 通常已内置（随 Edge 分发） |

## 构建步骤（约 1 分钟）

1. 开始菜单打开 **「x64 Native Tools Command Prompt for VS 2022」**；
2. `cd` 到本目录；
3. 运行 `build.bat`；
4. 成功后得到 `ofd_viewer.dop`。

## 安装

1. 把以下两项复制到 Directory Opus 安装目录（默认
   `C:\Program Files\GPSoftware\Directory Opus\`）：
   - `ofd_viewer.dop` → 安装目录根目录
   - `web\ofd_viewer.html` → 安装目录下的 `web\` 子目录（保持相对位置）
2. 打开 Directory Opus：**设置 → 首选项 → 查看器 → 插件**；
3. 在列表中勾选 **OFD**（描述：OFD 版式文档预览），点击「应用」；
4. 在文件列表中选中任意 `.ofd` 文件，打开查看器或查看器窗格即可预览；
   插件顺序高于其他"万能查看器"类插件时优先接管 `.ofd`。

## 独立测试（无需 Directory Opus）

直接用浏览器打开 `web/ofd_viewer.html`，把任意 `.ofd` 文件拖进去即可——
插件内嵌的正是这个页面，可先验证渲染效果再编译安装。

## 故障排查

| 现象 | 处理 |
|---|---|
| 插件列表里没有 OFD | 确认复制的是 **64 位** DOpus 目录；重启 DOpus |
| 查看器里提示 WebView2 初始化失败 | 安装/更新 Edge，或单独安装 WebView2 Evergreen 运行时 |
| 页面空白 | 确认 `web\ofd_viewer.html` 与 `.dop` 的相对位置正确 |
| 个别文件渲染不全 | 该文件可能使用加密/签名容器或生僻版式特性；可用网页版预览台对比诊断 |

## 许可证说明

- `include/dopus/viewer_plugins.h`：(c) GP Software，随 Directory Opus SDK 分发；
- 其余源码：MIT，可自由修改、分发（建议保留来源说明）。
