// 공문 HWPX 렌더러 — public/hwpx/letter.hwpx 템플릿(규약: docs/letter-template-guide.md)의
// {{토큰}} 치환 + {{BODY}} 슬롯에 본문 문단/표 XML 을 프로그램 생성해 삽입한다.
// 기법: lib/contracts/hwpx.ts(fillHwpx 토큰 치환)·lib/bid/hwpx-fill.ts(setParagraphText·
// linesegarray 제거·셀 조작)에서 이식(출처 주석). hwpx-fill.ts 는 입찰 기능 회귀 방지를 위해
// 수정하지 않는다.
// fit(A4 1장 맞춤)은 PDF 렌더(pdf.ts)에서 확정된 값을 그대로 적용한다 — 폰트 높이 치환 +
// 본문 끝~서명줄 사이 빈 문단(gapLines) 삽입. 한글이 linesegarray 를 재계산하므로 픽셀
// 동일은 보장되지 않으며 공식 산출물은 PDF, HWPX 는 편집용 사본이다.

import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import type { FitParams, LetterBlock, LetterLayout, TableCell, TextRun } from "./types";

const TOKEN_RE = /\{\{\s*([^}]+?)\s*\}\}/g;
const LINESEG_RE = /<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g; // hwpx-fill.ts 이식
const P_G_RE = /<hp:p\b[\s\S]*?<\/hp:p>/g;
const T_RE = /<hp:t>([\s\S]*?)<\/hp:t>/;
const T_ALL_RE = /<hp:t>[\s\S]*?<\/hp:t>/g;

function escapeXml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 문단 XML 텍스트 교체(첫 hp:t 에 값, 나머지 비움) — hwpx-fill.ts setParagraphText 이식. */
function setParagraphText(pXml: string, value: string): string {
  let first = true;
  if (T_RE.test(pXml)) {
    return pXml.replace(T_ALL_RE, () => {
      if (first) {
        first = false;
        return `<hp:t>${escapeXml(value)}</hp:t>`;
      }
      return "<hp:t></hp:t>";
    });
  }
  const runClose = pXml.indexOf("</hp:run>");
  if (runClose >= 0) return pXml.slice(0, runClose) + `<hp:t>${escapeXml(value)}</hp:t>` + pXml.slice(runClose);
  const selfRun = /<hp:run\b[^>]*\/>/.exec(pXml);
  if (selfRun) {
    const opened = selfRun[0].slice(0, -2) + ">";
    return pXml.replace(selfRun[0], `${opened}<hp:t>${escapeXml(value)}</hp:t></hp:run>`);
  }
  return pXml;
}

/** 토큰을 포함한 문단(<hp:p>…</hp:p>) 전체를 찾는다. */
function findParagraphWith(xml: string, needle: string): string | null {
  for (const m of xml.matchAll(P_G_RE)) {
    if (m[0].includes(needle)) return m[0];
  }
  return null;
}

