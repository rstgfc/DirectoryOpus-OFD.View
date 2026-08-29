import JSZip from 'jszip';

/* ------------------------------------------------------------------ */
/* OFD (GB/T 33190-2016) 纯前端解析 / 渲染引擎                          */
/* 思路：.ofd 即 ZIP 容器 -> OFD.xml 入口 -> Document.xml 页树           */
/*      -> Pages/Page_N/Content.xml 版式对象 -> SVG                     */
/* ------------------------------------------------------------------ */

export class OfdError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'OfdError';
  }
}

export interface OfdFont {
  id: string;
  family: string;
  name: string;
}
export interface PageObjectInfo {
  kind: 'text' | 'path' | 'image';
  detail: string;
}
export interface OfdPage {
  width: number;
  height: number;
  svg: string;
  objects: PageObjectInfo[];
  counts: { text: number; path: number; image: number };
}
export interface ZipEntryInfo {
  path: string;
  size: number;
  dir: boolean;
}
export interface OfdResult {
  fileName: string;
  fileSize: number;
  pages: OfdPage[];
  meta: Record<string, string>;
  fonts: OfdFont[];
  zipEntries: ZipEntryInfo[];
  docEntry: string;
  parseMs: number;
  imageCount: number;
}

interface Ctx {
  zip: JSZip;
  docDir: string;
  fonts: Map<string, OfdFont>;
  palettes: Map<string, string[]>;
  images: Map<string, string>;
}

const PARSER = new DOMParser();

function xmlOf(text: string, label: string): Element {
  const d = PARSER.parseFromString(text, 'application/xml');
  if (d.getElementsByTagName('parsererror').length > 0) {
    throw new OfdError(`${label} 不是合法的 XML，文件可能已损坏。`);
  }
  return d.documentElement;
}

function kid(el: Element | null | undefined, name: string): Element | null {
  if (!el) return null;
  for (let i = 0; i < el.children.length; i++) {
    const c = el.children[i];
    if (c.localName === name) return c;
  }
  return null;
}

