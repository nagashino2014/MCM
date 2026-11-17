/*
 * 최소 PPTX(PowerPoint) 작성기 — 서버 전용. 회사소개서 PPT 받기(사용자 요청 2026-11-17)용.
 *   슬라이드 = 꽉 찬 그림 한 장(그림형) 또는 바탕 그림 + 글상자(갑지 편집형). 도형·표·애니메이션은 없다.
 *   단위는 pt(1pt = 12700 EMU). 슬라이드 크기는 쪽 크기 그대로(A4 가로 842×596pt 등).
 *   새 라이브러리 없이 jszip 으로 OOXML(PresentationML) 최소 부품을 쓴다 — 테마·마스터·레이아웃 1개씩.
 */
import JSZip from "jszip";

export interface PptxRun {
  text: string;
  /** 서체 이름(PowerPoint 가 찾는 이름 — 예: "Pretendard SemiBold") */
  font: string;
  /** pt */
  size: number;
  bold?: boolean;
  italic?: boolean;
  /** "RRGGBB" */
  color: string;
  /** 0~1(1 = 불투명) */
  alpha?: number;
  /** 자간 pt */
  spacing?: number;
}

export interface PptxParagraph {
  runs: PptxRun[];
  align?: "l" | "ctr" | "r";
  /** 줄 간격(pt, 정확히) — 없으면 한 줄(100%) */
  lineSpacingPt?: number;
}

export interface PptxTextBox {
  /** pt — 상자 왼쪽 위 */
  x: number;
  y: number;
  w: number;
  h: number;
  paragraphs: PptxParagraph[];
  name?: string;
}

export interface PptxPicture {
  x: number;
  y: number;
  w: number;
  h: number;
  data: Buffer;
  /** "png" | "jpeg" */
  type: "png" | "jpeg";
  name?: string;
  /** 그림 설명(대체 글) */
  descr?: string;
  /** 잠금(선택·이동 막기) — 바탕 그림 */
  locked?: boolean;
}

export interface PptxSlide {
  pictures?: PptxPicture[];
  texts?: PptxTextBox[];
  /** 숨긴 슬라이드(쇼에서 건너뜀) */
  hidden?: boolean;
  /** 슬라이드 노트 대신 쓰는 이름(파일 안 제목) */
  title?: string;
}

export interface PptxDocument {
  /** pt */
  width: number;
  height: number;
  title?: string;
  author?: string;
  slides: PptxSlide[];
}

const EMU = 12700;
const emu = (pt: number) => Math.round(pt * EMU);
const esc = (s: string) =>
  s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const NS_R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const NS_P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function runXml(r: PptxRun): string {
  const attrs = [`lang="ko-KR"`, `altLang="en-US"`, `sz="${Math.max(100, Math.round(r.size * 100))}"`, `b="${r.bold ? 1 : 0}"`, `i="${r.italic ? 1 : 0}"`, `dirty="0"`];
  if (r.spacing && Math.abs(r.spacing) >= 0.01) attrs.push(`spc="${Math.round(r.spacing * 100)}"`);
  const alpha = r.alpha != null && r.alpha < 1 ? `<a:alpha val="${Math.max(0, Math.round(r.alpha * 100000))}"/>` : "";
  const font = esc(r.font);
  return (
    `<a:r><a:rPr ${attrs.join(" ")}>` +
    `<a:solidFill><a:srgbClr val="${r.color}">${alpha}</a:srgbClr></a:solidFill>` +
    `<a:latin typeface="${font}"/><a:ea typeface="${font}"/><a:cs typeface="${font}"/>` +
    `</a:rPr><a:t>${esc(r.text)}</a:t></a:r>`
  );
}

function paragraphXml(p: PptxParagraph): string {
  const ln = p.lineSpacingPt ? `<a:lnSpc><a:spcPts val="${Math.round(p.lineSpacingPt * 100)}"/></a:lnSpc>` : `<a:lnSpc><a:spcPct val="100000"/></a:lnSpc>`;
  const first = p.runs[0];
  const end = first ? `<a:endParaRPr lang="ko-KR" sz="${Math.max(100, Math.round(first.size * 100))}" dirty="0"/>` : `<a:endParaRPr lang="ko-KR" dirty="0"/>`;
  return `<a:p><a:pPr algn="${p.align ?? "l"}">${ln}<a:spcBef><a:spcPts val="0"/></a:spcBef><a:spcAft><a:spcPts val="0"/></a:spcAft></a:pPr>${p.runs.map(runXml).join("")}${end}</a:p>`;
}

