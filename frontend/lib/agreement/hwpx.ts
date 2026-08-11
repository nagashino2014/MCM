// 계약서 HWPX 렌더러 — 두 경로:
// ① standard-a(실측 표준 도급계약서): public/hwpx/agreement.hwpx 의 갑지 표(11행×7열)·서식을
//    **그대로 보존**하고 셀 좌표(colAddr,rowAddr)로 값만 치환한다. 조문 구간만 프로그램 생성으로
//    교체하고, 말미 서명부는 실측(2단 무테두리)을 무테두리 표로 재현한다
//    (2026-08-11 사용자 확정: hwpx 는 표준 양식과 똑같아야 함).
// ② 폴백(B형 1장 갑지·비표준 custom): 템플릿 스타일만 빌려 본문 전체를 프로그램 생성한다.
// 기법: lib/letter/hwpx.ts 이식(스타일 참조=목록 인덱스라 신규 등록은 목록 끝 append·표 골격 추출).

import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { renderBinding, renderTemplate, spreadName } from "@/lib/deliverable/format";
import type { CellSpec, DeliverableValues, DocBlock } from "@/lib/deliverable/types";
import { AGREEMENT_COMPANY_ADDRESS, buildCoverValues, estimateLines, resolveClauses } from "./compose";
import { COMPANY_BIZ_NO, COMPANY_CEO, COMPANY_KO } from "@/lib/letter/types";
import type { AgreementFieldValues, AgreementSpec } from "./types";

const LINESEG_RE = /<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g;
const P_G_RE = /<hp:p\b[\s\S]*?<\/hp:p>/g;
const T_ALL_RE = /<hp:t>[\s\S]*?<\/hp:t>/g;

/** A4 콘텐츠 폭(HWPUNIT = pt×100) — 실측 갑지 표 전폭(50442)과 근사 */
const CONTENT_W_HWP = Math.round((595.28 - 57 - 57) * 100);

function escapeXml(value: string): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function attrOf(xml: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`);
  return re.exec(xml)?.[1] ?? null;
}

/** 목록 끝 append — 한글은 스타일 참조를 목록 인덱스로 해석(letter/hwpx.ts 실사고 교훈) */
function appendToList(headerXml: string, closing: string, cntTag: string, clone: string): string | null {
  if (!headerXml.includes(closing)) return null;
  const withClone = headerXml.replace(closing, clone + closing);
  return withClone.replace(new RegExp(`(<${cntTag}\\b[^>]*\\bitemCnt=")(\\d+)(")`), (_, a, n, b) => `${a}${Number(n) + 1}${b}`);
}

function registerParaPr(
  headerXml: string,
  baseId: string,
  patch: { align?: "CENTER" | "RIGHT" | "LEFT" }
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
    clone = clone.replace(/(<hc:intent\b[^>]*value=")[^"]*(")/, `$10$2`);
  }
  const xml = appendToList(headerXml, "</hh:paraProperties>", "hh:paraProperties", clone);
  return xml ? { xml, id: newId } : null;
}

function registerCharPr(
  headerXml: string,
  baseId: string,
  patch: { heightPt?: number; bold?: boolean; spacingPct?: number }
): { xml: string; id: string } | null {
  const blockRe = new RegExp(
    `<hh:charPr\\b[^>]*\\bid="${baseId}"[\\s\\S]*?</hh:charPr>|<hh:charPr\\b[^>]*\\bid="${baseId}"[^>]*/>`
  );
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

/** header.xml 에 무테두리 borderFill 등록 — 말미 2단 서명부(실측: 선 없는 2단) */
function registerNoneBorderFill(headerXml: string): { xml: string; id: string } | null {
  let maxId = 0;
  for (const idm of headerXml.matchAll(/<hh:borderFill\b[^>]*\bid="(\d+)"/g)) maxId = Math.max(maxId, Number(idm[1]));
  if (maxId === 0) return null;
  const newId = String(maxId + 1);
  const edge = 'type="NONE" width="0.1 mm" color="#000000"';
  const fill =
    `<hh:borderFill id="${newId}" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">` +
    '<hh:slash type="NONE" Crooked="0" isCounter="0"/><hh:backSlash type="NONE" Crooked="0" isCounter="0"/>' +
    `<hh:leftBorder ${edge}/><hh:rightBorder ${edge}/><hh:topBorder ${edge}/><hh:bottomBorder ${edge}/>` +
    '<hh:diagonal type="SOLID" width="0.1 mm" color="#000000"/></hh:borderFill>';
  const xml = appendToList(headerXml, "</hh:borderFills>", "hh:borderFills", fill);
  return xml ? { xml, id: newId } : null;
}