function attrOf(xml: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`);
  return re.exec(xml)?.[1] ?? null;
}

interface TemplateStyles {
  bodyParaPr: string; // {{BODY}} 문단 paraPrIDRef
  bodyCharPr: string; // {{BODY}} 첫 run charPrIDRef
  boldCharPr: string | null; // {{S_BOLD}} charPrIDRef
  tableTpl: TableTemplate | null;
}

interface TableTemplate {
  preamble: string; // <hp:tbl …> ~ 첫 <hp:tr> 직전 (rowCnt/colCnt/사이즈는 치환)
  tcTpl: string; // 첫 <hp:tc>…</hp:tc>
  wrapP: string; // 표를 감싸던 문단 골격(표 자리 마커 __TBL__)
}

/**
 * ⚠ 한글은 paraPrIDRef/charPrIDRef 를 id 속성이 아니라 **목록 순서(인덱스)**로 해석한다
 * (실측: 신규 항목을 목록 중간에 끼우면 이후 항목들의 참조가 한 칸씩 밀려 정렬이 뒤바뀜).
 * 따라서 모든 신규 등록은 반드시 컨테이너 닫는 태그 직전(목록 끝)에 append 한다.
 */
function appendToList(headerXml: string, closing: string, cntTag: string, clone: string): string | null {
  if (!headerXml.includes(closing)) return null;
  const withClone = headerXml.replace(closing, clone + closing);
  return withClone.replace(new RegExp(`(<${cntTag}\\b[^>]*\\bitemCnt=")(\\d+)(")`), (_, a, n, b) => `${a}${Number(n) + 1}${b}`);
}

/** header.xml 에 paraPr 사본을 등록(정렬·여백 치환)하고 새 id 반환. 실패 시 null. */
function registerParaPr(
  headerXml: string,
  baseId: string,
  patch: { align?: "CENTER" | "RIGHT"; leftHwp?: number; intentHwp?: number; lineSpacingPct?: number }
): { xml: string; id: string } | null {
  const blockRe = new RegExp(`<hh:paraPr\\b[^>]*\\bid="${baseId}"[\\s\\S]*?</hh:paraPr>`);
  const m = blockRe.exec(headerXml);
  if (!m) return null;
  let maxId = 0;
  for (const idm of headerXml.matchAll(/<hh:paraPr\b[^>]*\bid="(\d+)"/g)) maxId = Math.max(maxId, Number(idm[1]));
  const newId = String(maxId + 1);
  let clone = m[0].replace(/(<hh:paraPr\b[^>]*\bid=")\d+(")/, `$1${newId}$2`);
  if (patch.align) {
    if (/<hh:align\b[^>]*horizontal="[^"]*"/.test(clone)) {
      clone = clone.replace(/(<hh:align\b[^>]*horizontal=")[^"]*(")/, `$1${patch.align}$2`);
    } else {
      clone = clone.replace(/(<hh:paraPr\b[^>]*>)/, `$1<hh:align horizontal="${patch.align}" vertical="BASELINE"/>`);
    }
  }
  const intent = patch.intentHwp ?? (patch.align ? 0 : undefined); // 정렬 문단은 첫줄 들여쓰기 해제
  if (intent !== undefined) clone = clone.replace(/(<hc:intent\b[^>]*value=")[^"]*(")/, `$1${intent}$2`);
  if (patch.leftHwp !== undefined) clone = clone.replace(/(<hc:left\b[^>]*value=")[^"]*(")/, `$1${patch.leftHwp}$2`);
  if (patch.lineSpacingPct !== undefined) {
    clone = clone.replace(/(<hh:lineSpacing\b[^>]*value=")\d+(")/, `$1${Math.round(patch.lineSpacingPct)}$2`);
  }
  const xml = appendToList(headerXml, "</hh:paraProperties>", "hh:paraProperties", clone);
  return xml ? { xml, id: newId } : null;
}

/** header.xml 에 charPr 사본을 등록(높이·굵게·자간 치환)하고 새 id 반환 — 목록 끝 append. */
function registerCharPr(
  headerXml: string,
  baseId: string,
  patch: { heightPt?: number; bold?: boolean; spacingPct?: number }
): { xml: string; id: string } | null {
  const blockRe = new RegExp(`<hh:charPr\\b[^>]*\\bid="${baseId}"[\\s\\S]*?</hh:charPr>|<hh:charPr\\b[^>]*\\bid="${baseId}"[^>]*/>`);
  const m = blockRe.exec(headerXml);
  if (!m) return null;
  let maxId = 0;
  for (const idm of headerXml.matchAll(/<hh:charPr\b[^>]*\bid="(\d+)"/g)) maxId = Math.max(maxId, Number(idm[1]));
  const newId = String(maxId + 1);
  let clone = m[0].replace(/(<hh:charPr\b[^>]*\bid=")\d+(")/, `$1${newId}$2`);
  if (patch.heightPt !== undefined) {
    clone = clone.replace(/(\bheight=")\d+(")/, `$1${String(Math.round(patch.heightPt * 100))}$2`);
  }
  if (patch.spacingPct !== undefined) {
    const v = String(Math.round(patch.spacingPct));
    clone = clone.replace(/<hh:spacing\b[^/]*\/>/, `<hh:spacing hangul="${v}" latin="${v}" hanja="${v}" japanese="${v}" other="${v}" symbol="${v}" user="${v}"/>`);
  }
  if (patch.bold && !clone.includes("<hh:bold/>")) {
    if (clone.endsWith("/>")) clone = clone.slice(0, -2) + "><hh:bold/></hh:charPr>";
    else clone = clone.replace("</hh:charPr>", "<hh:bold/></hh:charPr>");
  }
  const xml = appendToList(headerXml, "</hh:charProperties>", "hh:charProperties", clone);
  return xml ? { xml, id: newId } : null;
}

/** charPr 의 글자 높이(pt) 조회 — 제목 축소·표 행높이 계산용. */
function charPrHeightPt(headerXml: string, id: string): number | null {
  const m = new RegExp(`<hh:charPr\\b[^>]*\\bid="${id}"[^>]*\\bheight="(\\d+)"`).exec(headerXml);
  return m ? Number(m[1]) / 100 : null;
}

/** 문단이 구분선 역할인지 — paraPr 의 border 가 상하좌우 실선(SOLID) 테두리를 가지면 선 문단.
 *  (실측: 하단 고정부 위 굵은선은 텍스트 없는 빈 문단의 문단 테두리다 — 여백 정리에서 보존 필수) */
function isLineParagraph(headerXml: string, pXml: string): boolean {
  const pid = attrOf(pXml, "hp:p", "paraPrIDRef");
  if (!pid) return false;
  const pr = new RegExp(`<hh:paraPr\\b[^>]*\\bid="${pid}"[\\s\\S]*?</hh:paraPr>`).exec(headerXml);
  const bf = pr ? /<hh:border\b[^>]*borderFillIDRef="(\d+)"/.exec(pr[0]) : null;
  if (!bf) return false;
  const fill = new RegExp(`<hh:borderFill\\b[^>]*\\bid="${bf[1]}"[\\s\\S]*?</hh:borderFill>`).exec(headerXml);
  if (!fill) return false;
  return /<hh:(left|right|top|bottom)Border\b[^>]*type="SOLID"/.test(fill[0]);
}

/** 텍스트 폭 근사(pt) — 한글·전각 1em, 그 외 0.5em. */
function approxTextWidthPt(text: string, fontPt: number): number {
  let w = 0;
  for (const ch of text) {
    w += /[ᄀ-ᇿ　-鿿가-힯豈-﫿！-｠]/.test(ch) ? fontPt : fontPt * 0.5;
  }
  return w;
}

/** header.xml 에 borderFill 을 등록(4변 실선 또는 무테두리) — org-chart.ts orgBorderFillXml 이식. */
function registerBorderFill(headerXml: string, solid: boolean): { xml: string; id: string } | null {
  let maxId = 0;
  for (const idm of headerXml.matchAll(/<hh:borderFill\b[^>]*\bid="(\d+)"/g)) maxId = Math.max(maxId, Number(idm[1]));
  if (maxId === 0) return null;
  const newId = String(maxId + 1);
  const edge = solid ? 'type="SOLID" width="0.12 mm" color="#000000"' : 'type="NONE" width="0.1 mm" color="#000000"';
  const fill =
    `<hh:borderFill id="${newId}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
    '<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>' +
    `<hh:leftBorder ${edge}/><hh:rightBorder ${edge}/><hh:topBorder ${edge}/><hh:bottomBorder ${edge}/>` +
    '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/></hh:borderFill>';
  const xml = appendToList(headerXml, "</hh:borderFills>", "hh:borderFills", fill);
  return xml ? { xml, id: newId } : null;
}

