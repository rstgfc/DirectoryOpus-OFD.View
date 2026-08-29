import JSZip from 'jszip';

/* 现场生成一份结构完整、可被本预览台解析的示例 OFD（仿红头公文，双页） */

const NS = 'xmlns:ofd="http://www.ofdspec.org/2016"';

function sealImage(): string {
  const c = document.createElement('canvas');
  c.width = 220;
  c.height = 220;
  const g = c.getContext('2d');
  if (!g) return '';
  const red = '#c2402f';
  g.clearRect(0, 0, 220, 220);
  g.strokeStyle = red;
  g.fillStyle = red;
  g.lineWidth = 11;
  g.beginPath();
  g.arc(110, 110, 96, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const x = 110 + Math.cos(a) * 38;
    const y = 104 + Math.sin(a) * 38;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
    const b = a + Math.PI / 5;
    g.lineTo(110 + Math.cos(b) * 16, 104 + Math.sin(b) * 16);
  }
  g.closePath();
  g.fill();
  g.font = '700 27px "Noto Sans SC", sans-serif';
  g.textAlign = 'center';
  g.fillText('OFD 预览台', 110, 172);
  return c.toDataURL('image/png');
}

const text = (
  id: number,
  font: string,
  size: number,
  x: number,
  y: number,
  str: string,
  color?: string,
): string =>
  `<ofd:TextObject ID="${id}" Boundary="0 0 210 297" Font="${font}" Size="${size}">` +
  (color ? `<ofd:StrokeColor Value="${color}"/>` : '') +
  `<ofd:TextCode X="${x}" Y="${y}">${str}</ofd:TextCode></ofd:TextObject>`;

const path = (id: number, d: string, color: string, width: number, fill = false): string =>
  `<ofd:PathObject ID="${id}" Boundary="0 0 210 297" LineWidth="${width}"${fill ? ' Stroke="false"' : ''}>` +
  (fill ? `<ofd:FillColor Value="${color}"/>` : `<ofd:StrokeColor Value="${color}"/>`) +
  `<ofd:AbbreviatedData>${d}</ofd:AbbreviatedData></ofd:PathObject>`;