interface Styles {
  bodyParaPr: string;
  bodyCharPr: string;
  centerParaPr: string;
  titleCharPr: string;
  boldCharPr: string;
  tblPreamble: string;
  tcTpl: string;
}

function paragraphXml(text: string, paraPr: string, charPr: string, pageBreak = false): string {
  const runs = `<hp:run charPrIDRef="${charPr}"><hp:t>${escapeXml(text)}</hp:t></hp:run>`;
  return `<hp:p id="0" paraPrIDRef="${paraPr}" styleIDRef="0" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0">${runs}</hp:p>`;
}

/** 문단 XML 텍스트 교체(첫 hp:t 에 값, 나머지 비움) — letter/hwpx.ts setParagraphText 이식 */
function setParaText(pXml: string, value: string): string {
  let first = true;
  if (/<hp:t>/.test(pXml)) {
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
  return pXml;
}

/**
 * 셀 subList 안 문단들을 lines 로 교체 — **hp:t 를 가진 텍스트 문단에만** 값을 순서대로 배정한다.
 * 실측 셀은 값 문단 사이에 빈 문단(행간 여백)이 끼어 있으므로(예: 날인란 상호/[빈]/주소/[빈]/대표),
 * 빈 문단은 그대로 보존해야 원본 서식과 같아진다. 값이 텍스트 문단보다 많으면 마지막 텍스트
 * 문단을 복제해 덧붙이고, 적으면 남는 텍스트 문단을 비운다.
 */
function replaceCellParas(tcXml: string, lines: string[]): string {
  const subM = /(<hp:subList\b[^>]*>)([\s\S]*?)(<\/hp:subList>)/.exec(tcXml);
  if (!subM) return tcXml;
  const paras = [...subM[2].matchAll(P_G_RE)].map((p) => p[0]);
  if (!paras.length) return tcXml;
  const textIdx = paras.map((p, i) => (/<hp:t>/.test(p) ? i : -1)).filter((i) => i >= 0);
  if (!textIdx.length) return tcXml;
  const texts = lines.length ? lines : [""];
  const out = [...paras];
  for (let k = 0; k < Math.min(texts.length, textIdx.length); k++) {
    out[textIdx[k]] = setParaText(paras[textIdx[k]], texts[k]);
  }
  for (let k = texts.length; k < textIdx.length; k++) {
    out[textIdx[k]] = setParaText(paras[textIdx[k]], "");
  }
  if (texts.length > textIdx.length) {
    const lastI = textIdx[textIdx.length - 1];
    const extra = texts.slice(textIdx.length).map((t) => setParaText(paras[lastI], t)).join("");
    out[lastI] = out[lastI] + extra;
  }
  return tcXml.replace(subM[0], subM[1] + out.join("") + subM[3]);
}

/** 갑지 표에서 (colAddr,rowAddr) 셀을 찾아 교체 */
function replaceTableCell(tblXml: string, col: number, row: number, lines: string[]): string {
  const tcRe = /<hp:tc\b[\s\S]*?<\/hp:tc>/g;
  return tblXml.replace(tcRe, (tc) => {
    const addr = /colAddr="(\d+)" rowAddr="(\d+)"/.exec(tc);
    if (!addr || Number(addr[1]) !== col || Number(addr[2]) !== row) return tc;
    return replaceCellParas(tc, lines);
  });
}

function cellXml(
  st: Styles,
  cell: CellSpec,
  text: string,
  col: number,
  row: number,
  colSpan: number,
  rowSpan: number,
  widthHwp: number,
  heightHwp: number
): string {
  let tc = st.tcTpl;
  tc = tc.replace(/(<hp:cellAddr\b[^>]*colAddr=")\d+(")/, `$1${col}$2`).replace(/(\browAddr=")\d+(")/, `$1${row}$2`);
  tc = tc.replace(/(<hp:cellSpan\b[^>]*colSpan=")\d+(")/, `$1${colSpan}$2`).replace(/(\browSpan=")\d+(")/, `$1${rowSpan}$2`);
  tc = tc.replace(/(<hp:cellSz\b[^>]*width=")\d+(")/, `$1${widthHwp}$2`).replace(/(<hp:cellSz\b[^>]*height=")\d+(")/, `$1${heightHwp}$2`);
  const subM = /<hp:subList\b[^>]*>([\s\S]*?)<\/hp:subList>/.exec(tc);
  if (subM) {
    const charPr = cell.bold ? st.boldCharPr : st.bodyCharPr;
    const paraPr = cell.align === "center" || (cell.colSpan ?? 1) > 1 ? st.centerParaPr : st.bodyParaPr;
    const paras = (text.split(/\r?\n/).length ? text.split(/\r?\n/) : [""])
      .map((ln) => paragraphXml(ln, cell.align === "left" ? st.bodyParaPr : paraPr, charPr))
      .join("");
    tc = tc.replace(subM[1], paras);
  }
  return tc;
}

/** table DocBlock → hp:tbl XML (colSpan/rowSpan 병합 지원, 폴백 경로·말미 서명부용) */
function tableXml(
  st: Styles,
  block: Extract<DocBlock, { kind: "table" }>,
  values: DeliverableValues,
  opts: { borderFillId?: string } = {}
): string {
  const cols = block.columns.length;
  const rows = block.rows.length;
  const colW = block.columns.map((c) => Math.round(CONTENT_W_HWP * c.widthRatio));
  const rowH = 900;

  let preamble = st.tblPreamble
    .replace(/(\browCnt=")\d+(")/, `$1${rows}$2`)
    .replace(/(\bcolCnt=")\d+(")/, `$1${cols}$2`);
  preamble = preamble.replace(/(<hp:sz\b[^>]*width=")\d+(")/, `$1${CONTENT_W_HWP}$2`);
  let tcTplUse = st.tcTpl;
  if (opts.borderFillId) {
    preamble = preamble.replace(/(\bborderFillIDRef=")\d+(")/, `$1${opts.borderFillId}$2`);
    tcTplUse = tcTplUse.replace(/(\bborderFillIDRef=")\d+(")/g, `$1${opts.borderFillId}$2`);
  }
  const stUse: Styles = { ...st, tcTpl: tcTplUse };

  const trs = block.rows
    .map((row, ri) => {
      const tcs = row
        .map((cell, ci) => {
          if (cell.merged) return "";
          const span = cell.colSpan ?? 1;
          const rspan = cell.rowSpan ?? 1;
          const w = colW.slice(ci, ci + span).reduce((a, b) => a + b, 0);
          const text = cell.binding ? renderBinding(cell.binding, values, cell.format) : renderTemplate(cell.text ?? "", values);
          return cellXml(stUse, cell, text, ci, ri, span, rspan, w, rowH * rspan);
        })
        .join("");
      return `<hp:tr>${tcs}</hp:tr>`;
    })
    .join("");

  return preamble + trs + "</hp:tbl>";
}

function tableParagraphXml(st: Styles, tbl: string): string {
  return `<hp:p id="0" paraPrIDRef="${st.centerParaPr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${st.bodyCharPr}">${tbl}<hp:t></hp:t></hp:run></hp:p>`;
}

/** 갑지 블록 1개 → 문단 XML (폴백 경로 — B형·비표준 custom) */
function coverBlockXml(st: Styles, block: DocBlock, values: DeliverableValues): string {
  switch (block.kind) {
    case "title":
      return paragraphXml(renderTemplate(block.text, values), st.centerParaPr, st.titleCharPr);
    case "table":
      return tableParagraphXml(st, tableXml(st, block, values));
    case "para": {
      const text = renderTemplate(block.text, values);
      if (!text.trim()) return "";
      return text
        .split(/\r?\n/)
        .map((ln) => paragraphXml(ln, block.align === "center" ? st.centerParaPr : st.bodyParaPr, st.bodyCharPr))
        .join("");
    }
    case "dateLine":
      return paragraphXml(renderBinding(block.binding, values, block.format), st.centerParaPr, st.bodyCharPr);
    case "spacer":
      return paragraphXml("", st.bodyParaPr, st.bodyCharPr);
    default:
      return "";
  }
}

/** 조문(전문~말미 서명) 문단 시퀀스 생성 — 두 경로가 공유 */
function clauseSectionXml(
  st: Styles,
  spec: AgreementSpec,
  fv: AgreementFieldValues,
  values: DeliverableValues,
  opts: { titlePageBreak: boolean; noneBorderFillId: string | null }
): string {
  const cp = spec.clausePage!;
  const out: string[] = [];
  out.push(paragraphXml(cp.title, st.centerParaPr, st.titleCharPr, opts.titlePageBreak));
  out.push(paragraphXml("", st.bodyParaPr, st.bodyCharPr));
  if (cp.preamble) {
    const pre = cp.preamble.replace(/\{\{([\w.]+)\}\}/g, (_, k: string) => String(values[k] ?? ""));
    for (const ln of pre.split(/\r?\n/)) out.push(paragraphXml(ln, st.bodyParaPr, st.bodyCharPr));
    out.push(paragraphXml("", st.bodyParaPr, st.bodyCharPr));
  }
  const resolved = resolveClauses(fv.clauses, { terms: spec.terms, clausePage: cp }, fv, values);
  for (const c of resolved) {
    out.push(paragraphXml(c.heading, st.bodyParaPr, st.boldCharPr));
    for (const ln of c.body.split(/\r?\n/)) {
      if (ln.trim()) out.push(paragraphXml(`  ${ln}`, st.bodyParaPr, st.bodyCharPr));
    }
    out.push(paragraphXml("", st.bodyParaPr, st.bodyCharPr));
  }
  if (cp.closing) out.push(paragraphXml(cp.closing, st.bodyParaPr, st.bodyCharPr));
  if (cp.signAfterClosing) {
    out.push(paragraphXml("", st.bodyParaPr, st.bodyCharPr));
    out.push(paragraphXml(renderBinding("issue.dateKorean", values), st.centerParaPr, st.bodyCharPr));
    out.push(paragraphXml("", st.bodyParaPr, st.bodyCharPr));
    // 실측 말미: "(발주자)/(과업수행자)" 2단 무테두리 — 무테두리 표로 재현
    const signTable: Extract<DocBlock, { kind: "table" }> = {
      kind: "table",
      columns: [{ widthRatio: 0.5 }, { widthRatio: 0.5 }],
      rows: [
        [
          { text: `(${spec.terms.orderer})`, bold: true, align: "left" },
          { text: `(${spec.terms.contractor})`, bold: true, align: "left" },
        ],
        [
          { binding: "orderer.tailSign", format: "multiline", align: "left" },
          { binding: "company.tailSign", format: "multiline", align: "left" },
        ],
      ],
    };
    out.push(
      tableParagraphXml(st, tableXml(st, signTable, values, { borderFillId: opts.noneBorderFillId ?? undefined }))
    );
  }
  return out.join("");
}

const templateCache = new Map<string, Buffer>();
async function loadTemplate(file: string): Promise<Buffer> {
  const cached = templateCache.get(file);
  if (cached) return cached;
  const bytes = await readFile(path.join(process.cwd(), "public", "hwpx", file));
  templateCache.set(file, bytes);
  return bytes;
}

export async function renderAgreementHwpx(spec: AgreementSpec, fv: AgreementFieldValues): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(await loadTemplate("agreement.hwpx"));
  const sectionPath = "Contents/section0.xml";
  const section = zip.file(sectionPath);
  if (!section) throw new Error("agreement.hwpx 템플릿에 section0.xml 이 없습니다");
  let xml = (await section.async("string")).replace(LINESEG_RE, "");
  const headerPath = "Contents/header.xml";
  let headerXml = (await zip.file(headerPath)?.async("string")) ?? "";

  // ── 스타일·표 골격 추출 (두 경로 공용) ──
  let bodyParaPr = "0";
  let bodyCharPr = "0";
  for (const pm of xml.matchAll(P_G_RE)) {
    const text = [...pm[0].matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)].map((t) => t[1]).join("");
    if (text.includes("체결한다") || text.includes("목적으로 한다")) {
      bodyParaPr = attrOf(pm[0], "hp:p", "paraPrIDRef") ?? "0";
      bodyCharPr = attrOf(pm[0], "hp:run", "charPrIDRef") ?? "0";
      break;
    }
  }
  P_G_RE.lastIndex = 0;

  const tblM = /<hp:tbl\b[\s\S]*?<\/hp:tbl>/.exec(xml);
  if (!tblM) throw new Error("agreement.hwpx 템플릿에 표가 없습니다");
  const firstTr = tblM[0].indexOf("<hp:tr");
  const tblPreamble = firstTr >= 0 ? tblM[0].slice(0, firstTr) : tblM[0];
  const tcM = /<hp:tc\b[\s\S]*?<\/hp:tc>/.exec(tblM[0]);
  if (!tcM) throw new Error("agreement.hwpx 템플릿 표에 셀이 없습니다");

  const centerP = registerParaPr(headerXml, bodyParaPr, { align: "CENTER" });
  if (centerP) headerXml = centerP.xml;
  const titleC = registerCharPr(headerXml, bodyCharPr, { heightPt: 16, bold: true, spacingPct: 30 });
  if (titleC) headerXml = titleC.xml;
  const boldC = registerCharPr(headerXml, bodyCharPr, { bold: true });
  if (boldC) headerXml = boldC.xml;
  const noneFill = registerNoneBorderFill(headerXml);
  if (noneFill) headerXml = noneFill.xml;

  const st: Styles = {
    bodyParaPr,
    bodyCharPr,
    centerParaPr: centerP?.id ?? bodyParaPr,
    titleCharPr: titleC?.id ?? bodyCharPr,
    boldCharPr: boldC?.id ?? bodyCharPr,
    tblPreamble,
    tcTpl: tcM[0],
  };

  const values = buildCoverValues(fv);

  if (spec.hwpxTemplate === "standard-a") {
    // ── ① 원본 보존 경로 — 갑지 표 셀 치환 + 조문 구간만 교체 ──
    const o = fv.orderer;
    // 복수 대표("이시창, 황문성")는 그대로, 단수는 실측 관례대로 벌려 쓴다("장 세 준")
    const ceoDisp = o.ceo ? (o.ceo.includes(",") ? o.ceo : spreadName(o.ceo)) : "";
    // 값 앞 여백은 전 항목 1칸으로 통일(2026-08-11 사용자 확정 — 원본은 셀마다 0~2칸 제각각)
    const pad = (s: string) => (s && !s.startsWith(" ") ? ` ${s}` : s);
    let tbl = tblM[0];
    tbl = replaceTableCell(tbl, 4, 1, [pad(o.name)]);
    tbl = replaceTableCell(tbl, 4, 2, [pad(COMPANY_KO)]); // 원본 선행 2칸 → 1칸 통일
    tbl = replaceTableCell(tbl, 4, 3, [pad(COMPANY_BIZ_NO)]);
    tbl = replaceTableCell(tbl, 4, 4, [pad(fv.title)]);
    tbl = replaceTableCell(tbl, 4, 5, [pad(String(values["amount.totalLine"]))]);
    tbl = replaceTableCell(tbl, 4, 6, String(values["amount.supplyVatLines"]).split("\n").map(pad));
    tbl = replaceTableCell(tbl, 4, 7, String(values["payment.summary"]).split("\n").map(pad));
    tbl = replaceTableCell(tbl, 4, 8, [pad(fv.periodText)]);
    // 체결문 셀은 실측이 [체결문]/[빈]/[날짜]/[빈]/[첨부] 구조 — 텍스트 문단 3개에 순서 배정
    tbl = replaceTableCell(tbl, 0, 9, String(values["cover.execText"]).split("\n").filter(Boolean).map(pad));
    // 날인란 — 주소 줄 수를 좌우 맞춰 "대표이사" 줄 높이 일치(빈 줄 보충). 셀 내폭 ≈ 175pt
    {
      const ordL = estimateLines(o.address, 172);
      const coL = estimateLines(AGREEMENT_COMPANY_ADDRESS, 172);
      const maxL = Math.max(ordL, coL);
      const fill = (n: number) => Array(Math.max(0, n)).fill("");
      const coCeo = spreadName(COMPANY_CEO);
      tbl = replaceTableCell(tbl, 2, 10, [pad(o.name), pad(o.address), ...fill(maxL - ordL), pad(`대표이사 ${ceoDisp} (인)`)]);
      tbl = replaceTableCell(tbl, 6, 10, [pad(COMPANY_KO), pad(AGREEMENT_COMPANY_ADDRESS), ...fill(maxL - coL), pad(`대표이사 ${coCeo} (인)`)]);
    }
    xml = xml.replace(tblM[0], tbl);

    // 표 이후 문단(조문+말미) 전부 제거 — 표를 감싼 문단은 보존해야 하므로 표 뒤 구간만 다룬다
    const tblEnd = xml.indexOf(tbl) + tbl.length;
    const head = xml.slice(0, tblEnd);
    let tail = xml.slice(tblEnd);
    const tailParas = [...tail.matchAll(P_G_RE)].map((p) => p[0]);
    for (const p of tailParas) tail = tail.replace(p, "");
    const clausesXml =
      fv.hasClausePage && spec.clausePage && fv.clauses.length
        ? clauseSectionXml(st, spec, fv, values, { titlePageBreak: true, noneBorderFillId: noneFill?.id ?? null })
        : "";
    // 표를 감싼 문단이 닫힌 직후 위치에 조문 삽입 — tail 의 첫 지점에 넣는다
    xml = head + clausesXml + tail;
  } else {
    // ── ② 폴백 — 본문 전면 프로그램 생성(B형·비표준 custom) ──
    const paras = [...xml.matchAll(P_G_RE)].map((mm) => mm[0]);
    if (!paras.length) throw new Error("agreement.hwpx 본문 문단을 찾지 못했습니다");
    const firstPara = paras[0];
    let keepFirst = firstPara.replace(T_ALL_RE, "<hp:t></hp:t>");
    keepFirst = keepFirst.replace(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g, "");
    for (const p of paras) xml = xml.replace(p, p === firstPara ? "__FIRST__" : "");

    const out: string[] = [];
    for (const block of spec.coverBlocks) out.push(coverBlockXml(st, block, values));
    if (fv.hasClausePage && spec.clausePage && fv.clauses.length) {
      out.push(clauseSectionXml(st, spec, fv, values, { titlePageBreak: true, noneBorderFillId: noneFill?.id ?? null }));
    }
    xml = xml.replace("__FIRST__", keepFirst + out.join(""));
  }

  zip.file(sectionPath, xml);
  if (headerXml) zip.file(headerPath, headerXml);
  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
