// 제안서 HWPX 조판기 2.0 — 미리보기(ProposalPages)와 같은 디자인 토큰으로 문단·표를 직접 쓴다.
// · 글·표·카드·단계·큰 숫자·일정표·핵심 메시지는 문단과 표 셀 조합 → 한글에서 그대로 고칠 수 있다(ESG DS 결정 #14).
// · 장 머리띠(로마 숫자·장·절)는 머리말, 사업명·쪽 번호·회사명은 꼬리말. 절이 바뀌는 쪽마다 머리말을 새로 둔다.
// · 표지·간지의 면 장식만 글 뒤 그림(BEHIND_TEXT), 도식은 300dpi PNG + 편집 원본(문서 JSON)으로 보관.
// · 서식은 템플릿(letter.hwpx) 의 charPr/paraPr/borderFill 원형을 복제해 새 id 로 등록한다. 이름 붙은 문단 스타일
//   '제안-…' 을 함께 등록해 한글의 스타일 목록(F6)으로 같은 서식을 다시 쓸 수 있다.
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createHash } from "node:crypto";
import { escapeXml } from "@/lib/letter/hwpx";
import { COVER_ART_ID, DIVIDER_ART_ID } from "./art";
import { BULLET, BULLET_HANG, BULLET_LEFT, BULLET_SIZE, FONT, LINE, NEUTRAL, PAGE, PROPOSAL_DESIGN_VERSION, SPACE, TYPE, chaptersOf, mixWhite, paletteOf, parseRich, type ThemePalette } from "./design";
import { coverLines, dividerLines, physicalPages, tocEntries, type FlowLine } from "./layout";
import { materializeDocument } from "./materialize";
import { validatePngBytes } from "./png";
import { textWidth } from "./text";
import { optionsOf, type ProposalBlock, type ProposalDocument } from "./types";

const MM = 7200 / 25.4;
const PT = 100;
const BODY_W = Math.round((PAGE.width - PAGE.left - PAGE.right) * MM);
const hu = (pt: number) => Math.round(pt * PT);
/** 문단 여백(hc:intent·left·right·prev·next)은 한글이 값의 절반을 pt 로 쓴다(실측: 10000 → 50pt).
 *  줄바꿈: 한글 HWPX 의 breakNonLatinWord 는 이름과 반대 — KEEP_WORD = 글자 단위, BREAK_WORD = 어절 단위(실측). */
const huPara = (pt: number) => Math.round(pt * PT * 2);