function buildXml(): Record<string, string> {
  const today = new Date().toISOString().slice(0, 10);
  const RED = '194 63 47';
  const INK = '16 29 46';
  const GRAY = '51 71 95';

  const ofdXml = `<?xml version="1.0" encoding="UTF-8"?>
<ofd:OFD ${NS} Version="1.0" DocType="OFD">
  <ofd:DocBody>
    <ofd:DocInfo>
      <ofd:DocID>ofd-inspector-demo-2026</ofd:DocID>
      <ofd:CreationDate>${today}</ofd:CreationDate>
      <ofd:Title>OFD 版式文件示例（仿公文）</ofd:Title>
      <ofd:Subject>版式对象演示</ofd:Subject>
      <ofd:Author>OFD 版式预览台</ofd:Author>
      <ofd:Creator>OFD Inspector Demo Generator</ofd:Creator>
      <ofd:CreatorVersion>1.0</ofd:CreatorVersion>
      <ofd:Keywords>OFD,版式文件,GB/T 33190,Directory Opus</ofd:Keywords>
    </ofd:DocInfo>
    <ofd:DocRoot>Doc_0/Document.xml</ofd:DocRoot>
  </ofd:DocBody>
</ofd:OFD>`;

  const docXml = `<?xml version="1.0" encoding="UTF-8"?>
<ofd:Document ${NS}>
  <ofd:CommonData>
    <ofd:MaxUnitID>99</ofd:MaxUnitID>
    <ofd:PageArea><ofd:PhysicalBox>0 0 210 297</ofd:PhysicalBox></ofd:PageArea>
    <ofd:PublicRes>Res/PublicRes.xml</ofd:PublicRes>
  </ofd:CommonData>
  <ofd:Pages>
    <ofd:Page ID="1" BaseLoc="Pages/Page_0/Content.xml"/>
    <ofd:Page ID="2" BaseLoc="Pages/Page_1/Content.xml"/>
  </ofd:Pages>
</ofd:Document>`;

  const resXml = `<?xml version="1.0" encoding="UTF-8"?>
<ofd:Res ${NS}>
  <ofd:Fonts>
    <ofd:Font ID="4" FontName="宋体" FamilyName="宋体"/>
    <ofd:Font ID="5" FontName="黑体" FamilyName="黑体"/>
  </ofd:Fonts>
  <ofd:MultiMedias>
    <ofd:MultiMedia ID="7" Type="Image" Format="PNG"><ofd:MediaFile>Data/Img_0.png</ofd:MediaFile></ofd:MultiMedia>
  </ofd:MultiMedias>
</ofd:Res>`;

  const page0 = `<?xml version="1.0" encoding="UTF-8"?>
<ofd:Page ${NS}>
  <ofd:Area><ofd:PhysicalBox>0 0 210 297</ofd:PhysicalBox></ofd:Area>
  <ofd:Content>
    <ofd:Layer ID="3" Type="Body">
      ${text(10, '5', 18, 15, 34, '版式文件在线预览示例', RED)}
      ${path(11, 'M 20 44 L 190 44', RED, 1.1)}
      ${path(12, 'M 20 46.4 L 190 46.4', RED, 0.35)}
      ${text(13, '4', 4, 74, 57, 'OFD 预览台发〔2026〕1 号', GRAY)}
      ${text(14, '4', 5.6, 26.6, 82, '各浏览器、各文件管理器：')}
      ${text(15, '4', 5.6, 26.6, 96, '这是一份符合 GB/T 33190-2016 的版式文件示例，')}
      ${text(16, '4', 5.6, 26.6, 108, '由 OFD 预览台在浏览器中即时生成，用于演示文本、')}
      ${text(17, '4', 5.6, 26.6, 120, '路径与图像等版式对象的解析与渲染效果。OFD 采用')}
      ${text(18, '4', 5.6, 26.6, 132, 'ZIP 容器封装 XML 描述，天然适合长期保存与交换。')}
      ${text(19, '5', 5.6, 26.6, 156, '一、为什么需要版式文件')}
      ${text(20, '4', 5.6, 26.6, 170, '版式文件保证文档在任何设备上呈现一致的版面，')}
      ${text(21, '4', 5.6, 26.6, 182, '广泛用于电子公文、电子发票、电子证照等场景，')}
      ${text(22, '4', 5.6, 26.6, 194, '是与 PDF 并行的国家标准长期保存格式。')}
      <ofd:ImageObject ID="23" ResourceID="7" Boundary="126 200 48 48"/>
      ${text(24, '4', 4.5, 140, 224, 'OFD 预览台（示范）')}
      ${text(25, '4', 4.5, 150, 236, `${today.slice(0, 4)} 年 ${+today.slice(5, 7)} 月`)}
      ${text(26, '4', 3.5, 100, 283, '— 1 —', GRAY)}
    </ofd:Layer>
  </ofd:Content>
</ofd:Page>`;

  const tableFrame =
    'M 30 45 L 180 45 L 180 135 L 30 135 Z M 95 45 L 95 135 M 30 63 L 180 63 M 30 81 L 180 81 M 30 99 L 180 99 M 30 117 L 180 117';

  const page1 = `<?xml version="1.0" encoding="UTF-8"?>
<ofd:Page ${NS}>
  <ofd:Area><ofd:PhysicalBox>0 0 210 297</ofd:PhysicalBox></ofd:Area>
  <ofd:Content>
    <ofd:Layer ID="4" Type="Body">
      ${text(30, '5', 8, 62, 30, '附件：OFD 包结构速览', INK)}
      ${path(31, tableFrame, GRAY, 0.3)}
      ${text(32, '5', 4, 49, 56, '包内文件')}
      ${text(33, '5', 4, 130, 56, '作用')}
      ${text(34, '4', 3.4, 33, 74, 'OFD.xml')}
      ${text(35, '4', 3.4, 98, 74, '包入口，指向 Document.xml')}
      ${text(36, '4', 3.4, 33, 92, 'Document.xml')}
      ${text(37, '4', 3.4, 98, 92, '页面区域、资源引用与页树')}
      ${text(38, '4', 3.4, 33, 110, 'Pages/Page_N/Content.xml')}
      ${text(39, '4', 3.4, 98, 110, '文本 / 路径 / 图像对象')}
      ${text(40, '4', 3.4, 33, 128, 'Res/PublicRes.xml')}
      ${text(41, '4', 3.4, 98, 128, '字体、颜色等公共资源')}
      ${path(42, 'M 30 172 B 55 152 80 192 105 172 B 130 152 155 192 180 172', RED, 0.9)}
      ${path(43, 'M 30 214 L 58 214 L 44 196 Z', INK, 0.4, true)}
      ${text(44, '4', 3.5, 30, 228, '曲线由 B（三次贝塞尔）指令绘制；三角形为纯填充路径（Stroke=false）。')}
      ${text(45, '4', 3.5, 30, 240, '表格线条由单个 PathObject 的多段子路径一次绘成。')}
      ${text(46, '4', 3.5, 100, 283, '— 2 —', GRAY)}
    </ofd:Layer>
  </ofd:Content>
</ofd:Page>`;

  return {
    'OFD.xml': ofdXml,
    'Doc_0/Document.xml': docXml,
    'Doc_0/Res/PublicRes.xml': resXml,
    'Doc_0/Pages/Page_0/Content.xml': page0,
    'Doc_0/Pages/Page_1/Content.xml': page1,
  };
}

export async function buildSampleOfd(): Promise<File> {
  try {
    await document.fonts.ready;
  } catch {
    /* 字体未就绪也可继续 */
  }
  const zip = new JSZip();
  const seal = sealImage().split(',')[1];
  if (seal) zip.file('Doc_0/Data/Img_0.png', seal, { base64: true });
  const files = buildXml();
  for (const k of Object.keys(files)) zip.file(k, files[k]);
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], '示例公文.ofd', { type: 'application/zip' });
}