function textBoxXml(t: PptxTextBox, id: number): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(t.name ?? `글상자 ${id}`)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${emu(t.x)}" y="${emu(t.y)}"/><a:ext cx="${emu(Math.max(1, t.w))}" cy="${emu(Math.max(1, t.h))}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t" anchorCtr="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>` +
    t.paragraphs.map(paragraphXml).join("") +
    `</p:txBody></p:sp>`
  );
}

function pictureXml(p: PptxPicture, id: number, rid: string): string {
  const lock = p.locked ? `<a:picLocks noGrp="1" noSelect="1" noMove="1" noResize="1" noChangeAspect="1"/>` : `<a:picLocks noChangeAspect="1"/>`;
  return (
    `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(p.name ?? `그림 ${id}`)}" descr="${esc(p.descr ?? "")}"/><p:cNvPicPr>${lock}</p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    `<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
    `<p:spPr><a:xfrm><a:off x="${emu(p.x)}" y="${emu(p.y)}"/><a:ext cx="${emu(p.w)}" cy="${emu(p.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`
  );
}

const GROUP_FRAME =
  `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`;

const THEME =
  XML +
  `<a:theme ${NS_A} name="KESI"><a:themeElements>` +
  `<a:clrScheme name="KESI"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2A44"/></a:dk2><a:lt2><a:srgbClr val="EEF1F6"/></a:lt2>` +
  `<a:accent1><a:srgbClr val="1F6FB2"/></a:accent1><a:accent2><a:srgbClr val="4E9A2E"/></a:accent2><a:accent3><a:srgbClr val="7A7A7A"/></a:accent3><a:accent4><a:srgbClr val="B5651D"/></a:accent4>` +
  `<a:accent5><a:srgbClr val="6A4C93"/></a:accent5><a:accent6><a:srgbClr val="2F5FD0"/></a:accent6><a:hlink><a:srgbClr val="1F6FB2"/></a:hlink><a:folHlink><a:srgbClr val="6A4C93"/></a:folHlink></a:clrScheme>` +
  `<a:fontScheme name="KESI"><a:majorFont><a:latin typeface="Pretendard"/><a:ea typeface="Pretendard"/><a:cs typeface=""/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="Pretendard"/><a:ea typeface="Pretendard"/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
  `<a:fmtScheme name="KESI"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>` +
  `<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>` +
  `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
  `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>` +
  `</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;

const MASTER =
  XML +
  `<p:sldMaster ${NS_A} ${NS_R} ${NS_P}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GROUP_FRAME}</p:spTree></p:cSld>` +
  `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
  `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
  `<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;