// ── 서식 등록부 ──────────────────────────────────────────────────────────────
interface CharSpec { size: number; bold?: boolean; color?: string; spacing?: number; shade?: string }
interface ParaSpec { align?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFY"; left?: number; right?: number; indent?: number; before?: number; after?: number; line?: number; keepNext?: boolean; border?: string; offsetLeft?: number; offsetBottom?: number }
interface Side { type?: "SOLID" | "DOT" | "NONE"; width?: number; color?: string }
interface FillSpec { left?: Side; right?: Side; top?: Side; bottom?: Side; fill?: string }

class Styles {
  private cache = new Map<string, string>();
  private fontRef: string;
  constructor(public header: string) {
    const ref = (lang: string) => {
      const group = new RegExp(`<hh:fontface lang="${lang}"[\\s\\S]*?</hh:fontface>`).exec(header)?.[0] ?? "";
      return new RegExp(`<hh:font id="(\\d+)" face="${FONT.hwpx}"`).exec(group)?.[1] ?? "0";
    };
    const langs = { hangul: "HANGUL", latin: "LATIN", hanja: "HANJA", japanese: "JAPANESE", other: "OTHER", symbol: "SYMBOL", user: "USER" };
    this.fontRef = `<hh:fontRef ${Object.entries(langs).map(([k, v]) => `${k}="${ref(v)}"`).join(" ")}/>`;
  }
  private nextId(tag: string) { return Math.max(-1, ...[...this.header.matchAll(new RegExp(`<${tag}\\b[^>]*\\bid="(\\d+)"`, "g"))].map((m) => Number(m[1]))) + 1; }
  private append(listTag: string, xml: string) {
    this.header = this.header.replace(`</${listTag}>`, xml + `</${listTag}>`)
      .replace(new RegExp(`(<${listTag}\\b[^>]*itemCnt=")(\\d+)(")`), (_, a, n, c) => `${a}${Number(n) + 1}${c}`);
  }
  fill(f: FillSpec): string {
    const key = "f" + JSON.stringify(f);
    const hit = this.cache.get(key); if (hit) return hit;
    const id = String(this.nextId("hh:borderFill"));
    const side = (name: string, s?: Side) => `<hh:${name}Border type="${s?.type ?? "NONE"}" width="${(s?.width ?? 0.12).toFixed(2)} mm" color="${s?.color ?? "#000000"}"/>`;
    this.append("hh:borderFills", `<hh:borderFill id="${id}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0"><hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>` +
      side("left", f.left) + side("right", f.right) + side("top", f.top) + side("bottom", f.bottom) + `<hh:diagonal type="NONE" width="0.1 mm" color="#000000"/>` +
      (f.fill ? `<hc:fillBrush><hc:winBrush faceColor="${f.fill}" hatchColor="#000000" alpha="0"/></hc:fillBrush>` : "") + `</hh:borderFill>`);
    this.cache.set(key, id); return id;
  }
  char(c: CharSpec): string {
    const key = "c" + JSON.stringify(c);
    const hit = this.cache.get(key); if (hit) return hit;
    const id = String(this.nextId("hh:charPr"));
    const sp = c.spacing ?? 0;
    this.append("hh:charProperties", `<hh:charPr id="${id}" height="${hu(c.size)}" textColor="${c.color ?? NEUTRAL.ink}" shadeColor="${c.shade ?? "none"}" useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="${this.fill({})}">` +
      this.fontRef + `<hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>` +
      `<hh:spacing hangul="${sp}" latin="${sp}" hanja="${sp}" japanese="${sp}" other="${sp}" symbol="${sp}" user="${sp}"/>` +
      `<hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/><hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>` +
      (c.bold ? "<hh:bold/>" : "") + `<hh:underline type="NONE" shape="SOLID" color="#000000"/><hh:strikeout shape="NONE" color="#000000"/><hh:outline type="NONE"/><hh:shadow type="NONE" color="#B2B2B2" offsetX="10" offsetY="10"/></hh:charPr>`);
    this.cache.set(key, id); return id;
  }
  para(p: ParaSpec): string {
    const key = "p" + JSON.stringify(p);
    const hit = this.cache.get(key); if (hit) return hit;
    const id = String(this.nextId("hh:paraPr"));
    this.append("hh:paraProperties", `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="0" suppressLineNumbers="0" checked="0">` +
      `<hh:align horizontal="${p.align ?? "JUSTIFY"}" vertical="BASELINE"/><hh:heading type="NONE" idRef="0" level="0"/>` +
      `<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widowOrphan="0" keepWithNext="${p.keepNext ? 1 : 0}" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>` +
      `<hh:autoSpacing eAsianEng="0" eAsianNum="0"/><hh:margin><hc:intent value="${huPara(p.indent ?? 0)}" unit="HWPUNIT"/><hc:left value="${huPara(p.left ?? 0)}" unit="HWPUNIT"/>` +
      `<hc:right value="${huPara(p.right ?? 0)}" unit="HWPUNIT"/><hc:prev value="${huPara(p.before ?? 0)}" unit="HWPUNIT"/><hc:next value="${huPara(p.after ?? 0)}" unit="HWPUNIT"/></hh:margin>` +
      `<hh:lineSpacing type="PERCENT" value="${p.line ?? LINE.body}" unit="HWPUNIT"/>` +
      `<hh:border borderFillIDRef="${p.border ?? this.fill({})}" offsetLeft="${hu(p.offsetLeft ?? 0)}" offsetRight="0" offsetTop="0" offsetBottom="${hu(p.offsetBottom ?? 0)}" connect="0" ignoreMargin="0"/></hh:paraPr>`);
    this.cache.set(key, id); return id;
  }
  /** 이름 붙은 문단 스타일 — 같은 이름이면 한 번만 등록 */
  style(name: string, paraId: string, charId: string): string {
    const key = "s" + name;
    const hit = this.cache.get(key); if (hit) return hit;
    const id = String(this.nextId("hh:style"));
    this.append("hh:styles", `<hh:style id="${id}" type="PARA" name="${escapeXml(name)}" engName="" paraPrIDRef="${paraId}" charPrIDRef="${charId}" nextStyleIDRef="${id}" langID="1042" lockForm="0"/>`);
    this.cache.set(key, id); return id;
  }
}

// ── XML 조각 ─────────────────────────────────────────────────────────────────
type Run = { char: string; text?: string; xml?: string };
const runXml = (r: Run) => `<hp:run charPrIDRef="${r.char}">${r.xml ?? ""}${r.text !== undefined ? `<hp:t>${escapeXml(r.text)}</hp:t>` : ""}</hp:run>`;
const pXml = (para: string, runs: Run[], o: { pageBreak?: boolean; style?: string } = {}) =>
  `<hp:p id="0" paraPrIDRef="${para}" styleIDRef="${o.style ?? "0"}" pageBreak="${o.pageBreak ? 1 : 0}" columnBreak="0" merged="0">${runs.map(runXml).join("") || '<hp:run charPrIDRef="0"/>'}</hp:p>`;

interface Cell { paras: string; fill: string; w: number; h: number; valign?: "TOP" | "CENTER"; header?: boolean; margin?: [number, number, number, number] }
let objId = 1_000_000;
function tableXml(rows: Cell[][], o: { fill: string; spacing?: number; after?: number; before?: number; repeatHeader?: boolean }): string {
  const colCnt = rows[0].length;
  const width = rows[0].reduce((s, c) => s + c.w, 0) + (o.spacing ?? 0) * (colCnt + 1);
  const height = rows.reduce((s, r) => s + Math.max(...r.map((c) => c.h)), 0);
  const tr = rows.map((r, ri) => `<hp:tr>${r.map((c, ci) => {
    const [ml, mr, mt, mb] = c.margin ?? [hu(SPACE.cellX), hu(SPACE.cellX), hu(SPACE.cellY), hu(SPACE.cellY)];
    return `<hp:tc name="" header="${c.header ? 1 : 0}" hasMargin="1" protect="0" editable="0" dirty="0" borderFillIDRef="${c.fill}">` +
      `<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="${c.valign ?? "CENTER"}" linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">${c.paras}</hp:subList>` +
      `<hp:cellAddr colAddr="${ci}" rowAddr="${ri}"/><hp:cellSpan colSpan="1" rowSpan="1"/><hp:cellSz width="${c.w}" height="${Math.max(...r.map((x) => x.h))}"/>` +
      `<hp:cellMargin left="${ml}" right="${mr}" top="${mt}" bottom="${mb}"/></hp:tc>`;
  }).join("")}</hp:tr>`).join("");
  return `<hp:tbl id="${objId++}" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="${o.repeatHeader ? 1 : 0}" rowCnt="${rows.length}" colCnt="${colCnt}" cellSpacing="${o.spacing ?? 0}" borderFillIDRef="${o.fill}" noAdjust="0">` +
    `<hp:sz width="${width}" widthRelTo="ABSOLUTE" height="${height}" heightRelTo="ABSOLUTE" protect="0"/>` +
    `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>` +
    `<hp:outMargin left="0" right="0" top="${hu(o.before ?? 0)}" bottom="${hu(o.after ?? 0)}"/><hp:inMargin left="${hu(5)}" right="${hu(5)}" top="${hu(3.5)}" bottom="${hu(3.5)}"/>${tr}</hp:tbl>`;
}

function picXml(binaryId: string, wHu: number, hHu: number, pxW: number, pxH: number, title: string, behind: boolean): string {
  const id = objId++;
  const pos = behind
    ? '<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PAPER" horzRelTo="PAPER" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>'
    : '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="CENTER" vertOffset="0" horzOffset="0"/>';
  return `<hp:pic id="${id}" zOrder="${behind ? 0 : 1}" numberingType="PICTURE" textWrap="${behind ? "BEHIND_TEXT" : "TOP_AND_BOTTOM"}" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${id}" reverse="0">` +
    `<hp:offset x="0" y="0"/><hp:orgSz width="${wHu}" height="${hHu}"/><hp:curSz width="${wHu}" height="${hHu}"/><hp:flip horizontal="0" vertical="0"/>` +
    `<hp:rotationInfo angle="0" centerX="${Math.round(wHu / 2)}" centerY="${Math.round(hHu / 2)}" rotateimage="1"/>` +
    '<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>' +
    `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${wHu}" y="0"/><hc:pt2 x="${wHu}" y="${hHu}"/><hc:pt3 x="0" y="${hHu}"/></hp:imgRect>` +
    // ESG 실측: imgClip 은 픽셀 × 75 HWPUNIT 이어야 그림 전체가 보인다.
    `<hp:imgClip left="0" right="${pxW * 75}" top="0" bottom="${pxH * 75}"/><hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
    `<hc:img binaryItemIDRef="${binaryId}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/><hp:effects/>` +
    `<hp:sz width="${wHu}" widthRelTo="ABSOLUTE" height="${hHu}" heightRelTo="ABSOLUTE" protect="0"/>${pos}` +
    `<hp:outMargin left="0" right="0" top="0" bottom="0"/><hp:shapeComment>${escapeXml(title)}</hp:shapeComment></hp:pic>`;
}

