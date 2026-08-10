// 계약서 HWPX 렌더러 — public/hwpx/agreement.hwpx(실측 도급계약서를 그대로 템플릿화)의
// 스타일(paraPr/charPr)·표 골격(tcTpl)을 추출한 뒤, 본문을 프로그램 생성 XML 로 전면 교체한다.
// 기법: lib/letter/hwpx.ts(스타일 참조=목록 인덱스라 신규 등록은 목록 끝 append·표 골격 추출)
// 이식. 공문과 달리 A4 1장 fit 이 없다 — 갑지 표 + 페이지 나눔 + 조문 문단 흐름(한글이
// linesegarray 를 재계산). HWPX 는 발주처 수정 협의용 편집본이며 검토·보관 원본은 PDF 다.

import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { renderBinding, renderTemplate } from "@/lib/deliverable/format";
import type { CellSpec, DeliverableValues, DocBlock } from "@/lib/deliverable/types";
import { buildCoverValues, resolveClauses } from "./compose";
import type { AgreementFieldValues, AgreementSpec } from "./types";

const LINESEG_RE = /<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g;
const P_G_RE = /<hp:p\b[\s\S]*?<\/hp:p>/g;
const T_ALL_RE = /<hp:t>[\s\S]*?<\/hp:t>/g;

/** A4 콘텐츠 폭(HWPUNIT = pt×100) — PDF 렌더(DEFAULT_MARGINS 57/57)와 동일 폭 */
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

interface Styles {
  bodyParaPr: string;
  bodyCharPr: string;
  centerParaPr: string;
  titleCharPr: string; // 크게+볼드+자간
  boldCharPr: string;
  tblPreamble: string; // <hp:tbl …> ~ 첫 tr 직전
  tcTpl: string;
}

function paragraphXml(text: string, paraPr: string, charPr: string, pageBreak = false): string {
  const runs = text
    ? `<hp:run charPrIDRef="${charPr}"><hp:t>${escapeXml(text)}</hp:t></hp:run>`
    : `<hp:run charPrIDRef="${charPr}"><hp:t></hp:t></hp:run>`;
  return `<hp:p id="0" paraPrIDRef="${paraPr}" styleIDRef="0" pageBreak="${pageBreak ? 1 : 0}" columnBreak="0" merged="0">${runs}</hp:p>`;
}

/** 셀 하나 — tcTpl 복제 후 주소·병합·크기·문단 교체(letter fillTcTemplate 이식) */
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

/** table DocBlock → hp:tbl XML (colSpan/rowSpan 병합 지원) */
function tableXml(st: Styles, block: Extract<DocBlock, { kind: "table" }>, values: DeliverableValues): string {
  const cols = block.columns.length;
  const rows = block.rows.length;
  const colW = block.columns.map((c) => Math.round(CONTENT_W_HWP * c.widthRatio));
  const rowH = 900; // 9pt 기본 — 한글이 내용에 맞춰 자동 확장

  let preamble = st.tblPreamble
    .replace(/(\browCnt=")\d+(")/, `$1${rows}$2`)
    .replace(/(\bcolCnt=")\d+(")/, `$1${cols}$2`);
  // 표 크기 치환(hp:sz) — 콘텐츠 폭 기준
  preamble = preamble.replace(/(<hp:sz\b[^>]*width=")\d+(")/, `$1${CONTENT_W_HWP}$2`);

  const trs = block.rows
    .map((row, ri) => {
      const tcs = row
        .map((cell, ci) => {
          if (cell.merged) return "";
          const span = cell.colSpan ?? 1;
          const rspan = cell.rowSpan ?? 1;
          const w = colW.slice(ci, ci + span).reduce((a, b) => a + b, 0);
          const text = cell.binding ? renderBinding(cell.binding, values, cell.format) : renderTemplate(cell.text ?? "", values);
          return cellXml(st, cell, text, ci, ri, span, rspan, w, rowH * rspan);
        })
        .join("");
      return `<hp:tr>${tcs}</hp:tr>`;
    })
    .join("");

  return preamble + trs + "</hp:tbl>";
}