function deep(root: Element | null, name: string): Element[] {
  const out: Element[] = [];
  if (!root) return out;
  const walk = (el: Element) => {
    for (let i = 0; i < el.children.length; i++) {
      const c = el.children[i];
      if (c.localName === name) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

const num = (v: string | null, def: number): number => {
  if (v == null) return def;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : def;
};

const r2 = (n: number): string => String(Math.round(n * 100) / 100);

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function fmtSize(n: number): string {
  if (n <= 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** 在包内按多种相对规则定位文件（OFD 的路径基准并不总是统一） */
function resolveFile(zip: JSZip, docDir: string, path: string): JSZip.JSZipObject | null {
  const p = path.trim().replace(/^\/+/, '');
  const candidates = [p, docDir + p];
  for (const c of candidates) {
    const f = zip.file(c);
    if (f) return f;
  }
  const base = p.split('/').pop() || p;
  const safe = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hits = zip.file(new RegExp(`(^|/)${safe}$`, 'i'));
  return hits.length > 0 ? hits[0] : null;
}

/** 颜色：直接 RGB 值 或 调色板索引，附带 Alpha */
function colorOf(el: Element | null, ctx: Ctx): string | null {
  if (!el) return null;
  const value = (el.getAttribute('Value') || '').trim();
  const alpha = num(el.getAttribute('Alpha'), 255) / 255;
  let r = 0;
  let g = 0;
  let b = 0;
  const csId = el.getAttribute('ColorSpace');
  const palette = csId ? ctx.palettes.get(csId) : undefined;
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length >= 3) {
    r = +parts[0];
    g = +parts[1];
    b = +parts[2];
  } else if (parts.length === 1 && palette) {
    const idx = parseInt(parts[0], 10);
    const cv = (palette[idx] || '0 0 0').split(/\s+/).map(Number);
    r = cv[0] || 0;
    g = cv[1] || 0;
    b = cv[2] || 0;
  } else if (parts.length === 1) {
    r = g = b = +parts[0];
  }
  return `rgba(${r | 0},${g | 0},${b | 0},${alpha.toFixed(3)})`;
}

/**
 * OFD 路径缩写数据 -> SVG path d
 * 注意 OFD 与 SVG 字母含义不同：S/M=移动 L=直线 B=三次贝塞尔 Q=二次 C=闭合 A=椭圆弧
 */
function abbrevToD(ab: string): { d: string; segs: number } {
  const tokens = ab.match(/[SMLCBAQ]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || [];
  const need: Record<string, number> = { S: 2, M: 2, L: 2, Q: 4, B: 6, A: 7, C: 0 };
  let d = '';
  let segs = 0;
  let cmd = '';
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[SMLCBAQ]$/.test(t)) {
      cmd = t;
      i++;
      if (cmd === 'C') {
        d += ' Z';
        segs++;
        cmd = '';
      }
      continue;
    }
    if (!cmd) {
      i++;
      continue;
    }
    const n = need[cmd];
    const nums: number[] = [];
    while (nums.length < n && i < tokens.length && !/^[SMLCBAQ]$/.test(tokens[i])) {
      nums.push(parseFloat(tokens[i]));
      i++;
    }
    if (nums.length < n) break;
    switch (cmd) {
      case 'S':
      case 'M':
        d += ` M ${r2(nums[0])} ${r2(nums[1])}`;
        break;
      case 'L':
        d += ` L ${r2(nums[0])} ${r2(nums[1])}`;
        break;
      case 'Q':
        d += ` Q ${nums.slice(0, 4).map(r2).join(' ')}`;
        break;
      case 'B':
        d += ` C ${nums.slice(0, 6).map(r2).join(' ')}`;
        break;
      case 'A':
        d += ` A ${r2(nums[0])} ${r2(nums[1])} ${r2(nums[2])} ${nums[3] > 0 ? 1 : 0} ${
          nums[4] > 0 ? 1 : 0
        } ${r2(nums[5])} ${r2(nums[6])}`;
        break;
    }
    segs++;
  }
  return { d: d.trim(), segs };
}

/** 解析 DeltaX/DeltaY（含 g 分组语法），累积出每个字形的坐标 */
function glyphPositions(start: number, deltaStr: string | null, count: number, step: number): string {
  if (!deltaStr || !deltaStr.trim()) return r2(start);
  const deltas: number[] = [];
  const toks = deltaStr.trim().split(/\s+/);
  for (let i = 0; i < toks.length; i++) {
    if (toks[i] === 'g' || toks[i] === 'G') {
      const rep = parseInt(toks[i + 1], 10) || 0;
      const val = parseFloat(toks[i + 2]);
      for (let k = 0; k < rep; k++) deltas.push(Number.isFinite(val) ? val : 0);
      i += 2;
    } else {
      const v = parseFloat(toks[i]);
      if (Number.isFinite(v)) deltas.push(v);
    }
  }
  const pos: number[] = [start];
  let cur = start;
  for (let i = 1; i < count; i++) {
    cur += i - 1 < deltas.length ? deltas[i - 1] : step;
    pos.push(cur);
  }
  return pos.map(r2).join(' ');
}

function matrixAttr(el: Element): string {
  const ctm = (el.getAttribute('CTM') || '').trim();
  return ctm ? `matrix(${ctm.split(/\s+/).join(' ')})` : '';
}

/* ------------------------- 版式对象 -> SVG ------------------------- */

function renderTextObject(el: Element, ctx: Ctx, page: OfdPage): string {
  const fontId = el.getAttribute('Font') || '';
  const font = ctx.fonts.get(fontId);
  const size = num(el.getAttribute('Size'), 3.5);
  const fill =
    colorOf(kid(el, 'StrokeColor'), ctx) || colorOf(kid(el, 'FillColor'), ctx) || 'rgba(0,0,0,1)';
  const hscale = num(el.getAttribute('HScale'), 1);
  const weight = el.getAttribute('Weight') === '800' ? 700 : 400;
  const family = font && (font.family || font.name) ? `${font.family || font.name}, "Noto Sans SC", serif` : '"Noto Sans SC", SimSun, serif';
  const codes = deep(el, 'TextCode');
  if (codes.length === 0) return '';
  let inner = '';
  let snippet = '';
  for (const tc of codes) {
    const X = num(tc.getAttribute('X'), 0);
    const Y = num(tc.getAttribute('Y'), 0);
    const text = tc.textContent || '';
    snippet += text;
    const chars = Array.from(text);
    if (chars.length === 0) continue;
    const xs = glyphPositions(X, tc.getAttribute('DeltaX'), chars.length, size);
    const ys = glyphPositions(Y, tc.getAttribute('DeltaY'), chars.length, 0);
    inner += `<text x="${xs}" y="${ys}">${esc(text)}</text>`;
  }
  const tf: string[] = [];
  const m = matrixAttr(el);
  if (m) tf.push(m);
  if (Math.abs(hscale - 1) > 1e-6) tf.push(`matrix(${r2(hscale)} 0 0 1 0 0)`);
  page.counts.text++;
  page.objects.push({
    kind: 'text',
    detail: snippet.replace(/\s+/g, ' ').trim().slice(0, 34) || '（空文本）',
  });
  return `<g${tf.length ? ` transform="${tf.join(' ')}"` : ''} font-family="${esc(
    family,
  )}" font-size="${r2(size)}" font-weight="${weight}" fill="${fill}">${inner}</g>`;
}

function renderPathObject(el: Element, ctx: Ctx, page: OfdPage): string {
  const { d, segs } = abbrevToD(el.getAttribute('AbbreviatedData') || '');
  if (!d) return '';
  const lineWidth = num(el.getAttribute('LineWidth'), 0.353);
  const stroke = colorOf(kid(el, 'StrokeColor'), ctx);
  const fill = colorOf(kid(el, 'FillColor'), ctx);
  const dash = (el.getAttribute('DashPattern') || '').trim();
  const join = (el.getAttribute('Join') || '').toLowerCase();
  const cap = (el.getAttribute('Cap') || '').toLowerCase();
  const rule = el.getAttribute('Rule') === 'EOFill' ? ' fill-rule="evenodd"' : '';
  const attrs: string[] = [];
  attrs.push(fill ? `fill="${fill}"` : 'fill="none"');
  if (el.getAttribute('Stroke') !== 'false') {
    attrs.push(`stroke="${stroke || 'rgba(0,0,0,1)'}"`, `stroke-width="${r2(lineWidth)}"`);
    if (dash) attrs.push(`stroke-dasharray="${esc(dash)}"`);
    if (join) attrs.push(`stroke-linejoin="${join}"`);
    if (cap) attrs.push(`stroke-linecap="${cap}"`);
  }
  const m = matrixAttr(el);
  page.counts.path++;
  page.objects.push({ kind: 'path', detail: `${segs} 段路径指令` });
  return `<path d="${d}"${m ? ` transform="${m}"` : ''}${rule} ${attrs.join(' ')}/>`;
}

function renderImageObject(el: Element, ctx: Ctx, page: OfdPage): string {
  const rid = el.getAttribute('ResourceID') || '';
  const src = ctx.images.get(rid);
  const b = (el.getAttribute('Boundary') || '0 0 0 0').trim().split(/\s+/).map(Number);
  const x = b[0] || 0;
  const y = b[1] || 0;
  const w = b[2] || 0;
  const h = b[3] || 0;
  page.counts.image++;
  page.objects.push({ kind: 'image', detail: `位图资源 #${rid} · ${r2(w)} × ${r2(h)} mm` });
  if (!src || w <= 0 || h <= 0) return '';
  const m = matrixAttr(el);
  return `<image href="${src}" xlink:href="${src}" x="${r2(x)}" y="${r2(y)}" width="${r2(
    w,
  )}" height="${r2(h)}" preserveAspectRatio="none"${m ? ` transform="${m}"` : ''}/>`;
}

/* --------------------------- 资源装载 ------------------------------ */

async function loadResources(zip: JSZip, docDir: string, resPaths: string[], ctx: Ctx): Promise<void> {
  for (const rp of resPaths) {
    const f = resolveFile(zip, docDir, rp);
    if (!f) continue;
    let rootEl: Element;
    try {
      rootEl = xmlOf(await f.async('text'), rp);
    } catch {
      continue;
    }
    for (const fe of deep(rootEl, 'Font')) {
      const id = fe.getAttribute('ID') || '';
      const family = (fe.getAttribute('FamilyName') || kid(fe, 'FamilyName')?.textContent || '').trim();
      const name = (fe.getAttribute('FontName') || kid(fe, 'FontName')?.textContent || '').trim();
      ctx.fonts.set(id, { id, family, name });
    }
    for (const cs of deep(rootEl, 'ColorSpace')) {
      const id = cs.getAttribute('ID') || '';
      const pal = kid(cs, 'Palette');
      if (pal) {
        const values: string[] = [];
        for (let i = 0; i < pal.children.length; i++) {
          if (pal.children[i].localName === 'CVValue') values.push((pal.children[i].textContent || '').trim());
        }
        ctx.palettes.set(id, values);
      }
    }
    for (const mm of deep(rootEl, 'MultiMedia')) {
      if ((mm.getAttribute('Type') || '') !== 'Image') continue;
      const id = mm.getAttribute('ID') || '';
      const path = (kid(mm, 'MediaFile')?.textContent || '').trim();
      if (!path) continue;
      if (path.startsWith('data:')) {
        ctx.images.set(id, path);
        continue;
      }
      const imgFile = resolveFile(zip, docDir, path);
      if (!imgFile) continue;
      const b64 = await imgFile.async('base64');
      const fmt = (mm.getAttribute('Format') || path.split('.').pop() || 'png').toLowerCase();
      const mime =
        fmt === 'jpg' || fmt === 'jpeg' ? 'image/jpeg' : fmt === 'gif' ? 'image/gif' : fmt === 'bmp' ? 'image/bmp' : 'image/png';
      ctx.images.set(id, `data:${mime};base64,${b64}`);
    }
  }
}

/* ---------------------------- 主入口 ------------------------------- */

export async function parseOfd(file: File): Promise<OfdResult> {
  const t0 = performance.now();
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new OfdError('无法将文件解压为 ZIP 容器——它可能不是 OFD 文件。');
  }

  const rootEntry = zip.file(/(^|\/)OFD\.xml$/i)[0];
  if (!rootEntry) throw new OfdError('压缩包中找不到 OFD.xml 入口，不是有效的 OFD 包。');

  const rootEl = xmlOf(await rootEntry.async('text'), 'OFD.xml');
  const docBody = kid(rootEl, 'DocBody');
  if (!docBody) throw new OfdError('OFD.xml 中缺少 DocBody 节点。');

  const meta: Record<string, string> = {};
  const info = kid(docBody, 'DocInfo');
  if (info) {
    for (let i = 0; i < info.children.length; i++) {
      const c = info.children[i];
      const v = (c.textContent || '').trim();
      if (v) meta[c.localName] = v;
    }
  }

  const docEntry = (kid(docBody, 'DocRoot')?.textContent || 'Doc_0/Document.xml').trim();
  const docFile = resolveFile(zip, '', docEntry);
  if (!docFile) throw new OfdError(`找不到文档定义文件 ${docEntry}。`);
  const docDir = docEntry.includes('/') ? docEntry.slice(0, docEntry.lastIndexOf('/') + 1) : '';
  const docEl = xmlOf(await docFile.async('text'), docEntry);

  const common = kid(docEl, 'CommonData');
  if (!common) throw new OfdError('Document.xml 缺少 CommonData，无法确定页面区域。');
  const box = (kid(kid(common, 'PageArea'), 'PhysicalBox')?.textContent || '0 0 210 297')
    .trim()
    .split(/\s+/)
    .map(Number);
  const defW = box[2] || 210;
  const defH = box[3] || 297;

  const resPaths: string[] = [];
  for (const name of ['PublicRes', 'DocumentRes']) {
    const v = (kid(common, name)?.textContent || '').trim();
    if (v) resPaths.push(v);
  }

  const ctx: Ctx = { zip, docDir, fonts: new Map(), palettes: new Map(), images: new Map() };
  await loadResources(zip, docDir, resPaths, ctx);

  const pagesEl = kid(docEl, 'Pages');
  if (!pagesEl) throw new OfdError('Document.xml 中没有页树（Pages）。');

  const pages: OfdPage[] = [];
  for (const pageEl of deep(pagesEl, 'Page')) {
    const baseLoc = (pageEl.getAttribute('BaseLoc') || '').trim();
    if (!baseLoc) continue;
    const pf = resolveFile(zip, docDir, baseLoc);
    if (!pf) continue;
    let pageRoot: Element;
    try {
      pageRoot = xmlOf(await pf.async('text'), baseLoc);
    } catch {
      continue;
    }
    const pb = (kid(kid(pageRoot, 'Area'), 'PhysicalBox')?.textContent || '').trim().split(/\s+/).map(Number);
    const w = pb[2] || defW;
    const h = pb[3] || defH;
    const page: OfdPage = { width: w, height: h, svg: '', objects: [], counts: { text: 0, path: 0, image: 0 } };
    const parts: string[] = [];
    for (const layer of deep(pageRoot, 'Layer')) {
      for (let i = 0; i < layer.children.length; i++) {
        const o = layer.children[i];
        try {
          if (o.localName === 'TextObject') parts.push(renderTextObject(o, ctx, page));
          else if (o.localName === 'PathObject') parts.push(renderPathObject(o, ctx, page));
          else if (o.localName === 'ImageObject') parts.push(renderImageObject(o, ctx, page));
        } catch {
          /* 单个对象解析失败不中断整页 */
        }
      }
    }
    page.svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${r2(
      w,
    )} ${r2(h)}" style="background:#fff;display:block">${parts.join('')}</svg>`;
    pages.push(page);
  }
  if (pages.length === 0) throw new OfdError('未能从文档中解析出任何页面。');

  const keys = Object.keys(zip.files).sort();
  const zipEntries: ZipEntryInfo[] = keys.map((k) => ({ path: k, size: 0, dir: zip.files[k].dir }));
  if (keys.length <= 120) {
    await Promise.all(
      keys.map(async (k, i) => {
        const e = zip.files[k];
        if (e.dir) return;
        try {
          zipEntries[i].size = (await e.async('uint8array')).byteLength;
        } catch {
          /* 忽略 */
        }
      }),
    );
  }

  return {
    fileName: file.name,
    fileSize: file.size,
    pages,
    meta,
    fonts: Array.from(ctx.fonts.values()),
    zipEntries,
    docEntry,
    parseMs: performance.now() - t0,
    imageCount: ctx.images.size,
  };
}