/** 런 배열 → hp:run 시퀀스(볼드는 S_BOLD charPr). 밑줄·기울임은 v1 미지원(텍스트 보존). */
function runsXml(runs: TextRun[], charPr: string, boldCharPr: string | null): string {
  if (!runs.length) return `<hp:run charPrIDRef="${charPr}"><hp:t></hp:t></hp:run>`;
  return runs
    .map((r) => {
      const pr = r.bold && boldCharPr ? boldCharPr : charPr;
      return `<hp:run charPrIDRef="${pr}"><hp:t>${escapeXml(r.text)}</hp:t></hp:run>`;
    })
    .join("");
}

function paragraphXml(runs: TextRun[], paraPr: string, charPr: string, boldCharPr: string | null): string {
  return `<hp:p id="0" paraPrIDRef="${paraPr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${runsXml(runs, charPr, boldCharPr)}</hp:p>`;
}

/** 셀 subList 안 문단들을 셀 텍스트로 교체(여러 줄 = 문단 복제). */
function fillTcTemplate(
  tcTpl: string,
  cell: TableCell,
  col: number,
  row: number,
  widthHwp: number,
  heightHwp: number,
  charPr: string,
  boldCharPr: string | null,
  alignParaPrOf: (align: "CENTER" | "RIGHT") => string | null
): string {
  let tc = tcTpl;
  tc = tc.replace(/(<hp:cellAddr\b[^>]*colAddr=")\d+(")/, `$1${col}$2`).replace(/(\browAddr=")\d+(")/, `$1${row}$2`);
  // 셀 병합(2026-08-25) — IR 의 rowSpan/colSpan 을 그대로 싣는다(병합 점유 자리는 tc 자체를 생략).
  tc = tc
    .replace(/(<hp:cellSpan\b[^>]*colSpan=")\d+(")/, `$1${cell.colSpan ?? 1}$2`)
    .replace(/(\browSpan=")\d+(")/, `$1${cell.rowSpan ?? 1}$2`);
  tc = tc.replace(/(<hp:cellSz\b[^>]*width=")\d+(")/, `$1${widthHwp}$2`).replace(/(<hp:cellSz\b[^>]*height=")\d+(")/, `$1${heightHwp}$2`);
  // subList 내부 문단 전부 교체
  const subM = /<hp:subList\b[^>]*>([\s\S]*?)<\/hp:subList>/.exec(tc);
  if (subM) {
    const pM = P_G_RE.exec(subM[1]);
    P_G_RE.lastIndex = 0;
    const basePara = pM ? pM[0] : null;
    if (basePara) {
      let paraPr = attrOf(basePara, "hp:p", "paraPrIDRef") ?? "0";
      if (cell.align === "center" || cell.align === "right") {
        const aligned = alignParaPrOf(cell.align === "center" ? "CENTER" : "RIGHT");
        if (aligned) paraPr = aligned;
      }
      const lines = cell.lines.length ? cell.lines : [[{ text: "" }] as TextRun[]];
      const paras = lines.map((line) => paragraphXml(line, paraPr, charPr, boldCharPr)).join("");
      tc = tc.replace(subM[1], paras);
    }
  }
  return tc;
}

/** {{S_TABLE}} 참조 표에서 표 골격을 추출하고 문서에서 제거. */
function extractTableTemplate(xml: string): { xml: string; tpl: TableTemplate | null } {
  const idx = xml.indexOf("{{S_TABLE}}");
  if (idx < 0) return { xml, tpl: null };
  // 토큰을 포함하는 hp:tbl 블록 탐색
  let tblStart = -1;
  const tblOpenRe = /<hp:tbl\b/g;
  let om: RegExpExecArray | null;
  while ((om = tblOpenRe.exec(xml))) {
    const end = xml.indexOf("</hp:tbl>", om.index);
    if (end > om.index && om.index < idx && idx < end) {
      tblStart = om.index;
      break;
    }
  }
  if (tblStart < 0) return { xml, tpl: null };
  const tblEnd = xml.indexOf("</hp:tbl>", tblStart) + "</hp:tbl>".length;
  const tblXml = xml.slice(tblStart, tblEnd);
  const firstTr = tblXml.indexOf("<hp:tr");
  const preamble = firstTr >= 0 ? tblXml.slice(0, firstTr) : tblXml;
  const tcM = /<hp:tc\b[\s\S]*?<\/hp:tc>/.exec(tblXml);
  if (!tcM) return { xml, tpl: null };
  // 표를 감싼 문단 통째 제거 + 문단 골격 확보
  let wrapP = `<hp:p id="0" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0">__TBL__</hp:run></hp:p>`;
  let removed = xml;
  for (const pm of xml.matchAll(P_G_RE)) {
    if (pm[0].includes("{{S_TABLE}}") && pm[0].includes("<hp:tbl")) {
      wrapP = pm[0].replace(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/, "__TBL__").replace(T_ALL_RE, "<hp:t></hp:t>");
      removed = xml.replace(pm[0], "");
      break;
    }
  }
  if (removed === xml) removed = xml.replace(tblXml, ""); // 문단 밖 표였던 경우
  return { xml: removed, tpl: { preamble, tcTpl: tcM[0], wrapP } };
}

const templateCache = new Map<string, Buffer>();
async function loadTemplate(file: string): Promise<Buffer> {
  const cached = templateCache.get(file);
  if (cached) return cached;
  const bytes = await readFile(path.join(process.cwd(), "public", "hwpx", file));
  templateCache.set(file, bytes);
  return bytes;
}