/** 표를 담는 문단 — 표는 run 안에 들어간다 */
function tableParagraphXml(st: Styles, tbl: string): string {
  return `<hp:p id="0" paraPrIDRef="${st.centerParaPr}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="${st.bodyCharPr}">${tbl}<hp:t></hp:t></hp:run></hp:p>`;
}

/** 갑지 블록 1개 → 문단 XML (계약서 갑지가 쓰는 종류만) */
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

  // ── 1) 스타일·표 골격 추출 — 실측 문서에서 조문 본문 문단과 갑지 표를 빌린다 ──
  // 본문 스타일: "제 1 조"를 포함한 문단(제목)과 그 본문 문단 대신, 전문(체결한다) 문단을 기준으로.
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

  // 파생 스타일 등록(전부 목록 끝 append)
  const centerP = registerParaPr(headerXml, bodyParaPr, { align: "CENTER" });
  if (centerP) headerXml = centerP.xml;
  const titleC = registerCharPr(headerXml, bodyCharPr, { heightPt: 18, bold: true, spacingPct: 30 });
  if (titleC) headerXml = titleC.xml;
  const boldC = registerCharPr(headerXml, bodyCharPr, { bold: true });
  if (boldC) headerXml = boldC.xml;

  const st: Styles = {
    bodyParaPr,
    bodyCharPr,
    centerParaPr: centerP?.id ?? bodyParaPr,
    titleCharPr: titleC?.id ?? bodyCharPr,
    boldCharPr: boldC?.id ?? bodyCharPr,
    tblPreamble,
    tcTpl: tcM[0],
  };

  // ── 2) 본문 전면 교체 — 첫 문단(secPr 보유)만 남기고 나머지 문단 제거 ──
  const paras = [...xml.matchAll(P_G_RE)].map((m) => m[0]);
  if (!paras.length) throw new Error("agreement.hwpx 본문 문단을 찾지 못했습니다");
  const firstPara = paras[0];
  // 첫 문단은 골격 유지 + 텍스트 비움(섹션 정의 보존)
  let keepFirst = firstPara;
  if (T_ALL_RE.test(keepFirst)) {
    let first = true;
    keepFirst = keepFirst.replace(T_ALL_RE, () => {
      if (first) {
        first = false;
        return "<hp:t></hp:t>";
      }
      return "<hp:t></hp:t>";
    });
  }
  // 첫 문단 내 표(갑지가 첫 문단에 들어있는 실측 구조)도 제거
  keepFirst = keepFirst.replace(/<hp:tbl\b[\s\S]*?<\/hp:tbl>/g, "");
  for (const p of paras) xml = xml.replace(p, p === firstPara ? "__FIRST__" : "");

  // ── 3) 본문 생성 ──
  const values = buildCoverValues(fv);
  const out: string[] = [];
  for (const block of spec.coverBlocks) out.push(coverBlockXml(st, block, values));

  if (fv.hasClausePage && spec.clausePage && fv.clauses.length) {
    const cp = spec.clausePage;
    // 별지 첫 문단은 페이지 나눔
    out.push(paragraphXml(cp.title, st.centerParaPr, st.titleCharPr, true));
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
      out.push(paragraphXml(renderBinding("issue.date", values, "dateKorean"), st.centerParaPr, st.bodyCharPr));
      out.push(paragraphXml("", st.bodyParaPr, st.bodyCharPr));
      const signTable: Extract<DocBlock, { kind: "table" }> = {
        kind: "table",
        columns: [
          { widthRatio: 0.15, align: "center" },
          { widthRatio: 0.35 },
          { widthRatio: 0.15, align: "center" },
          { widthRatio: 0.35 },
        ],
        rows: [
          [
            { text: `(${spec.terms.orderer})`, bold: true },
            { binding: "orderer.signText", format: "multiline", align: "left" },
            { text: `(${spec.terms.contractor})`, bold: true },
            { binding: "company.signText", format: "multiline", align: "left" },
          ],
        ],
      };
      out.push(tableParagraphXml(st, tableXml(st, signTable, values)));
    }
  }

  xml = xml.replace("__FIRST__", keepFirst + out.join(""));

  zip.file(sectionPath, xml);
  if (headerXml) zip.file(headerPath, headerXml);
  return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