const LAYOUT =
  XML +
  `<p:sldLayout ${NS_A} ${NS_R} ${NS_P} type="blank" preserve="1"><p:cSld name="빈 화면"><p:spTree>${GROUP_FRAME}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

/** PPTX 파일(바이트) */
export async function buildPptx(doc: PptxDocument): Promise<Buffer> {
  const zip = new JSZip();
  const media: Array<{ path: string; type: "png" | "jpeg" }> = [];
  const slideIds: string[] = [];
  const presRels: string[] = [`<Relationship Id="rId1" Type="${REL}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`];

  doc.slides.forEach((s, si) => {
    const n = si + 1;
    const rels: string[] = [`<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`];
    let shapeId = 2;
    const parts: string[] = [];
    for (const pic of s.pictures ?? []) {
      const ext = pic.type === "png" ? "png" : "jpeg";
      const file = `image${media.length + 1}.${ext}`;
      media.push({ path: file, type: pic.type });
      zip.file(`ppt/media/${file}`, pic.data, { compression: "STORE" });
      const rid = `rId${rels.length + 1}`;
      rels.push(`<Relationship Id="${rid}" Type="${REL}/image" Target="../media/${file}"/>`);
      parts.push(pictureXml(pic, shapeId++, rid));
    }
    for (const t of s.texts ?? []) parts.push(textBoxXml(t, shapeId++));
    zip.file(
      `ppt/slides/slide${n}.xml`,
      XML + `<p:sld ${NS_A} ${NS_R} ${NS_P}${s.hidden ? ' show="0"' : ""}><p:cSld${s.title ? ` name="${esc(s.title)}"` : ""}><p:spTree>${GROUP_FRAME}${parts.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
    );
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>`);
    const rid = `rId${n + 1}`;
    presRels.push(`<Relationship Id="${rid}" Type="${REL}/slide" Target="slides/slide${n}.xml"/>`);
    slideIds.push(`<p:sldId id="${255 + n}" r:id="${rid}"/>`);
  });
  const k = doc.slides.length + 2;
  presRels.push(
    `<Relationship Id="rId${k}" Type="${REL}/theme" Target="theme/theme1.xml"/>`,
    `<Relationship Id="rId${k + 1}" Type="${REL}/presProps" Target="presProps.xml"/>`,
    `<Relationship Id="rId${k + 2}" Type="${REL}/viewProps" Target="viewProps.xml"/>`,
    `<Relationship Id="rId${k + 3}" Type="${REL}/tableStyles" Target="tableStyles.xml"/>`
  );

  const types = [
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
    `<Default Extension="xml" ContentType="application/xml"/>`,
    ...(media.some((m) => m.type === "png") ? [`<Default Extension="png" ContentType="image/png"/>`] : []),
    ...(media.some((m) => m.type === "jpeg") ? [`<Default Extension="jpeg" ContentType="image/jpeg"/>`] : []),
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`,
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`,
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`,
    ...doc.slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`),
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`,
    `<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>`,
    `<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>`,
    `<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>`,
    `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>`,
    `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>`,
  ];
  zip.file("[Content_Types].xml", XML + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${types.join("")}</Types>`);
  zip.file(
    "_rels/.rels",
    XML +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
      `<Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/>` +
      `</Relationships>`
  );
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  zip.file(
    "docProps/core.xml",
    XML +
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${esc(doc.title ?? "")}</dc:title><dc:creator>${esc(doc.author ?? "")}</dc:creator>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`
  );
  zip.file(
    "docProps/app.xml",
    XML +
      `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">` +
      `<Application>MCM</Application><Slides>${doc.slides.length}</Slides><HiddenSlides>${doc.slides.filter((s) => s.hidden).length}</HiddenSlides></Properties>`
  );
  zip.file(
    "ppt/presentation.xml",
    XML +
      `<p:presentation ${NS_A} ${NS_R} ${NS_P} saveSubsetFonts="1">` +
      `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
      `<p:sldIdLst>${slideIds.join("")}</p:sldIdLst>` +
      `<p:sldSz cx="${emu(doc.width)}" cy="${emu(doc.height)}"/><p:notesSz cx="${emu(doc.height)}" cy="${emu(doc.width)}"/>` +
      `<p:defaultTextStyle><a:lvl1pPr><a:defRPr lang="ko-KR"/></a:lvl1pPr></p:defaultTextStyle></p:presentation>`
  );
  zip.file("ppt/_rels/presentation.xml.rels", XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${presRels.join("")}</Relationships>`);
  zip.file("ppt/presProps.xml", XML + `<p:presentationPr ${NS_A} ${NS_R} ${NS_P}/>`);
  zip.file("ppt/viewProps.xml", XML + `<p:viewPr ${NS_A} ${NS_R} ${NS_P}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="72008" cy="72008"/></p:viewPr>`);
  zip.file("ppt/tableStyles.xml", XML + `<a:tblStyleLst ${NS_A} def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`);
  zip.file("ppt/theme/theme1.xml", THEME);
  zip.file("ppt/slideMasters/slideMaster1.xml", MASTER);
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    XML +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
      `<Relationship Id="rId2" Type="${REL}/theme" Target="../theme/theme1.xml"/></Relationships>`
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", LAYOUT);
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`
  );
  // 그림(이미 압축된 형식)은 위에서 저장만(STORE), XML 은 DEFLATE
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