export interface HwpxRenderOptions {
  fit: FitParams;
  /** 본문 끝~서명줄 사이 빈 문단 수(PDF fit 결과 환산). 기본 2 */
  gapLinesAfterBody?: number;
  /** 서명줄 텍스트·성명부 실측 폭(pt, pdf.ts measureSignTextWidths) — 인감 위치 정밀 산출용 */
  signWidths?: { textW: number; nameW: number };
}

export async function renderLetterHwpx(layout: LetterLayout, opts: HwpxRenderOptions): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await loadTemplate("letter.hwpx"));
  const sectionPath = "Contents/section0.xml";
  const section = zip.file(sectionPath);
  if (!section) throw new Error("letter.hwpx 템플릿에 section0.xml 이 없습니다");
  let xml = (await section.async("string")).replace(LINESEG_RE, "");
  const headerPath = "Contents/header.xml";
  let headerXml = (await zip.file(headerPath)?.async("string")) ?? "";

  // 서체 통일 — 문서 전체를 맑은 고딕으로(사용자 확정). 모든 charPr 의 fontRef 를
  // '맑은 고딕' 폰트 id 로 일괄 치환한다(전 스크립트 동일 적용).
  if (headerXml) {
    const malgun = /<hh:font\b[^>]*\bid="(\d+)"[^>]*face="맑은 고딕"/.exec(headerXml);
    if (malgun) {
      const fid = malgun[1];
      headerXml = headerXml.replace(/<hh:fontRef\b[^>]*\/>/g, () =>
        `<hh:fontRef hangul="${fid}" latin="${fid}" hanja="${fid}" japanese="${fid}" other="${fid}" symbol="${fid}" user="${fid}"/>`
      );
    }
  }

  // 하단 구분선(hp:line 개체) 두께 — 상단 제목 구분선과 동급으로(사용자 확정)
  xml = xml.replace(/(<hp:line\b[\s\S]*?<hp:lineShape\b[^>]*\bwidth=")\d+(")/g, `$1260$2`);

  // 서명줄 텍스트 — 완전 중앙보다 1글자 왼쪽 치우침(전각 공백 2개 우측 패딩, 인감과의 균형).
  {
    const signP0 = /<hp:p\b(?:(?!<\/hp:p>)[\s\S])*?대표이사[\s\S]*?<\/hp:p>/.exec(xml)?.[0];
    if (signP0) {
      const text = [...signP0.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)].map((t) => t[1]).join("").replace(/　+$/, "");
      if (text.trim()) xml = xml.replace(signP0, setParagraphText(signP0, `${text}　　`));
    }
  }

  // ── 1) 스타일 추출 ──
  const bodyP = findParagraphWith(xml, "{{BODY}}");
  if (!bodyP) throw new Error("letter.hwpx 템플릿에 {{BODY}} 문단이 없습니다");
  let bodyParaPr = attrOf(bodyP, "hp:p", "paraPrIDRef") ?? "0";
  let bodyCharPr = attrOf(bodyP, "hp:run", "charPrIDRef") ?? "0";

  const templateBodyParaPr = bodyParaPr; // 붙임 여백 paraPr 의 복제 원본(정렬·크기 치환 전)

  let tableTpl: TableTemplate | null;
  {
    const tableExtract = extractTableTemplate(xml);
    xml = tableExtract.xml;
    tableTpl = tableExtract.tpl;
  }
  // {{S_TABLE}} 카탈로그가 없으면 템플릿 내 기존 표(상단 수신/참조 레이아웃 표)를 구조 골격으로
  // 빌리고, 테두리만 4변 실선 borderFill 을 신규 등록해 내역표 스타일로 치환한다(문서에서
  // 기존 표는 제거하지 않음 — 실측: 사용자 템플릿에 카탈로그 미포함).
  if (!tableTpl && headerXml) {
    const anyTblM = /<hp:tbl\b[\s\S]*?<\/hp:tbl>/.exec(xml);
    const tcM = anyTblM ? /<hp:tc\b[\s\S]*?<\/hp:tc>/.exec(anyTblM[0]) : null;
    const solidFill = registerBorderFill(headerXml, true);
    if (anyTblM && tcM && solidFill) {
      headerXml = solidFill.xml;
      const firstTr = anyTblM[0].indexOf("<hp:tr");
      let preamble = firstTr >= 0 ? anyTblM[0].slice(0, firstTr) : anyTblM[0];
      preamble = preamble.replace(/(<hp:tbl\b[^>]*\bborderFillIDRef=")\d+(")/, `$1${solidFill.id}$2`);
      const tcTpl = tcM[0].replace(/(\bborderFillIDRef=")\d+(")/, `$1${solidFill.id}$2`);
      tableTpl = {
        preamble,
        tcTpl,
        wrapP: `<hp:p id="0" paraPrIDRef="${bodyParaPr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${bodyCharPr}">__TBL__</hp:run></hp:p>`,
      };
    }
  }

  // ── 2) fit: 본문 글자 크기 charPr 등록(항상 — 템플릿 저장 크기와 무관하게 fit 값 적용) ──
  if (headerXml) {
    const sized = registerCharPr(headerXml, bodyCharPr, { heightPt: opts.fit.bodyFontPt });
    if (sized) {
      headerXml = sized.xml;
      bodyCharPr = sized.id;
    }
  }

  // 줄 간격 미세조정 — 본문 paraPr 을 lineSpacing 치환 사본으로 교체(정렬·붙임 파생도 이 base 사용)
  if (layout.overrides?.lineSpacingPct && headerXml) {
    const spaced = registerParaPr(headerXml, templateBodyParaPr, { lineSpacingPct: layout.overrides.lineSpacingPct });
    if (spaced) {
      headerXml = spaced.xml;
      bodyParaPr = spaced.id;
    }
  }

  // 볼드 charPr — {{S_BOLD}} 카탈로그가 있으면 그 서식(+크기 적용), 없으면 본문 크기 charPr 에
  // 굵게만 추가해 폴백 등록(실측 템플릿: 카탈로그 미포함).
  let boldCharPr: string | null = null;
  const boldP = findParagraphWith(xml, "{{S_BOLD}}");
  if (boldP) {
    const base = attrOf(boldP, "hp:run", "charPrIDRef");
    xml = xml.replace(boldP, "");
    if (base && headerXml) {
      const sizedBold = registerCharPr(headerXml, base, { heightPt: opts.fit.bodyFontPt });
      if (sizedBold) {
        headerXml = sizedBold.xml;
        boldCharPr = sizedBold.id;
      } else {
        boldCharPr = base;
      }
    }
  } else if (headerXml) {
    const bold = registerCharPr(headerXml, bodyCharPr, { bold: true });
    if (bold) {
      headerXml = bold.xml;
      boldCharPr = bold.id;
    }
  }

  // 정렬 paraPr 캐시(중앙/우측)
  const alignCache = new Map<string, string>();
  const alignParaPrOf = (align: "CENTER" | "RIGHT"): string | null => {
    const hit = alignCache.get(align);
    if (hit) return hit;
    if (!headerXml) return null;
    const reg = registerParaPr(headerXml, bodyParaPr, { align }); // 줄간격 오버라이드 사본을 승계
    if (!reg) return null;
    headerXml = reg.xml;
    alignCache.set(align, reg.id);
    return reg.id;
  };

  // ── 2-1) 제목 한 줄 강제(사용자 확정 로직) — ① 자간 축소(최대 -10%)를 먼저 시도,
  //         ② 그래도 넘치면 자간 -10% 로 폰트를 0.5pt 씩 축소해 맞추고,
  //         ③ 맞춘 크기에서 자간 원복(0)해도 한 줄이면 원복, 다시 넘치면 줄인 자간 유지.
  {
    const subjP = findParagraphWith(xml, "{{SUBJECT}}");
    const subjRunM = subjP ? /<hp:run\b[^>]*charPrIDRef="(\d+)"[^>]*>(?:(?!<\/hp:run>)[\s\S])*?\{\{SUBJECT\}\}(?:(?!<\/hp:run>)[\s\S])*?<\/hp:run>/.exec(subjP) : null;
    if (subjP && subjRunM && headerXml) {
      const basePt = charPrHeightPt(headerXml, subjRunM[1]) ?? opts.fit.bodyFontPt;
      const availPt = 410; // 실측: 제목 값 영역 가용 폭(본문폭 487 - 라벨·여백. 33자 제목이 11pt 한 줄 수용 — 사용자 확인)
      const widthAt = (pt: number, spacingPct: number) => approxTextWidthPt(layout.subject, pt) * (1 + spacingPct / 100);
      let pt = layout.overrides?.subjectPt ?? basePt;
      let spacing = 0;
      if (layout.overrides?.subjectPt == null && widthAt(pt, 0) > availPt) {
        spacing = -10;
        while (pt > 7 && widthAt(pt, spacing) > availPt) pt -= 0.5;
        if (widthAt(pt, 0) <= availPt) spacing = 0; // 자간 원복해도 한 줄이면 원복
      }
      if (pt !== basePt || spacing !== 0) {
        const patch: { heightPt?: number; spacingPct?: number } = {};
        if (pt !== basePt) patch.heightPt = pt;
        if (spacing !== 0) patch.spacingPct = spacing;
        const shrunk = registerCharPr(headerXml, subjRunM[1], patch);
        if (shrunk) {
          headerXml = shrunk.xml;
          const newRun = subjRunM[0].replace(/(charPrIDRef=")\d+(")/, `$1${shrunk.id}$2`);
          xml = xml.replace(subjRunM[0], newRun);
        }
      }
    }
  }

  // ── 3) 내용증명형 상단: 수신/참조 문단을 발신·수신 풀정보 라인으로 교체 ──
  if (layout.kind === "proof") {
    const recvP = findParagraphWith(xml, "{{RECEIVER}}");
    const refP = findParagraphWith(xml, "{{REF}}");
    if (recvP) {
      const s = layout.proofSender;
      const r = layout.proofReceiver;
      const contIndent = "           "; // 연속 줄 들여쓰기(라벨 폭 근사 — 원본 관행)
      const lines: string[] = [];
      if (s) {
        lines.push(`발    신 : ${s.address}`);
        lines.push(`${contIndent}${s.company} (사업자번호 : ${s.bizNo})`);
        lines.push(`${contIndent}대표이사 ${s.representative}`);
      }
      if (r) {
        lines.push(`수    신 : ${r.address}`);
        lines.push(`${contIndent}${r.company} (사업자번호 : ${r.bizNo})`);
        lines.push(`${contIndent}대표이사 ${r.representative}`);
      }
      const replaced = lines.map((ln) => setParagraphText(recvP, ln)).join("");
      xml = xml.replace(recvP, replaced);
    }
    // {{REF}} 는 표 셀 안 문단일 수 있어(실측 템플릿 — 수신/참조/제목이 레이아웃 표) 문단을
    // 제거하지 않고 빈 값으로 교체한다(셀은 최소 1문단 유지 필요).
    if (refP) xml = xml.replace(refP, setParagraphText(refP, ""));
  }

  // ── 4) 본문 XML 생성 → {{BODY}} 문단 교체 ──
  const bodyXmlParts: string[] = [];
  for (const b of layout.bodyBlocks) {
    if (b.kind === "p") {
      let paraPr = bodyParaPr;
      if (b.align === "center" || b.align === "right") {
        const aligned = alignParaPrOf(b.align === "center" ? "CENTER" : "RIGHT");
        if (aligned) paraPr = aligned;
      }
      bodyXmlParts.push(paragraphXml(b.runs, paraPr, bodyCharPr, boldCharPr));
    } else if (tableTpl) {
      bodyXmlParts.push(buildTableXml(b, tableTpl, opts.fit.bodyFontPt, bodyCharPr, boldCharPr, alignParaPrOf));
    } else {
      // 표 템플릿 없음 — 텍스트 폴백(행을 " | " 로 연결)
      for (const row of b.rows) {
        const text = row.map((c) => c.lines.map((l) => l.map((r) => r.text).join("")).join(" ")).join("  |  ");
        bodyXmlParts.push(paragraphXml([{ text }], bodyParaPr, bodyCharPr, boldCharPr));
      }
    }
  }

  // 붙임 — 번호 일렬종대. 공백 정렬(폰트 폭 차이로 어긋남)·paraPr 여백(한글이 신규 등록
  // paraPr 의 left 여백을 무시 — 실측) 모두 실패해, **무테두리 2열 표**(라벨 셀 + 항목 셀)로
  // 구조적으로 정렬한다. 항목들이 같은 셀 안 문단이라 시작 x 가 완전히 동일하다.
  if (layout.attachItems.length && tableTpl && headerXml) {
    const noneFill = registerBorderFill(headerXml, false);
    if (noneFill) {
      headerXml = noneFill.xml;
      const label = "붙  임 : ";
      const fontPt = opts.fit.bodyFontPt;
      const labelW = Math.round((approxTextWidthPt(label, fontPt) + 6) * 100);
      const items = layout.attachItems.map((item, i) => (layout.attachItems.length > 1 ? `${i + 1}. ${item}` : item));
      const itemW = Math.round((Math.max(...items.map((t) => approxTextWidthPt(t, fontPt))) + 12) * 100);
      // 무테두리 tpl 사본 — 표 폭은 라벨+항목 폭만큼, 셀 세로 정렬은 TOP(라벨=첫 항목 높이)
      const attachTpl: TableTemplate = {
        preamble: tableTpl.preamble
          .replace(/(\bborderFillIDRef=")\d+(")/, `$1${noneFill.id}$2`)
          .replace(/(<hp:sz\b[^>]*width=")\d+(")/, `$1${labelW + itemW}$2`),
        tcTpl: tableTpl.tcTpl.replace(/(\bborderFillIDRef=")\d+(")/, `$1${noneFill.id}$2`).replace(/(\bvertAlign=")[^"]*(")/, `$1TOP$2`),
        wrapP: tableTpl.wrapP,
      };
      const block: Extract<LetterBlock, { kind: "table" }> = {
        kind: "table",
        colRatios: [labelW / (labelW + itemW), itemW / (labelW + itemW)],
        rows: [
          [
            { lines: [[{ text: label }]] },
            { lines: items.map((t) => [{ text: t }]) },
          ],
        ],
      };
      bodyXmlParts.push(paragraphXml([{ text: "" }], bodyParaPr, bodyCharPr, boldCharPr));
      bodyXmlParts.push(buildTableXml(block, attachTpl, fontPt, bodyCharPr, boldCharPr, alignParaPrOf));
    }
  } else if (layout.attachItems.length) {
    // 표 골격 확보 실패 시 폴백 — 공백 정렬 문단
    bodyXmlParts.push(paragraphXml([{ text: "" }], bodyParaPr, bodyCharPr, boldCharPr));
    layout.attachItems.forEach((item, i) => {
      const numbered = layout.attachItems.length > 1 ? `${i + 1}. ${item}` : item;
      bodyXmlParts.push(paragraphXml([{ text: i === 0 ? `붙  임 :  ${numbered}` : `          ${numbered}` }], bodyParaPr, bodyCharPr, boldCharPr));
    });
  }

  // 본문 끝 ~ 서명줄 여백(빈 문단) — PDF fit 환산값
  const gapLines = Math.max(0, opts.gapLinesAfterBody ?? 2);
  for (let i = 0; i < gapLines; i++) {
    bodyXmlParts.push(paragraphXml([{ text: "" }], bodyParaPr, bodyCharPr, boldCharPr));
  }

  // 인감 이식 — 실측 템플릿의 인감은 용지 절대좌표(vertRelTo="PAPER") 개체라 본문 흐름과
  // 무관하게 고정된 자리에 떠 버린다. 인감 그림을 서명줄 문단 앵커(PARA/COLUMN 기준)로 옮겨
  // 서명줄이 어디로 흐르든 성명 끝에 겹치게 한다. 날인 해제 시엔 removeStampPicture 로 제거.
  if (layout.stamp) {
    let stampPic: string | null = null;
    for (const pm of xml.matchAll(/<hp:pic\b[\s\S]*?<\/hp:pic>/g)) {
      const w = Number(attrOf(pm[0], "hp:orgSz", "width") ?? attrOf(pm[0], "hc:orgSz", "width") ?? 0);
      const h = Number(attrOf(pm[0], "hp:orgSz", "height") ?? attrOf(pm[0], "hc:orgSz", "height") ?? 0);
      if (w > 0 && h > 0 && w / h < 1.4) {
        stampPic = pm[0];
        break;
      }
    }
    const signPM = /<hp:p\b(?:(?!<\/hp:p>)[\s\S])*?대표이사[\s\S]*?<\/hp:p>/.exec(xml);
    if (stampPic && signPM) {
      const signRunM = /<hp:run\b[^>]*charPrIDRef="(\d+)"/.exec(signPM[0]);
      const signText = [...signPM[0].matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)].map((t) => t[1]).join("").trim();
      // 서명 텍스트(중앙 정렬)의 성명부 중앙에 인감 중심을 맞춘다(사용자 요구 — 완전 일치).
      // 폭 근사는 실측 보정 계수 1.12(한글 볼드 자폭이 이론치보다 넓음 — 생성본 실측).
      const colW = 487; // 본문 폭 pt
      const sigPt = (headerXml && signRunM ? charPrHeightPt(headerXml, signRunM[1]) : null) ?? 15;
      // 실측 폭(pdf-lib 메트릭) 우선 — 근사(1em+보정)는 폴백
      const textW = opts.signWidths ? opts.signWidths.textW * (sigPt / 15) : approxTextWidthPt(signText, sigPt) * 1.12;
      const stampH = Number(attrOf(stampPic, "hp:orgSz", "height") ?? 4723) / 100;
      // 사용자 확정 규칙: 인감 왼쪽 가장자리 = 대표이사 성명 오른쪽 끝 (+미세조정 dx/dy).
      // 서명 텍스트가 1글자(15pt) 왼쪽 치우침(우측 전각 패딩)이라 -15pt 보정.
      const horz = Math.round(((colW + textW) / 2 - 15 + (layout.overrides?.stampDx ?? 0)) * 100);
      const vert = -Math.round((stampH / 2 - sigPt * 0.55 + (layout.overrides?.stampDy ?? 0)) * 100); // 인감 중심 ≈ 텍스트 세로 중심
      let moved = stampPic.replace(
        /<hp:pos\b[^>]*\/?>(?:<\/hp:pos>)?/,
        `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="1" allowOverlap="1" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="${vert}" horzOffset="${horz}"/>`
      );
      xml = xml.replace(stampPic, "");
      const signP = xml.match(/<hp:p\b(?:(?!<\/hp:p>)[\s\S])*?대표이사[\s\S]*?<\/hp:p>/)?.[0];
      const runOpen = signP ? /<hp:run\b[^>]*>/.exec(signP) : null;
      if (signP && runOpen) {
        const at = runOpen.index + runOpen[0].length;
        xml = xml.replace(signP, signP.slice(0, at) + moved + signP.slice(at));
      }
    }
  }

  // {{BODY}} 문단 뒤 ~ 서명줄(사명·대표이사 문단) 앞의 기존 빈 문단 제거 — 템플릿에 남아 있으면
  // gapLines 와 중복돼 서명줄이 밀린다(가이드는 삭제를 요구하지만 실측 템플릿에 잔존 → 코드 정리).
  // ⚠ 개체(hp:pic·hp:ctrl) 포함 문단은 보존하고 보존 수만큼 gapLines 에서 차감한다.
  let preservedGapParas = 0;
  {
    const bodyIdx = xml.indexOf(bodyP);
    const signM = /<hp:p\b(?:(?!<\/hp:p>)[\s\S])*?대표이사[\s\S]*?<\/hp:p>/.exec(xml.slice(bodyIdx));
    if (bodyIdx >= 0 && signM) {
      const between = xml.slice(bodyIdx + bodyP.length, bodyIdx + (signM.index ?? 0));
      if (!between.includes("<hp:tbl")) {
        const cleaned = between.replace(P_G_RE, (p) => {
          const text = [...p.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)].map((t) => t[1]).join("");
          if (text.trim()) return p;
          if (/<hp:pic\b|<hp:ctrl\b|<hp:line\b/.test(p) || isLineParagraph(headerXml, p)) {
            preservedGapParas += 1; // 개체 앵커·구분선(hp:line 그리기 개체 — 실측) 문단 — 줄 하나로 남음
            return p;
          }
          return "";
        });
        xml = xml.slice(0, bodyIdx + bodyP.length) + cleaned + xml.slice(bodyIdx + (signM.index ?? 0));
      }
    }
  }
  if (preservedGapParas > 0 && gapLines > 0) {
    const drop = Math.min(preservedGapParas, gapLines);
    bodyXmlParts.splice(bodyXmlParts.length - drop, drop);
  }

  // 서명줄 뒤 ~ 하단 고정부({{CONTACT_NAME}}) 사이 과잉 여백 정리 — 템플릿 잔존 빈 문단을
  // 2개만 남긴다(사용자 실측: 과도한 간격으로 하단부가 2쪽으로 밀림). 개체·표 구간은 보존.
  {
    const signPM2 = /<hp:p\b(?:(?!<\/hp:p>)[\s\S])*?대표이사[\s\S]*?<\/hp:p>/.exec(xml);
    const contactIdx = xml.indexOf("{{CONTACT_NAME}}");
    if (signPM2 && contactIdx > 0) {
      const start = (signPM2.index ?? 0) + signPM2[0].length;
      let end = contactIdx;
      const between = xml.slice(start, end);
      const tblIdx = between.indexOf("<hp:tbl");
      const zone = tblIdx >= 0 ? between.slice(0, tblIdx) : between;
      let kept = 0;
      const cleaned = zone.replace(P_G_RE, (p) => {
        const text = [...p.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)].map((t) => t[1]).join("");
        // 텍스트·개체 문단 + 구분선 문단(하단 고정부 위 선 = hp:line 그리기 개체 — 실측)은 보존
        if (text.trim() || /<hp:pic\b|<hp:ctrl\b|<hp:line\b/.test(p) || isLineParagraph(headerXml, p)) return p;
        kept += 1;
        return kept <= 2 ? p : "";
      });
      xml = xml.slice(0, start) + cleaned + between.slice(zone.length) + xml.slice(end);
    }
  }

  xml = xml.replace(bodyP, bodyXmlParts.join(""));

  // ── 5) 인감 제거(날인 미선택 시) — 템플릿에 미리 배치된 인감 그림 개체 제거 ──
  if (!layout.stamp) {
    xml = removeStampPicture(xml);
  }

  // ── 6) 토큰 치환 ──
  const tokens: Record<string, string> = {
    RECEIVER: layout.receiverText ?? "",
    REF: layout.refText ?? "",
    SUBJECT: layout.subject,
    CONTACT_NAME: spread(layout.contactName),
    // 담당 직함 뒤 공백 패딩 — '대 표 이 사' 표기와의 간격 확보(사용자 실측 요구)
    CONTACT_POSITION: `${layout.contactPosition}          `,
    LETTER_NO: layout.letterNo ?? "(채번 예정)",
    ISSUE_DATE: layout.issueDate,
    PHONE: layout.contactPhone,
    EMAIL: layout.contactEmail,
    BODY: "", // 잔여 방어
    S_BOLD: "",
    S_TABLE: "",
  };
  xml = xml.replace(TOKEN_RE, (_, key) => escapeXml(tokens[String(key).trim()] ?? ""));

  zip.file(sectionPath, xml);
  if (headerXml) zip.file(headerPath, headerXml);
  const mimetype = zip.file("mimetype");
  if (mimetype) zip.file("mimetype", await mimetype.async("uint8array"), { compression: "STORE" });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