async function imageBytes(dataUrl: string) {
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(dataUrl) || dataUrl.length > 12_000_000) throw new Error("앱에서 변환한 PNG·JPEG 그림만 발행할 수 있습니다.");
  const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
  if (dataUrl.startsWith("data:image/png")) validatePngBytes(bytes);
  const image = await loadImage(bytes);
  if (!image.width || !image.height || image.width * image.height > 36_000_000) throw new Error("그림 크기가 허용 범위를 벗어났습니다.");
  // 재인코딩으로 EXIF 등 메타데이터를 지우고 PNG 로 정규화한다.
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext("2d").drawImage(image, 0, 0);
  return { bytes: canvas.toBuffer("image/png"), width: image.width, height: image.height };
}

/** 셀 높이 추정(HWPUNIT) — 한글이 열 때 다시 계산하므로 최소값 용도. */
function estH(texts: Array<{ text: string; size: number }>, widthHu: number, padV = 7): number {
  const avail = Math.max(20, widthHu / PT - 10);
  const lines = texts.reduce((s, t) => s + t.text.split("\n").reduce((a, line) => a + Math.max(1, Math.ceil(textWidth(line, t.size) / avail)), 0) * t.size * 1.4, 0);
  return hu(lines + padV);
}

// ── 본 렌더 ──────────────────────────────────────────────────────────────────
export async function renderProposalHwpx(sourceDocument: ProposalDocument, figures: Record<string, string>): Promise<Uint8Array> {
  const doc = materializeDocument(sourceDocument);
  const pal: ThemePalette = paletteOf(doc);
  const opts = optionsOf(doc);
  const chapters = chaptersOf(doc);
  const zip = await JSZip.loadAsync(await readFile(path.join(process.cwd(), "public/hwpx/letter.hwpx")));
  const tplSection = await zip.file("Contents/section0.xml")!.async("string");
  let manifest = await zip.file("Contents/content.hpf")!.async("string");
  const st = new Styles(await zip.file("Contents/header.xml")!.async("string"));

  const color = (tone: FlowLine["tone"]) => ({ p1: pal.primary, ink: NEUTRAL.ink, ink2: NEUTRAL.ink2, mu: NEUTRAL.muted, white: "#FFFFFF", tint: pal.tint }[tone]);
  const C = (size: number, bold = false, c: string = NEUTRAL.ink, spacing = 0) => st.char({ size, bold, color: c, spacing });
  const P = (p: ParaSpec) => st.para(p);
  const none = st.fill({});
  const solid = (w: number, c: string): Side => ({ type: "SOLID", width: w, color: c });
  const ruleSide = solid(0.12, NEUTRAL.rule);

  // 이름 붙은 스타일(한글 F6 목록) — 본문·글머리·제목
  const S = {
    body: st.style("제안-본문", P({ after: 4 }), C(TYPE.body)),
    b1: st.style("제안-글머리1", P({ left: BULLET_LEFT[1], indent: -BULLET_HANG["○"], after: 1 }), C(BULLET_SIZE[1])),
    b2: st.style("제안-글머리2", P({ left: BULLET_LEFT[2], indent: -BULLET_HANG["-"], after: 1 }), C(BULLET_SIZE[2], false, NEUTRAL.ink2)),
    b3: st.style("제안-글머리3", P({ left: BULLET_LEFT[3], indent: -BULLET_HANG["·"], after: 1 }), C(BULLET_SIZE[3], false, NEUTRAL.ink2)),
  };

  /** 굵게(**…**) 를 주색 굵은 글자 런으로 */
  const richRuns = (text: string, size: number, base: string, baseBold = false): Run[] =>
    parseRich(text).map((r) => ({ char: r.strong ? C(size, true, pal.primary) : C(size, baseBold, base), text: r.text }));
  const cellPara = (text: string, o: { size?: number; bold?: boolean; color?: string; align?: ParaSpec["align"]; line?: number } = {}) => {
    const size = o.size ?? TYPE.table;
    return text.split("\n").map((line) => pXml(P({ align: o.align ?? "LEFT", line: o.line ?? LINE.table }), richRuns(line, size, o.color ?? NEUTRAL.ink, o.bold))).join("");
  };
  const wrapTable = (tbl: string) => pXml(P({ line: 100, after: 0 }), [{ char: C(1), xml: tbl, text: "" }]);

  // 이미지 바이너리
  const bindings: Array<{ id: string; binaryId: string; sha256: string }> = [];
  let imageNo = 1;
  const addImage = async (id: string, dataUrl: string) => {
    const img = await imageBytes(dataUrl);
    const binaryId = `proposal_image${imageNo++}`;
    const href = `BinData/${binaryId}.png`;
    zip.file(href, img.bytes);
    manifest = manifest.replace("</opf:manifest>", `<opf:item id="${binaryId}" href="${href}" media-type="image/png" isEmbeded="1"/></opf:manifest>`);
    bindings.push({ id, binaryId, sha256: createHash("sha256").update(img.bytes).digest("hex") });
    return { binaryId, ...img };
  };

  // 머리말·꼬리말
  const pageHide = '<hp:ctrl><hp:pageHiding hideHeader="1" hideFooter="1" hideMasterPage="0" hideBorder="0" hideFill="0" hidePageNum="1"/></hp:ctrl>';
  let hfId = 1;
  const headerCtrl = (roman: string, chapter: string, crumb: string) => {
    const wNo = Math.round(8 * MM), wCr = Math.round(70 * MM), wCh = BODY_W - wNo - wCr;
    const h = hu(17);
    const cells: Cell[] = [
      { w: wNo, h, fill: st.fill({ fill: pal.primary, bottom: solid(0.5, pal.primary) }), paras: cellPara(roman, { size: TYPE.header, bold: true, color: "#FFFFFF", align: "CENTER" }), margin: [hu(1), hu(1), hu(1), hu(1)] },
      { w: wCh, h, fill: st.fill({ bottom: solid(0.5, pal.primary) }), paras: cellPara(chapter, { size: TYPE.header, bold: true, color: pal.primary }), margin: [hu(7), hu(2), hu(1), hu(1)] },
      { w: wCr, h, fill: st.fill({ bottom: ruleSide }), paras: cellPara(crumb, { size: 8.5, color: NEUTRAL.muted, align: "RIGHT" }), margin: [hu(2), hu(1), hu(1), hu(1)] },
    ];
    return `<hp:ctrl><hp:header id="${hfId++}" applyPageType="BOTH"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" textWidth="${BODY_W}" textHeight="${Math.round(PAGE.header * MM)}" hasTextRef="0" hasNumRef="0">` +
      wrapTable(tableXml([cells], { fill: none })) + `</hp:subList></hp:header></hp:ctrl>`;
  };
  const footerCtrl = () => {
    const w3 = Math.round(BODY_W / 3);
    const h = hu(14);
    const top = st.fill({ top: ruleSide });
    const pageNum = `<hp:ctrl><hp:autoNum num="1" numType="PAGE"><hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar="" supscript="0"/></hp:autoNum></hp:ctrl>`;
    const pc = C(TYPE.footer, true, NEUTRAL.ink2);
    const cells: Cell[] = [
      { w: w3, h, fill: top, paras: cellPara(doc.projectName, { size: TYPE.footer, color: NEUTRAL.muted }), margin: [0, hu(2), hu(3), 0] },
      { w: BODY_W - w3 * 2, h, fill: top, paras: pXml(P({ align: "CENTER", line: LINE.table }), [{ char: pc, text: "- " }, { char: pc, xml: pageNum }, { char: pc, text: " -" }]), margin: [0, 0, hu(3), 0] },
      { w: w3, h, fill: top, paras: cellPara(doc.variables?.companyName || "", { size: TYPE.footer, bold: true, color: pal.primary, align: "RIGHT" }), margin: [hu(2), 0, hu(3), 0] },
    ];
    return `<hp:ctrl><hp:footer id="${hfId++}" applyPageType="BOTH"><hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="BOTTOM" linkListIDRef="0" linkListNextIDRef="0" textWidth="${BODY_W}" textHeight="${Math.round(PAGE.footer * MM)}" hasTextRef="0" hasNumRef="0">` +
      wrapTable(tableXml([cells], { fill: none })) + `</hp:subList></hp:footer></hp:ctrl>`;
  };

  // 글줄(표지·간지)
  const flowLine = (l: FlowLine, first: { pageBreak?: boolean; lead?: string } = {}) => {
    const c = C(l.size, l.bold, color(l.tone));
    const para = P({ align: l.align === "center" ? "CENTER" : "LEFT", before: l.before, line: 130, right: l.inset ?? 0, left: l.align === "center" ? l.inset ?? 0 : 0 });
    return pXml(para, [...(first.lead ? [{ char: c, xml: first.lead }] : []), { char: c, text: l.text }], { pageBreak: first.pageBreak });
  };

  // ── 블록 ──
  const figNo = new Map<string, number>();
  doc.sections.flatMap((s) => s.blocks).filter((b) => (b.kind === "figure" || b.kind === "diagram" || b.kind === "image") && b.title).forEach((b, i) => figNo.set(b.id, i + 1));

  const blockXml = async (b: ProposalBlock): Promise<string> => {
    switch (b.kind) {
      case "heading": {
        if (b.level === 1) return pXml(P({ before: SPACE.h1[0], after: SPACE.h1[1], line: 130, keepNext: true, border: st.fill({ bottom: solid(0.4, pal.primary) }), offsetBottom: 3 }), [{ char: C(TYPE.h1, true, pal.primary), text: b.text }]);
        if (b.level === 2) return pXml(P({ before: SPACE.h2[0], after: SPACE.h2[1], line: 130, keepNext: true, left: 7, border: st.fill({ left: solid(1, pal.primary2) }), offsetLeft: 7 }), [{ char: C(TYPE.h2, true), text: b.text }]);
        return pXml(P({ before: SPACE.h3[0], after: SPACE.h3[1], line: 140, keepNext: true }), [{ char: C(TYPE.h3, true, pal.primary), text: "□ " }, { char: C(TYPE.h3, true), text: b.text }]);
      }
      case "text":
        return b.text.split("\n").map((line) => pXml(P({ after: SPACE.text }), richRuns(line, TYPE.body, NEUTRAL.ink), { style: S.body })).join("");
      case "bullets":
        return b.items.map((it) => {
          const mk = it.mark ? BULLET[it.mark] : BULLET[it.level];
          const size = it.mark === "note" ? TYPE.note : BULLET_SIZE[it.level];
          const base = it.mark === "note" ? NEUTRAL.muted : it.mark === "result" ? pal.primary : it.level === 1 ? NEUTRAL.ink : NEUTRAL.ink2;
          const mkColor = it.mark === "result" || it.mark === "check" ? pal.accent : it.mark === "note" ? NEUTRAL.muted : it.level === 1 ? pal.primary : NEUTRAL.ink2;
          const para = P({ left: BULLET_LEFT[it.level], indent: -(BULLET_HANG[mk] ?? 10), after: SPACE.bullet });
          return pXml(para, [{ char: C(size, it.level === 1 || it.mark === "check" || it.mark === "result", mkColor), text: mk + " " }, ...richRuns(it.text, size, base, it.mark === "result")],
            { style: it.mark ? undefined : S[`b${it.level}` as "b1"] });
        }).join("");
      case "lead": {
        const runs = [...(b.label ? [{ char: st.char({ size: 8, bold: true, color: "#FFFFFF", shade: pal.primary }), text: ` ${b.label} ` }, { char: C(TYPE.lead), text: "  " }] : []), ...richRuns(b.text, TYPE.lead, pal.primary, true)];
        return wrapTable(tableXml([[{ w: BODY_W, h: estH([{ text: b.text, size: TYPE.lead }], BODY_W), fill: st.fill({ fill: pal.tint, left: solid(1, pal.primary) }), paras: pXml(P({ align: "LEFT", line: 145 }), runs), margin: [hu(10), hu(8), hu(7), hu(7)] }]], { fill: none, after: SPACE.leadAfter }));
      }
      case "callout": {
        const fill = b.variant === "point" ? st.fill({ fill: pal.tint2, top: solid(0.5, pal.accent) }) : st.fill({ fill: NEUTRAL.panel, left: ruleSide, right: ruleSide, top: ruleSide, bottom: ruleSide });
        const paras = pXml(P({ align: "LEFT", line: 140, after: 2 }), [{ char: C(TYPE.callout - 1, true, b.variant === "point" ? pal.accent : NEUTRAL.ink2), text: b.title }]) + cellPara(b.text, { size: TYPE.callout, line: 155 });
        return wrapTable(tableXml([[{ w: BODY_W, h: estH([{ text: b.title, size: TYPE.callout }, { text: b.text, size: TYPE.callout }], BODY_W), fill, paras, margin: [hu(10), hu(10), hu(7), hu(7)] }]], { fill: none, before: 4, after: SPACE.block }));
      }
      case "stage": {
        const wl = Math.round(Math.max(18, textWidth(b.label, TYPE.stage) / (MM / PT) + 8) * MM);
        const h = hu(22);
        return wrapTable(tableXml([[
          { w: wl, h, fill: st.fill({ fill: pal.primary }), paras: cellPara(b.label, { size: TYPE.stage, bold: true, color: "#FFFFFF", align: "CENTER" }), margin: [hu(8), hu(8), hu(4), hu(4)] },
          { w: BODY_W - wl, h, fill: st.fill({ fill: pal.tint }), paras: cellPara(b.text, { size: TYPE.stage, bold: true, color: pal.primary }), margin: [hu(9), hu(8), hu(4), hu(4)] },
        ]], { fill: none, before: 8, after: 9 }));
      }
      case "cards": {
        const gap = Math.round(2.5 * MM);
        const cols = b.columns;
        const w = Math.floor((BODY_W - gap * (cols + 1)) / cols);
        const rows: Cell[][] = [];
        for (let i = 0; i < b.items.length; i += cols) {
          const slice = b.items.slice(i, i + cols);
          const hMax = Math.max(...slice.map((it) => estH([{ text: it.title, size: TYPE.cardTitle }, { text: it.body, size: TYPE.cardBody }], w, 16)));
          rows.push(Array.from({ length: cols }, (_, k): Cell => {
            const it = slice[k];
            if (!it) return { w, h: hMax, fill: none, paras: pXml(P({}), []) };
            const c = b.multi && pal.series ? pal.series[(i + k) % 6] : undefined;
            const no = b.numbered ? pXml(P({ align: "LEFT", line: 120 }), [{ char: C(9, true, c ?? pal.accent), text: String(i + k + 1).padStart(2, "0") }]) : "";
            return {
              w, h: hMax, valign: "TOP", fill: st.fill({ fill: c ? mixWhite(c, 0.93) : pal.tint2, top: solid(0.6, c ?? (it.key ? pal.accent : pal.primary)) }),
              paras: no + pXml(P({ align: "LEFT", line: 130, after: 3 }), [{ char: C(TYPE.cardTitle, true, pal.primary), text: it.title }]) + cellPara(it.body, { size: TYPE.cardBody, color: NEUTRAL.ink2, line: 150 }),
              margin: [hu(SPACE.cardPad), hu(SPACE.cardPad), hu(SPACE.cardPad - 1), hu(SPACE.cardPad)],
            };
          }));
        }
        // 셀 간격(cellSpacing)으로 카드 사이를 띄운다 — 바깥 여백은 간격만큼 줄여 본문 폭에 맞춘다.
        return wrapTable(tableXml(rows, { fill: none, spacing: gap, before: 2, after: SPACE.block - 4 }));
      }
      case "steps": {
        const n = b.items.length;
        const arrowW = Math.round(4.2 * MM);
        const w = Math.floor((BODY_W - arrowW * (n - 1)) / n);
        const hHead = Math.max(...b.items.map((it) => estH([{ text: `00 ${it.title}`, size: TYPE.stepTitle }], w, 9)));
        const hBody = Math.max(...b.items.map((it) => estH([{ text: it.body, size: TYPE.stepBody }], w, 10)));
        const head: Cell[] = [], body: Cell[] = [];
        b.items.forEach((it, i) => {
          if (i) {
            head.push({ w: arrowW, h: hHead, fill: none, paras: cellPara("▶", { size: 9, color: pal.accent, align: "CENTER" }), margin: [0, 0, 0, 0] });
            body.push({ w: arrowW, h: hBody, fill: none, paras: pXml(P({}), []), margin: [0, 0, 0, 0] });
          }
          const sc = b.multi && pal.series ? pal.series[i % 6] : undefined;
          const hf = st.fill({ fill: sc ?? (i % 4 === 2 ? pal.primary2 : pal.primary) });
          head.push({ w, h: hHead, fill: hf, paras: pXml(P({ align: "LEFT", line: 130 }), [{ char: C(TYPE.stepTitle - 1, true, pal.tint), text: String(i + 1).padStart(2, "0") + "  " }, { char: C(TYPE.stepTitle, true, "#FFFFFF"), text: it.title }]), margin: [hu(SPACE.stepPad + 1), hu(SPACE.stepPad), hu(SPACE.stepPad), hu(SPACE.stepPad)] });
          body.push({ w, h: hBody, valign: "TOP", fill: st.fill({ fill: sc ? mixWhite(sc, 0.93) : pal.tint2 }), paras: cellPara(it.body, { size: TYPE.stepBody, color: NEUTRAL.ink2, line: 150 }), margin: [hu(SPACE.stepPad + 1), hu(SPACE.stepPad), hu(SPACE.stepPad), hu(SPACE.stepPad + 1)] });
        });
        return wrapTable(tableXml([head, body], { fill: none, before: 2, after: SPACE.block }));
      }
      case "kpis": {
        const gap = Math.round(3 * MM);
        const n = b.items.length;
        const w = Math.floor((BODY_W - gap * (n + 1)) / n);
        const cells = b.items.map((it): Cell => ({
          w, h: hu(46), fill: st.fill({ top: solid(0.6, pal.primary) }),
          paras: pXml(P({ align: "CENTER", line: 115 }), [{ char: C(TYPE.kpi, true, pal.primary), text: it.value }, ...(it.unit ? [{ char: C(10, true, pal.primary), text: " " + it.unit }] : [])]) +
            cellPara(it.label, { size: TYPE.kpiLabel, color: NEUTRAL.muted, align: "CENTER" }),
          margin: [hu(3), hu(3), hu(5), hu(2)],
        }));
        return wrapTable(tableXml([cells], { fill: none, spacing: gap, after: SPACE.block - 4 }));
      }
      case "table": {
        const weights = tableWidths(b);
        const widths = weights.map((x) => Math.floor(BODY_W * x));
        widths[widths.length - 1] += BODY_W - widths.reduce((s, x) => s + x, 0);
        const thick = solid(0.4, pal.primary);
        const head: Cell[] = b.columns.map((c, ci) => {
          const isLast = ci === b.columns.length - 1;
          const fill = b.style === "grid" ? st.fill({ fill: pal.primary, left: solid(0.12, pal.primary), right: solid(0.12, pal.primary), top: solid(0.12, pal.primary), bottom: solid(0.12, pal.primary) })
            : b.style === "clean" ? st.fill({ fill: pal.tint, top: thick, bottom: solid(0.12, pal.line) })
            : st.fill({ fill: pal.tint, top: thick, bottom: ruleSide, left: ci ? ruleSide : undefined, right: isLast ? undefined : ruleSide });
          return { w: widths[ci], h: estH([{ text: c, size: TYPE.table }], widths[ci]), header: true, fill, paras: cellPara(c, { bold: true, align: "CENTER", color: b.style === "grid" ? "#FFFFFF" : pal.primary }) };
        });
        const rows = b.rows.map((r, ri) => {
          const isLastRow = ri === b.rows.length - 1;
          const h = Math.max(...b.columns.map((_, ci) => estH([{ text: r[ci] || "", size: TYPE.table }], widths[ci])));
          return b.columns.map((_, ci): Cell => {
            const first = ci === 0 && (b.firstCol || b.style === "form");
            const isLast = ci === b.columns.length - 1;
            const fill = b.style === "grid" ? st.fill({ fill: first ? pal.tint2 : undefined, left: ruleSide, right: ruleSide, top: ruleSide, bottom: ruleSide })
              : b.style === "clean" ? st.fill({ fill: first ? pal.tint2 : undefined, bottom: isLastRow ? thick : solid(0.12, NEUTRAL.rule) })
              : st.fill({ fill: first ? pal.tint : undefined, bottom: ruleSide, left: ci ? ruleSide : undefined, right: isLast ? undefined : ruleSide });
            return { w: widths[ci], h, fill, paras: cellPara(r[ci] || "", { bold: first, color: first ? pal.primary : NEUTRAL.ink, align: first ? "CENTER" : "LEFT" }) };
          });
        });
        const title = b.title ? pXml(P({ before: 9, after: 4, line: 130, keepNext: true }), [{ char: C(7.5, false, pal.primary), text: "■ " }, { char: C(TYPE.tableTitle, true), text: b.title }]) : "";
        const note = b.note ? pXml(P({ after: SPACE.block, line: 130 }), [{ char: C(8.3, false, NEUTRAL.muted), text: b.note }]) : "";
        return title + wrapTable(tableXml([head, ...rows], { fill: none, repeatHeader: true, after: b.note ? 2 : SPACE.block })) + note;
      }
      case "gantt": {
        const hasGroup = b.tasks.some((t) => t.group);
        const n = b.periods.length;
        const wg = hasGroup ? Math.round(BODY_W * 0.15) : 0, wt = Math.round(BODY_W * 0.27);
        const wp = Math.floor((BODY_W - wg - wt) / n);
        const wtAdj = BODY_W - wg - wp * n;
        const white = solid(0.12, "#FFFFFF");
        const hf = st.fill({ fill: pal.primary, left: white, right: white, top: white, bottom: white });
        const head: Cell[] = [
          ...(hasGroup ? [{ w: wg, h: hu(16), header: true, fill: hf, paras: cellPara("구분", { size: TYPE.gantt, bold: true, color: "#FFFFFF", align: "CENTER" }) }] : []),
          { w: wtAdj, h: hu(16), header: true, fill: hf, paras: cellPara("세부 과업", { size: TYPE.gantt, bold: true, color: "#FFFFFF", align: "CENTER" }) },
          ...b.periods.map((p): Cell => ({ w: wp, h: hu(16), header: true, fill: hf, paras: cellPara(p, { size: TYPE.gantt - 1, bold: true, color: "#FFFFFF", align: "CENTER" }), margin: [0, 0, hu(2), hu(2)] })),
        ];
        const tone = { work: pal.primary2, key: pal.primary, report: pal.accent } as const;
        const rows = b.tasks.map((t, ri): Cell[] => {
          const cont = ri > 0 && (t.group || "") === (b.tasks[ri - 1].group || "");
          const h = Math.max(hu(15), estH([{ text: t.label, size: TYPE.gantt }], wtAdj, 5));
          const grid = { left: ruleSide, right: ruleSide, top: ruleSide, bottom: ruleSide };
          return [
            ...(hasGroup ? [{ w: wg, h, fill: st.fill({ fill: pal.tint, left: ruleSide, right: ruleSide, top: cont ? undefined : ruleSide, bottom: ri < b.tasks.length - 1 && (b.tasks[ri + 1].group || "") === (t.group || "") ? undefined : ruleSide }), paras: cellPara(cont ? "" : t.group || "", { size: TYPE.gantt, bold: true, color: pal.primary, align: "CENTER" }) }] : []),
            { w: wtAdj, h, fill: st.fill(grid), paras: cellPara(t.label, { size: TYPE.gantt }) },
            ...b.periods.map((_, pi): Cell => {
              const on = pi >= t.start && pi <= t.end;
              const mark = t.marks?.includes(pi);
              return { w: wp, h, fill: st.fill({ ...grid, fill: on ? tone[t.tone ?? "work"] : undefined }), paras: cellPara(mark ? "●" : "", { size: 7, color: on ? "#FFFFFF" : pal.primary, align: "CENTER" }), margin: [0, 0, 0, 0] };
            }),
          ];
        });
        const title = b.title ? pXml(P({ before: 9, after: 4, line: 130, keepNext: true }), [{ char: C(7.5, false, pal.primary), text: "■ " }, { char: C(TYPE.tableTitle, true), text: b.title }]) : "";
        const legend = pXml(P({ after: 8, line: 130 }), [
          { char: C(8, false, pal.primary2), text: "■" }, { char: C(8, false, NEUTRAL.muted), text: " 수행   " },
          { char: C(8, false, pal.primary), text: "■" }, { char: C(8, false, NEUTRAL.muted), text: " 핵심 과업   " },
          { char: C(8, false, pal.accent), text: "■" }, { char: C(8, false, NEUTRAL.muted), text: " 보고·제출   " },
          { char: C(8, false, pal.primary), text: "● 보고회·협의" }, ...(b.note ? [{ char: C(8, false, NEUTRAL.muted), text: "   " + b.note }] : []),
        ]);
        return title + wrapTable(tableXml([head, ...rows], { fill: none, repeatHeader: true, after: 2 })) + legend;
      }
      case "figure":
      case "diagram":
      case "image": {
        const dataUrl = b.kind === "image" ? b.dataUrl : figures[b.id];
        if (!dataUrl) throw new Error(`그림 '${b.title || b.id}'의 출력 이미지가 없습니다.`);
        const img = await addImage(b.id, dataUrl);
        let wMm = b.widthMm, hMm = b.heightMm;
        if (b.kind === "image") { const r = Math.min(wMm / img.width, hMm / img.height); wMm = img.width * r; hMm = img.height * r; }
        const pic = picXml(img.binaryId, Math.round(wMm * MM), Math.round(hMm * MM), img.width, img.height, b.title, false);
        const no = figNo.get(b.id);
        // 그림 문단은 줄 간격 100%·다음 문단(캡션)과 함께 — 그림과 캡션 사이 과대 여백 방지(GPT T-056 실측)
        const picPara = pXml(P({ align: "CENTER", before: 8, line: 100, keepNext: !!b.title }), [{ char: C(TYPE.body), xml: pic }]);
        const cap = b.title ? pXml(P({ align: "CENTER", before: 3, after: SPACE.block, line: 130 }), [{ char: C(TYPE.caption, true, NEUTRAL.ink2), text: no ? `그림 ${no}. ` : "" }, { char: C(TYPE.caption, false, NEUTRAL.muted), text: b.title }]) : "";
        return picPara + cap;
      }
    }
  };

  // ── 쪽 조립 ──
  const secPr = /<hp:secPr\b[\s\S]*?<\/hp:secPr>/.exec(tplSection)?.[0];
  if (!secPr) throw new Error("HWPX 용지 설정을 찾지 못했습니다.");
  const sec = secPr
    .replace(/<hp:pagePr\b[^>]*>/, (t) => t.replace(/width="\d+"/, 'width="59528"').replace(/height="\d+"/, 'height="84188"'))
    .replace(/<hp:margin\b[^>]*\/>/, `<hp:margin header="${Math.round(PAGE.header * MM)}" footer="${Math.round(PAGE.footer * MM)}" gutter="0" left="${Math.round(PAGE.left * MM)}" right="${Math.round(PAGE.right * MM)}" top="${Math.round(PAGE.top * MM)}" bottom="${Math.round(PAGE.bottom * MM)}"/>`);
  const colPr = /<hp:ctrl><hp:colPr\b[\s\S]*?<\/hp:ctrl>/.exec(tplSection)?.[0] ?? "";

  const out: string[] = [];
  const firstRunChar = C(TYPE.body);
  const pages = physicalPages(doc);
  let lastHead = "";
  let numbered = false;
  for (const [pi, pg] of pages.entries()) {
    const pageBreak = pi > 0;
    const lead: string[] = [];
    if (pi === 0) lead.push(sec + colPr, footerCtrl());
    if (pg.kind === "cover" || pg.kind === "toc" || pg.kind === "divider") lead.push(pageHide);
    if ((pg.kind === "divider" || pg.kind === "body") && !numbered) { lead.push('<hp:ctrl><hp:newNum num="1" numType="PAGE"/></hp:ctrl>'); numbered = true; }

    if (pg.kind === "cover") {
      const art = figures[COVER_ART_ID];
      if (!art) throw new Error("표지 배경 그림이 없습니다.");
      const img = await addImage(COVER_ART_ID, art);
      lead.push(picXml(img.binaryId, 59528, 84188, img.width, img.height, "표지 배경", true));
      coverLines(doc).forEach((l, i) => out.push(flowLine(l, i === 0 ? { pageBreak, lead: lead.join("") } : {})));
      continue;
    }
    if (pg.kind === "divider") {
      const art = figures[DIVIDER_ART_ID];
      if (!art) throw new Error("간지 배경 그림이 없습니다.");
      const img = await addImage(`${DIVIDER_ART_ID}${pg.chapter}`, art);
      lead.push(picXml(img.binaryId, 59528, 84188, img.width, img.height, "간지 배경", true));
      const c = chapters[pg.chapter];
      const crumbs = [...new Set(doc.sections.filter((s) => s.chapter?.trim() === c.name).map((s) => s.crumb?.trim() || "").filter(Boolean))];
      dividerLines(c.roman, c.name, crumbs).forEach((l, i) => out.push(flowLine(l, i === 0 ? { pageBreak: true, lead: lead.join("") } : {})));
      continue;
    }
    if (pg.kind === "toc") {
      out.push(pXml(P({ line: 130, before: 6 }), [{ char: C(9, true, pal.accent, 30), xml: lead.join(""), text: "CONTENTS" }], { pageBreak }));
      out.push(pXml(P({ line: 130, after: 14 }), [{ char: C(22, true, pal.primary, 40), text: "목 차" }]));
      const wNo = Math.round(9 * MM), wPg = Math.round(14 * MM), wLb = BODY_W - wNo - wPg;
      const rows: Cell[][] = tocEntries(doc).map((e) => {
        if (e.level === 1) {
          const bf = st.fill({ bottom: solid(0.4, pal.primary) });
          return [
            { w: wNo, h: hu(24), fill: st.fill({ fill: pal.primary, bottom: solid(0.4, pal.primary) }), paras: cellPara(e.roman ?? "", { size: 11, bold: true, color: "#FFFFFF", align: "CENTER" }), margin: [0, 0, hu(3), hu(3)] },
            { w: wLb, h: hu(24), fill: bf, paras: cellPara(e.label, { size: 12.5, bold: true, color: pal.primary }), margin: [hu(8), 0, hu(8), hu(3)] },
            { w: wPg, h: hu(24), fill: bf, paras: cellPara(String(e.pageNo), { size: 10.5, bold: true, color: pal.primary, align: "RIGHT" }), margin: [0, 0, hu(8), hu(3)] },
          ];
        }
        const dot = st.fill({ bottom: { type: "DOT", width: 0.12, color: NEUTRAL.rule } });
        return [
          { w: wNo, h: hu(18), fill: none, paras: pXml(P({}), []) },
          { w: wLb, h: hu(18), fill: dot, paras: cellPara(e.label, { size: 10.5, color: NEUTRAL.ink2 }), margin: [hu(14), 0, hu(4), hu(4)] },
          { w: wPg, h: hu(18), fill: dot, paras: cellPara(String(e.pageNo), { size: 10.5, color: NEUTRAL.muted, align: "RIGHT" }), margin: [0, 0, hu(4), hu(4)] },
        ];
      });
      if (rows.length) out.push(wrapTable(tableXml(rows, { fill: none })));
      continue;
    }
    // 본문 쪽
    const s = doc.sections[pg.section];
    const roman = pg.chapter >= 0 ? chapters[pg.chapter].roman : "";
    const headKey = `${roman}|${s.chapter ?? ""}|${s.crumb ?? ""}`;
    if (headKey !== lastHead) { lead.push(headerCtrl(roman, s.chapter ?? "", s.crumb ?? "")); lastHead = headKey; }
    const chunks: string[] = [];
    if (s.title) chunks.push(pXml(P({ line: 135, after: SPACE.titleAfter, before: 2 }), [{ char: C(TYPE.pageTitle, true, pal.primary), text: s.title }]));
    if (s.summary) chunks.push(await blockXml({ kind: "lead", id: `${s.id}-summary`, text: s.summary }));
    for (const b of s.blocks) chunks.push(await blockXml(b));
    if (!chunks.length) chunks.push(pXml(P({}), []));
    // 쪽의 첫 문단에 쪽 나눔·머리말·번호 제어를 붙인다(문단 시작의 빈 런)
    const first = chunks[0];
    chunks[0] = first.replace(/^<hp:p id="0" paraPrIDRef="(\d+)" styleIDRef="(\d+)" pageBreak="0"/, `<hp:p id="0" paraPrIDRef="$1" styleIDRef="$2" pageBreak="${pageBreak ? 1 : 0}"`)
      .replace(/(<hp:p\b[^>]*>)/, `$1${runXml({ char: firstRunChar, xml: lead.join("") })}`);
    out.push(...chunks);
  }

  let section = tplSection.replace(/(<hs:sec\b[^>]*>)[\s\S]*(<\/hs:sec>)/, `$1${out.join("")}$2`);
  let id = 1;
  section = section.replace(/(<hp:p\b[^>]*\bid=")\d+(")/g, (_, a, b) => `${a}${id++}${b}`);
  if (/__PROPOSAL_/.test(section)) throw new Error("완성되지 않은 문서 위치 표식이 있습니다.");

  // 공문 틀의 직인·로고·미리보기·작성자 정보 제거
  const refs = new Set([...section.matchAll(/binaryItemIDRef="([^"]+)"/g)].map((m) => m[1]));
  manifest = manifest.replace(/<opf:item\b[^>]*href="BinData\/[^>]*\/>/g, (item) => {
    const binaryId = /\bid="([^"]+)"/.exec(item)?.[1];
    const href = /\bhref="([^"]+)"/.exec(item)?.[1];
    if (binaryId && refs.has(binaryId)) return item;
    if (href) zip.remove(href);
    return "";
  });
  manifest = manifest.replace(/<opf:metadata>[\s\S]*?<\/opf:metadata>/, `<opf:metadata><opf:title>${escapeXml(doc.title)}</opf:title><opf:language>ko</opf:language><opf:meta name="creator" content="text">MCM</opf:meta></opf:metadata>`);
  zip.remove("Preview/PrvImage.png");
  zip.file("Preview/PrvText.txt", [doc.title, doc.client, doc.projectName, ...doc.sections.map((s) => s.title)].join("\n"));
  zip.file("Contents/section0.xml", section);
  zip.file("Contents/header.xml", st.header);
  zip.file("Contents/content.hpf", manifest);
  zip.file("META-INF/proposal.json", JSON.stringify({ documentId: doc.id, designVersion: PROPOSAL_DESIGN_VERSION, contentVersion: doc.contentVersion, plannedPages: pages.length, pageIds: doc.sections.map((s) => s.pageId), bindings }));
  const output = new JSZip();
  output.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  for (const name of Object.keys(zip.files)) if (name !== "mimetype" && !zip.files[name].dir) output.file(name, await zip.files[name].async("uint8array"));
  return output.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** 표 열 비율(합 1) — 지정 폭이 있으면 그것, 없으면 글자 길이로 */
export function tableWidths(b: Extract<ProposalBlock, { kind: "table" }>): number[] {
  if (b.widths?.length === b.columns.length && b.widths.every((x) => x > 0)) {
    const s = b.widths.reduce((a, c) => a + c, 0);
    return b.widths.map((x) => x / s);
  }
  const weights = b.columns.map((c, i) => {
    const lens = b.rows.map((r) => (r[i] || "").length);
    const mean = lens.reduce((a, c2) => a + c2, 0) / Math.max(1, lens.length);
    return Math.max(6, Math.min(30, Math.max(c.length * 1.2, mean)));
  });
  const s = weights.reduce((a, c) => a + c, 0);
  return weights.map((x) => x / s);
}
