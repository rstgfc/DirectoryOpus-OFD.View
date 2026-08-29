import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { OfdResult } from './lib/ofd';
import { OfdError, fmtSize, parseOfd } from './lib/ofd';
import { buildSampleOfd } from './lib/sample';
import JSZip from 'jszip';
import pluginReadme from '../dopus-ofd-plugin/README.md?raw';
import pluginSdkHeader from '../dopus-ofd-plugin/include/dopus/viewer_plugins.h?raw';
import pluginCpp from '../dopus-ofd-plugin/src/ofd_viewer_plugin.cpp?raw';
import pluginDef from '../dopus-ofd-plugin/src/plugin.def?raw';
import pluginBat from '../dopus-ofd-plugin/build.bat?raw';
import pluginWeb from '../dopus-ofd-plugin/web/ofd_viewer.html?raw';

/* ============================ 图标 ============================ */

const PATHS: Record<string, string> = {
  tray: 'M4 4.5h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-11z M4 12.5h4.2l1.6 2.6h4.4l1.6-2.6H20',
  doc: 'M6 3h8l4 4v14H6z M14 3v4h4 M9 12h6 M9 16h6',
  zoomIn: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M20 20l-4.2-4.2 M8 10.5h5 M10.5 8v5',
  zoomOut: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M20 20l-4.2-4.2 M8 10.5h5',
  fit: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
  one: 'M8.5 4h7v16h-7z M11 7.5h2',
  dl: 'M12 4v11 M7.5 11l4.5 4.5L16.5 11 M5 19.5h14',
  chevL: 'M14.5 6l-6 6 6 6',
  chevR: 'M9.5 6l6 6-6 6',
  x: 'M6 6l12 12 M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z M4 7.5l8 4.5 8-4.5 M12 12v9',
  tree: 'M6 4v16 M6 8h5 M6 12h9 M6 16h5',
  info: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M12 11v5 M12 7.4v.6',
  refresh: 'M19 12a7 7 0 1 1-2.05-4.95 M19 4v4h-4',
  typeT: 'M5 6.5V4.5h14v2 M12 4.5v15 M9 19.5h6',
  pen: 'M4 20l1-4L16.5 4.5a2.12 2.12 0 0 1 3 3L8 19l-4 1z',
  img: 'M4 5h16v14H4z M4 15l4-4 3 3 5-5 4 4 M9 9.5v.5',
  ext: 'M14 4h6v6 M20 4l-9 9 M19 13v7H5V6h7',
};