/** 이름 글자 벌리기 — pdf.ts 와 동일 표기. */
function spread(name: string): string {
  const t = (name ?? "").trim();
  return /^[가-힣]{2,4}$/.test(t) ? t.split("").join(" ") : t;
}

/** 표 블록 → hp:tbl XML(참조 표 골격 재사용). 표 전체 폭은 참조 표의 hp:sz 를 따른다. */
function buildTableXml(
  t: Extract<LetterBlock, { kind: "table" }>,
  tpl: TableTemplate,
  fontPt: number,
  charPr: string,
  boldCharPr: string | null,
  alignParaPrOf: (align: "CENTER" | "RIGHT") => string | null
): string {
  const cols = t.colRatios.length;
  const rows = t.rows.length;
  // 참조 표의 전체 폭(hp:sz width) — 없으면 본문 폭 근사(A4 여백 제외 487pt)
  const totalW = Number(attrOf(tpl.preamble, "hp:sz", "width") ?? Math.round(487 * 100));
  const widths = t.colRatios.map((r) => Math.round(r * totalW));
  // 행 높이 = 행 내 최대 줄 수 기준(줄간 180% + 셀 여백) — 참조 셀 높이는 과대해 치환한다.
  // 세로 병합 셀은 1행 스팬 셀로 높이를 정한 뒤, 내용이 스팬 합계를 넘으면 마지막 행에 가산(2026-08-25).
  const lineHwp = Math.round(fontPt * 1.8 * 100);
  const rowHeights = t.rows.map((row) => {
    const single = row.filter((c) => !c.covered && (c.rowSpan ?? 1) <= 1);
    const maxLines = Math.max(1, ...single.map((c) => Math.max(1, c.lines.length)));
    return maxLines * lineHwp + 600;
  });
  t.rows.forEach((row, ri) => {
    row.forEach((cell) => {
      const rs = cell.rowSpan ?? 1;
      if (cell.covered || rs <= 1) return;
      const need = Math.max(1, cell.lines.length) * lineHwp + 600;
      const got = rowHeights.slice(ri, ri + rs).reduce((a, b) => a + b, 0);
      if (need > got) rowHeights[Math.min(ri + rs, rowHeights.length) - 1] += need - got;
    });
  });
  const totalH = rowHeights.reduce((a, b) => a + b, 0);
  const preamble = tpl.preamble
    .replace(/(\browCnt=")\d+(")/, `$1${rows}$2`)
    .replace(/(\bcolCnt=")\d+(")/, `$1${cols}$2`)
    .replace(/(<hp:sz\b[^>]*height=")\d+(")/, `$1${totalH}$2`);
  const colW = (ci: number, colSpan: number) => {
    let w = 0;
    for (let i = ci; i < ci + colSpan; i++) w += widths[i] ?? Math.round(totalW / cols);
    return w;
  };
  const trs = t.rows
    .map((row, ri) => {
      const tcs = row
        .map((cell, ci) => {
          if (cell.covered) return ""; // 병합 점유 자리 — 시작 셀의 cellSpan 이 대신한다
          const spanH = rowHeights.slice(ri, ri + (cell.rowSpan ?? 1)).reduce((a, b) => a + b, 0);
          return fillTcTemplate(tpl.tcTpl, cell, ci, ri, colW(ci, cell.colSpan ?? 1), spanH, charPr, boldCharPr, alignParaPrOf);
        })
        .join("");
      return `<hp:tr>${tcs}</hp:tr>`;
    })
    .join("");
  const tbl = `${preamble}${trs}</hp:tbl>`;
  return tpl.wrapP.replace("__TBL__", tbl);
}

/** 서명줄 인감 그림 개체 제거 — 문서 내 hp:pic 중 인감(정사각 비율 근사)만 제거. */
function removeStampPicture(xml: string): string {
  // 템플릿 규약: 인감은 서명줄 주변 유일한 그림 개체(로고는 머리부에 있으나 비율이 2:1 이상).
  return xml.replace(/<hp:pic\b[\s\S]*?<\/hp:pic>/g, (pic) => {
    const w = Number(attrOf(pic, "hc:orgSz", "width") ?? attrOf(pic, "hp:orgSz", "width") ?? 0);
    const h = Number(attrOf(pic, "hc:orgSz", "height") ?? attrOf(pic, "hp:orgSz", "height") ?? 0);
    if (w > 0 && h > 0 && w / h < 1.4) return ""; // 정사각형에 가까우면 인감으로 판정
    return pic;
  });
}