function Icon({ name, size = 18, sw = 1.8 }: { name: keyof typeof PATHS; size?: number; sw?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/* ========================== 静态内容 ========================== */

const FACTS = [
  'GB/T 33190-2016',
  '中国国家版式文档标准',
  'ZIP 容器 × XML 版式描述',
  '电子公文 · 电子发票 · 电子证照',
  '与 PDF 并行的长期保存格式',
  '纯前端解析 · 文件不出本机',
  '文本 / 路径 / 位图对象渲染',
  'DIRECTORY OPUS 用户的预览补丁',
];

const GUIDE: { n: string; t: string; b: ReactNode }[] = [
  {
    n: '01',
    t: '现状：没有现成的 OFD 查看器插件',
    b: '在 GP Software 官方帮助与 resource.dopus.com 社区检索，Viewer Plugins 列表里只有 PDF、图像等格式的扩展，没有可直接安装使用的 OFD 预览 .dop 插件，中文社区也仅有零星的格式转换讨论。',
  },
  {
    n: '02',
    t: '为什么会缺位',
    b: 'OFD（GB/T 33190-2016）是中国国家版式标准，海外需求有限；而 Directory Opus 的 Viewer 插件是原生 C++ DLL，必须自带一整套 OFD 解析与渲染引擎——成熟可嵌入的 C++ 实现极少，生态集中在 Java 的 ofdrw 和 Web 端的 ofd.js。',
  },
  {
    n: '03',
    t: '路线 A：把本工具当作随身预览台',
    b: '点击右上角「下载离线版」，即可把整个工具（解析引擎 + 界面）打包成单个 HTML 文件，保存到任意目录、双击离线使用（推荐 Chrome / Edge）。日常在 Directory Opus 里选中 .ofd 文件后拖入该页面，秒级解包渲染；支持逐页翻阅、无级缩放、导出 PNG，全程不上传任何数据。也可以把这个 HTML 拖进 Opus 的工具栏或收藏夹，一键调起。',
  },
  {
    n: '04',
    t: '路线 B：借力 Windows 预览处理程序',
    b: 'Directory Opus 能挂接第三方 Preview Handler。安装数科、福昕等国产 OFD 阅读器后，系统会注册 OFD 的预览处理程序，Opus 的预览窗格有机会直接复用；同时可在 File Types 中为 .ofd 配置 open 动作调用阅读器。',
  },
  {
    n: '05',
    t: '路线 C：安装自研的 .dop 原生插件（源码已备好）',
    b: '点击右上角「DOpus 插件源码」即可下载完整工程：基于 GP Software 官方 Viewer Plugin SDK v4 实现的 ofd_viewer.dop（校验 ZIP 魔数与 OFD.xml 特征后接管 .ofd），内部用 WebView2 宿主纯 JS 渲染页逐页绘制版式。解压后在 Visual Studio 的 x64 命令行里运行 build.bat 一键编译，把 ofd_viewer.dop 与 web/ofd_viewer.html 复制到 DOpus 安装目录，在「首选项 → 查看器 → 插件」中勾选启用即可。内嵌渲染页也可单独用浏览器打开、拖入 OFD 先行验证。',
  },
];

const SOURCES = [
  { label: 'GP Software 官网', href: 'https://www.gpsoft.com.au' },
  { label: 'Opus 资源中心', href: 'https://resource.dopus.com' },
  { label: '插件能力清单', href: 'https://www.pretentiousname.com/opus_plugin_list/' },
  { label: 'ofdrw · Java', href: 'https://github.com/ofdrw/ofdrw' },
  { label: 'ofd.js · Web', href: 'https://www.npmjs.com/package/ofd.js' },
];

const META_LABELS: [string, string][] = [
  ['Title', '标题'],
  ['Subject', '主题'],
  ['Author', '作者'],
  ['Creator', '创建应用'],
  ['CreatorVersion', '创建版本'],
  ['CreationDate', '创建日期'],
  ['ModDate', '修改日期'],
  ['Publisher', '发行方'],
  ['Keywords', '关键词'],
  ['DocID', '文档 ID'],
  ['Abstract', '摘要'],
  ['Version', '版本'],
  ['Copyright', '版权'],
];

/* ========================== 小部件 ============================ */

function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal${on ? ' on' : ''}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function Marquee() {
  const items = [...FACTS, ...FACTS];
  return (
    <div className="marquee" aria-hidden>
      <div className="marquee-track">
        {items.map((f, i) => (
          <span className="mq-item" key={i}>
            {f}
            <span className="mq-sep">◆</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function GuideContent({ inModal = false }: { inModal?: boolean }) {
  return (
    <>
      {!inModal && (
        <div className="answer">
          <Reveal>
            <div className="nope">没有。</div>
          </Reveal>
          <div className="answer-txt">
            <Reveal delay={80}>
              <h2>Directory Opus 里有现成的 OFD 预览插件吗？</h2>
              <p>
                截至 2026 年初的公开信息：官方插件体系与社区都没有可直接安装的 OFD 查看器插件（.dop）。
                所以下面把这个结论、原因，以及三条真正可行的路线一次讲清楚——本页工具本身就是路线 A 的成品。
              </p>
            </Reveal>
          </div>
        </div>
      )}
      <div className="ledger">
        {GUIDE.map((g, i) => (
          <Reveal key={g.n} delay={i * 70}>
            <div className="ledger-row">
              <div className="ledger-num">{g.n}</div>
              <div>
                <h3>{g.t}</h3>
                <p>{g.b}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
      <div className="src-row">
        <span className="src-label">参考来源 / 开发资源</span>
        {SOURCES.map((s) => (
          <a key={s.href} className="src-chip" href={s.href} target="_blank" rel="noreferrer">
            <Icon name="ext" size={12} sw={2} />
            {s.label}
          </a>
        ))}
      </div>
    </>
  );
}

/* ============================ 主应用 ============================ */

type Toast = { id: number; msg: string; kind: 'ok' | 'err' };
type Tab = 'pages' | 'info' | 'zip';

const clampZoom = (z: number) => Math.min(2.6, Math.max(0.3, Math.round(z * 100) / 100));

export default function App() {
  const [doc, setDoc] = useState<OfdResult | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [tab, setTab] = useState<Tab>('pages');
  const [dragOn, setDragOn] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const fileRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragDepth = useRef(0);
  const toastSeq = useRef(0);

  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, msg, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const loadFile = useCallback(
    async (f: File) => {
      setErr(null);
      const steps = ['正在解压 ZIP 容器…', '正在解析文档树…', '正在渲染版式页面…'];
      setLoading(steps[0]);
      const timer = window.setInterval(() => {
        setLoading((cur) => {
          if (!cur) return cur;
          const idx = steps.indexOf(cur);
          return idx >= 0 && idx < steps.length - 1 ? steps[idx + 1] : cur;
        });
      }, 420);
      try {
        const res = await parseOfd(f);
        setDoc(res);
        setPage(0);
        setTab('pages');
        toast(`解析完成：${res.pages.length} 页 · 耗时 ${res.parseMs.toFixed(0)} ms`, 'ok');
      } catch (e) {
        const msg = e instanceof OfdError ? e.message : '解析失败：发生未知错误。';
        setErr(msg);
        toast(msg, 'err');
      } finally {
        window.clearInterval(timer);
        setLoading(null);
      }
    },
    [toast],
  );

  const genSample = useCallback(async () => {
    setLoading('正在生成示例 OFD…');
    try {
      const f = await buildSampleOfd();
      await loadFile(f);
    } catch {
      setLoading(null);
      toast('示例文档生成失败，请重试。', 'err');
    }
  }, [loadFile, toast]);

  const openPicker = () => fileRef.current?.click();

  const goHome = () => {
    setDoc(null);
    setErr(null);
    setPage(0);
    window.scrollTo({ top: 0 });
  };

  /* ---------- 拖放 ---------- */
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current++;
    setDragOn(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOn(false);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragOn(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void loadFile(f);
  };

  /* ---------- 缩放 / 键盘 ---------- */
  const fitWidth = useCallback(() => {
    const el = stageRef.current;
    if (!doc || !el) return;
    const p = doc.pages[page];
    if (!p) return;
    setZoom(clampZoom((el.clientWidth - 110) / (p.width * 3)));
  }, [doc, page]);

  useEffect(() => {
    if (doc) fitWidth();
  }, [doc, fitWidth]);

  useEffect(() => {
    if (!doc) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setPage((p) => Math.min(p + 1, doc.pages.length - 1));
      if (e.key === 'ArrowLeft') setPage((p) => Math.max(p - 1, 0));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [doc]);

  /* ---------- 导出 PNG ---------- */
  const exportPng = () => {
    if (!doc) return;
    const p = doc.pages[page];
    if (!p) return;
    const scale = 8;
    const svg = p.svg.replace('<svg ', `<svg width="${p.width * scale}" height="${p.height * scale}" `);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = p.width * scale;
      cv.height = p.height * scale;
      const g = cv.getContext('2d');
      if (!g) return;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      cv.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${doc.fileName.replace(/\.ofd$/i, '')}_第${page + 1}页.png`;
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(a.href), 3000);
        toast(`第 ${page + 1} 页已导出为 PNG`, 'ok');
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast('导出失败，请重试。', 'err');
    };
    img.src = url;
  };

  /* ---------- 导出离线单文件版 ---------- */
  const downloadStandalone = async () => {
    toast('正在打包离线版（内联全部脚本与样式）…');
    try {
      const clone = document.documentElement.cloneNode(true) as HTMLElement;
      const links = Array.from(clone.querySelectorAll('link[rel="stylesheet"]'));
      for (const link of links) {
        const href = (link as HTMLLinkElement).href;
        if (!href || /fonts\.(googleapis|gstatic)\.com/.test(href)) continue;
        const css = await (await fetch(href)).text();
        const style = document.createElement('style');
        style.textContent = css;
        link.replaceWith(style);
      }
      const scripts = Array.from(clone.querySelectorAll('script[src]'));
      for (const s of scripts) {
        const src = (s as HTMLScriptElement).src;
        if (!src) continue;
        const code = await (await fetch(src)).text();
        const ns = document.createElement('script');
        ns.type = (s as HTMLScriptElement).type || 'text/javascript';
        ns.textContent = code;
        s.replaceWith(ns);
      }
      const root = clone.querySelector('#root');
      if (root) root.innerHTML = '';
      const html = `<!doctype html>\n${clone.outerHTML}`;
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'OFD版式预览台-离线版.html';
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      toast('已导出单文件离线版，双击即可离线使用', 'ok');
    } catch {
      toast('打包失败，请重试。', 'err');
    }
  };

  /* ---------- 打包 Directory Opus 原生插件源码 ---------- */
  const downloadPluginZip = async () => {
    toast('正在打包 Directory Opus 插件源码…');
    try {
      const zip = new JSZip();
      const root = zip.folder('dopus-ofd-plugin')!;
      root.file('README.md', pluginReadme);
      root.file('build.bat', pluginBat);
      root.file('src/ofd_viewer_plugin.cpp', pluginCpp);
      root.file('src/plugin.def', pluginDef);
      root.file('include/dopus/viewer_plugins.h', pluginSdkHeader);
      root.file('web/ofd_viewer.html', pluginWeb);
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'dopus-ofd-plugin-source.zip';
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      toast('插件源码包已下载：解压后在 VS x64 命令行运行 build.bat 即得 .dop', 'ok');
    } catch {
      toast('打包失败，请重试。', 'err');
    }
  };

  const guide = () => {
    if (doc) setGuideOpen(true);
    else document.getElementById('guide')?.scrollIntoView({ behavior: 'smooth' });
  };

  const cur = doc?.pages[page];

  /* ============================ 渲染 ============================ */

  return (
    <div
      className="app"
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="wm" aria-hidden>
        版
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".ofd,application/zip"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadFile(f);
          e.target.value = '';
        }}
      />

      {/* ---------------- 顶栏 ---------------- */}
      <header className="hdr">
        <div className="hdr-inner">
          <button className="brand" onClick={goHome} title="回到首页">
            <span className="seal">版</span>
            <span className="brand-txt">
              <strong>OFD 版式预览台</strong>
              <span>OFD INSPECTOR · FOR DIRECTORY OPUS USERS</span>
            </span>
          </button>
          <nav className="hdr-nav">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void downloadPluginZip()}
              title="下载 Directory Opus 原生 OFD 插件（ofd_viewer.dop）的完整源码包，含官方 SDK 头文件与一键构建脚本"
            >
              <Icon name="box" size={15} />
              DOpus 插件源码
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void downloadStandalone()} title="将整个工具打包为单个 HTML 文件，保存后双击离线使用">
              <Icon name="dl" size={15} />
              下载离线版
            </button>
            <button className="btn btn-ghost btn-sm" onClick={guide}>
              <Icon name="info" size={15} />
              集成指南
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void genSample()}>
              <Icon name="doc" size={15} />
              示例文档
            </button>
            <button className="btn btn-primary btn-sm" onClick={openPicker}>
              <Icon name="tray" size={15} />
              打开 OFD
            </button>
          </nav>
        </div>
      </header>

      {/* ---------------- 首页 / 工作区 ---------------- */}
      {!doc ? (
        <>
          <main className="wrap">
            <div className="hero-grid">
              <div>
                <p className="kicker">GB/T 33190-2016 · OPEN FIXED-LAYOUT DOCUMENT</p>
                <h1 className="h1">
                  OFD 版式文件，
                  <br />
                  <span className="hot">拖进来</span>就能看。
                </h1>
                <p className="lede">
                  为 Directory Opus 用户补上缺失的一环：不用装任何插件，把 .ofd
                  拖进浏览器，立即解开 ZIP 容器、还原文本版式，逐页查看并导出
                  PNG。解析全程在本机完成，文件不会离开你的电脑。
                </p>
                <div className="chips">
                  {['ZIP 容器', 'XML 版式', '电子公文', '电子发票', '电子证照', '长期保存'].map((c) => (
                    <span className="chip" key={c}>
                      {c}
                    </span>
                  ))}
                </div>
                <p className="try-line">
                  手头没有 .ofd 文件？
                  <button className="linkish" onClick={() => void genSample()} style={{ marginLeft: 6 }}>
                    生成一份示例公文 →
                  </button>
                </p>
              </div>

              <div>
                <Reveal delay={120}>
                  <div className="sheet">
                    <div className="sheet-head">
                      <span>
                        <i />
                        DROP ZONE · 拖放区
                      </span>
                      <span>*.ofd</span>
                    </div>
                    <button
                      className={`dz${dragOn ? ' on' : ''}`}
                      onClick={openPicker}
                      onDragOver={(e) => e.preventDefault()}
                      style={{ display: 'block', width: 'calc(100% - 30px)', cursor: 'pointer' }}
                    >
                      <span className="dz-icon">
                        <Icon name="tray" size={46} sw={1.4} />
                      </span>
                      <div className="dz-big">拖放 .ofd 文件到这里</div>
                      <div className="dz-small">
                        或 <b>点击选择文件</b> · 支持多页文档 · 纯本地解析
                      </div>
                    </button>
                    <div className="mini-steps">
                      <b>① 解包 ZIP</b>
                      <span className="arr">→</span>
                      <b>② 解析文档树</b>
                      <span className="arr">→</span>
                      <b>③ SVG 渲染</b>
                    </div>
                  </div>
                </Reveal>
                {err && (
                  <div className="errcard">
                    <Icon name="x" size={17} sw={2.2} />
                    <div>
                      <strong>{err}</strong>
                      <div style={{ color: 'var(--body-c)', marginTop: 4 }}>
                        提示：OFD 本质是 ZIP 容器，可将扩展名改为 .zip 验证能否解压；或先试试上方的示例文档。
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </main>

          <Marquee />

          <main className="wrap" id="guide">
            <GuideContent />
          </main>

          <footer className="ftr">
            <div className="ftr-inner">
              <div>
                <h4>OFD 版式预览台</h4>
                <p>
                  一个为 Directory Opus 用户打造的离线 OFD 预览工具：解析 ZIP 容器与 XML
                  版式描述，渲染文本、路径与位图对象，支持翻页、缩放、导出 PNG 与包结构检查。
                </p>
              </div>
              <div className="ftr-links">
                {SOURCES.map((s) => (
                  <a key={s.href} href={s.href} target="_blank" rel="noreferrer">
                    <Icon name="ext" size={13} />
                    {s.label}
                  </a>
                ))}
              </div>
              <div className="ftr-note">
                <span>纯前端实现 · 无上传 · 可离线部署</span>
                <span>GB/T 33190-2016 · {new Date().getFullYear()}</span>
              </div>
            </div>
          </footer>
        </>
      ) : (
        <div className="work">
          {/* 工具条 */}
          <div className="toolbar">
            <div className="file-chip">
              <Icon name="doc" size={19} />
              <strong title={doc.fileName}>{doc.fileName}</strong>
              <em>{fmtSize(doc.fileSize)}</em>
              <em>{doc.pages.length} 页</em>
            </div>
            <div className="toolbar-actions">
              <button className="btn btn-line btn-sm" onClick={() => void genSample()}>
                <Icon name="refresh" size={14} />
                示例文档
              </button>
              <button className="btn btn-line btn-sm" onClick={openPicker}>
                <Icon name="tray" size={14} />
                换一份文件
              </button>
              <button className="btn btn-primary btn-sm" onClick={exportPng}>
                <Icon name="dl" size={14} />
                导出本页 PNG
              </button>
            </div>
          </div>

          {/* 侧栏 */}
          <aside className="aside">
            <div className="tabs">
              <button className={`tab${tab === 'pages' ? ' active' : ''}`} onClick={() => setTab('pages')}>
                页面<b>{doc.pages.length}</b>
              </button>
              <button className={`tab${tab === 'info' ? ' active' : ''}`} onClick={() => setTab('info')}>
                信息
              </button>
              <button className={`tab${tab === 'zip' ? ' active' : ''}`} onClick={() => setTab('zip')}>
                包结构<b>{doc.zipEntries.length}</b>
              </button>
            </div>
            <div className="tab-body">
              {tab === 'pages' && (
                <div className="thumblist">
                  {doc.pages.map((p, i) => (
                    <button
                      key={i}
                      className={`thumb${i === page ? ' on' : ''}`}
                      onClick={() => setPage(i)}
                      title={`第 ${i + 1} 页`}
                    >
                      <span className="thumb-no">{i + 1}</span>
                      <span dangerouslySetInnerHTML={{ __html: p.svg }} />
                    </button>
                  ))}
                </div>
              )}

              {tab === 'info' && cur && (
                <div className="panel">
                  <h4>文档信息</h4>
                  {META_LABELS.filter(([k]) => doc.meta[k]).map(([k, label]) => (
                    <div className="kv" key={k}>
                      <span className="kv-k">{label}</span>
                      <span className="kv-v">{doc.meta[k]}</span>
                    </div>
                  ))}
                  {Object.keys(doc.meta).length === 0 && <p className="dim">该文件未携带元数据（DocInfo）。</p>}

                  <h4>解析统计</h4>
                  <div className="kv">
                    <span className="kv-k">文档入口</span>
                    <span className="kv-v">{doc.docEntry}</span>
                  </div>
                  <div className="kv">
                    <span className="kv-k">页面尺寸</span>
                    <span className="kv-v">
                      {cur.width} × {cur.height} mm
                    </span>
                  </div>
                  <div className="kv">
                    <span className="kv-k">内嵌位图</span>
                    <span className="kv-v">{doc.imageCount} 个</span>
                  </div>
                  <div className="kv">
                    <span className="kv-k">解析耗时</span>
                    <span className="kv-v">{doc.parseMs.toFixed(1)} ms</span>
                  </div>

                  <h4>引用字体</h4>
                  {doc.fonts.length > 0 ? (
                    <div className="chips" style={{ margin: '6px 0 0' }}>
                      {doc.fonts.map((f) => (
                        <span className="chip" key={f.id}>
                          {f.family || f.name || `#${f.id}`}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="dim">未声明字体资源。</p>
                  )}

                  <h4>当前页对象</h4>
                  <ObjectStats counts={cur.counts} />
                  <div className="objlist">
                    {cur.objects.slice(0, 14).map((o, i) => (
                      <div className="obj-row" key={i}>
                        <span className={`kind-${o.kind}`}>
                          <Icon name={o.kind === 'text' ? 'typeT' : o.kind === 'path' ? 'pen' : 'img'} size={13} sw={2} />
                        </span>
                        <span>{o.detail}</span>
                      </div>
                    ))}
                    {cur.objects.length > 14 && (
                      <div className="obj-row" style={{ borderBottom: 0, color: 'var(--slate)' }}>
                        … 其余 {cur.objects.length - 14} 个对象
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tab === 'zip' && (
                <div className="panel">
                  <h4>包内文件 · {doc.zipEntries.length} 条</h4>
                  <div className="ziplist">
                    {doc.zipEntries.slice(0, 200).map((z) => {
                      const depth = z.path.split('/').filter(Boolean).length - 1;
                      return (
                        <div className={`zip-row${z.dir ? ' dir' : ''}`} key={z.path}>
                          <span className="zip-path" style={{ paddingLeft: depth * 12 }}>
                            {z.dir ? '▸ ' : ''}
                            {z.path}
                          </span>
                          <span className="zip-size">{z.dir ? 'DIR' : fmtSize(z.size)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <p className="dim" style={{ marginTop: 10 }}>
                    OFD 即 ZIP 容器：OFD.xml 为入口，Doc_N/ 下是文档定义、页内容与资源。
                  </p>
                </div>
              )}
            </div>
          </aside>

          {/* 画布 */}
          <div className="main-col">
            <div className="stage" ref={stageRef}>
              <div className="pager">
                <button className="zbtn" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} title="上一页（←）">
                  <Icon name="chevL" size={16} sw={2.2} />
                </button>
                <span className="pg-no">
                  {page + 1} / {doc.pages.length}
                </span>
                <button
                  className="zbtn"
                  onClick={() => setPage((p) => Math.min(doc.pages.length - 1, p + 1))}
                  disabled={page === doc.pages.length - 1}
                  title="下一页（→）"
                >
                  <Icon name="chevR" size={16} sw={2.2} />
                </button>
              </div>

              {cur && (
                <div
                  key={page}
                  className="page-wrap page-anim"
                  style={{ width: `${cur.width * 3 * zoom}px` }}
                  dangerouslySetInnerHTML={{ __html: cur.svg }}
                />
              )}

              <div className="zoombar">
                <button className="zbtn" onClick={() => setZoom((z) => clampZoom(z / 1.2))} title="缩小">
                  <Icon name="zoomOut" size={16} />
                </button>
                <span className="z-pct">{Math.round(zoom * 100)}%</span>
                <button className="zbtn" onClick={() => setZoom((z) => clampZoom(z * 1.2))} title="放大">
                  <Icon name="zoomIn" size={16} />
                </button>
                <span className="z-div" />
                <button className="z-text" onClick={fitWidth} title="适应宽度">
                  适应
                </button>
                <button className="z-text" onClick={() => setZoom(1)} title="100%">
                  1:1
                </button>
              </div>
            </div>

            <div className="statusbar">
              <span>
                第 <b>{page + 1}</b> / {doc.pages.length} 页 · {fmtSize(doc.fileSize)}
              </span>
              <span>
                解析 <b>{doc.parseMs.toFixed(0)} ms</b> · 缩放 <b>{Math.round(zoom * 100)}%</b> ·{' '}
                <span className="ok">本地解析，无上传</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- 覆盖层 ---------------- */}
      {loading && (
        <div className="overlay">
          <div className="overlay-card">
            <div className="sq-spin" />
            <div>
              <div className="lbl">{loading}</div>
              <div className="sub">解包 → 文档树 → 版式对象 → SVG</div>
            </div>
          </div>
        </div>
      )}

      {dragOn && (
        <div className="dragveil">
          <div className="dragveil-box">
            <Icon name="tray" size={44} sw={1.4} />
            <h2>松开，立即预览</h2>
            <p>OFD / ZIP 容器 · 本地解析</p>
          </div>
        </div>
      )}

      {guideOpen && (
        <div className="modal" onClick={() => setGuideOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Directory Opus × OFD 集成指南</h3>
              <button className="zbtn" onClick={() => setGuideOpen(false)} title="关闭">
                <Icon name="x" size={17} sw={2.2} />
              </button>
            </div>
            <div className="modal-body">
              <GuideContent inModal />
            </div>
          </div>
        </div>
      )}

      {/* ---------------- Toast ---------------- */}
      <div className="toasts">
        {toasts.map((t) => (
          <div className={`toast${t.kind === 'err' ? ' err' : ''}`} key={t.id}>
            <Icon name={t.kind === 'err' ? 'x' : 'check'} size={16} sw={2.4} />
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ========================== 对象统计 ============================ */

function ObjectStats({ counts }: { counts: { text: number; path: number; image: number } }) {
  const rows: { label: string; n: number; color: string }[] = [
    { label: '文本', n: counts.text, color: 'var(--red)' },
    { label: '路径', n: counts.path, color: 'var(--ink-2)' },
    { label: '位图', n: counts.image, color: 'var(--teal)' },
  ];
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="bars">
      {rows.map((r) => (
        <div className="bar-row" key={r.label}>
          <span>{r.label}</span>
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${(r.n / max) * 100}%`, background: r.color }} />
          </span>
          <span style={{ textAlign: 'right', fontWeight: 700 }}>{r.n}</span>
        </div>
      ))}
    </div>
  );
}
