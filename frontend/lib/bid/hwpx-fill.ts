import JSZip from "jszip";
import sharp from "sharp";
import type { FormProfile, ProfileDoc } from "@/lib/bid/form-analyze";
import type { PackageData } from "@/lib/bid/package-data";
import { resolveSingleValue, resolveRepeatRows, personCount, cleanServiceTitle } from "@/lib/bid/package-values";

/*
 * 입찰 서류 양식 HWPX 주입 엔진(P3) — form_profile 셀 매핑에 데이터를 채워 제출본 HWPX 를 만든다.
 * - 단일 필드: 셀 텍스트 교체(개행 값은 문단 복제)
 * - 반복 행: 템플릿 행 복제·rowAddr/rowCnt 재계산(합계 등 보존 행은 뒤로 시프트)
 * - 인당 1표(perPersonTable): 문서의 표들을 인원수에 맞춰 채우고 남으면 제거/모자라면 복제
 * - 본문 치환(동의서·서약서 용역명): 셀 내 『…』 구간만 교체
 * - 행이 늘어난 표는 pageBreak="TABLE"(셀 단위 나눔) 강제 + linesegarray 제거(한글 재계산)
 */

const TBL_RE = /<hp:tbl\b[^>]*>[\s\S]*?<\/hp:tbl>/g;
const TR_RE = /<hp:tr\b[\s\S]*?<\/hp:tr>/g;
const TC_RE = /<hp:tc\b[\s\S]*?<\/hp:tc>/g;
const ADDR_RE = /<hp:cellAddr colAddr="(\d+)" rowAddr="(\d+)"\/?>/;
const P_RE = /<hp:p\b[\s\S]*?<\/hp:p>/;
const T_RE = /<hp:t>([\s\S]*?)<\/hp:t>/;
const T_ALL_RE = /<hp:t>[\s\S]*?<\/hp:t>/g;
const LINESEG_RE = /<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g;

function escapeXml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 문단 XML 의 텍스트를 value 로 교체(첫 hp:t 에 값, 나머지 hp:t 비움). hp:t 없으면 run 에 삽입. */
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
  // hp:t 가 없는 빈 문단 — 첫 run 닫힘 직전에 삽입
  const runClose = pXml.indexOf("</hp:run>");
  if (runClose >= 0) {
    return pXml.slice(0, runClose) + `<hp:t>${escapeXml(value)}</hp:t>` + pXml.slice(runClose);
  }
  // self-closing run(<hp:run .../>) — 열림 태그로 바꿔 hp:t 삽입(빈 문단 셀에서 값 유실 방지)
  const selfRun = /<hp:run\b[^>]*\/>/.exec(pXml);
  if (selfRun) {
    const opened = selfRun[0].slice(0, -2) + ">";
    return pXml.replace(selfRun[0], `${opened}<hp:t>${escapeXml(value)}</hp:t></hp:run>`);
  }
  return pXml;
}

/** 문단에서 그림/개체(hp:pic·hp:ctrl 등)를 제거한 텍스트 전용 복제 템플릿. */
function stripObjectsFromParagraph(pXml: string): string {
  return pXml
    .replace(/<hp:pic\b[\s\S]*?<\/hp:pic>/g, "")
    .replace(/<hp:ctrl\b[\s\S]*?<\/hp:ctrl>/g, "");
}

/** 셀(tc) XML 의 내용을 value 로 교체. 개행은 문단 복제(개체 제거 템플릿 — 이미지 중복 방지). */
function setCellXmlText(tcXml: string, value: string): string {
  const allPs = [...tcXml.matchAll(new RegExp(P_RE.source, "g"))];
  if (allPs.length === 0) return tcXml;
  // 템플릿 = 텍스트(hp:t)가 있는 첫 문단 우선(선두의 빈 self-closing run 문단 회피), 없으면 첫 문단
  const tplMatch = allPs.find((m) => T_RE.test(m[0])) ?? allPs[0];
  const lines = String(value ?? "").split("\n");
  const lineTemplate = stripObjectsFromParagraph(tplMatch[0]);
  // 첫 줄은 원본 템플릿(개체 보존), 추가 줄은 개체 제거 템플릿으로 복제
  const paragraphs = lines
    .map((line, i) => setParagraphText(i === 0 ? tplMatch[0] : lineTemplate, line))
    .join("");
  // 기존 문단 정리: 값 문단들은 첫 문단 위치에 삽입하고, 개체(이미지 등)가 든 문단만 보존
  let out = "";
  let cursor = 0;
  let inserted = false;
  for (const m of allPs) {
    out += tcXml.slice(cursor, m.index);
    if (!inserted) {
      out += paragraphs;
      inserted = true;
    }
    if (m[0] !== tplMatch[0] && /<hp:pic\b/.test(m[0])) out += m[0]; // 개체 문단 보존
    cursor = (m.index ?? 0) + m[0].length;
  }
  out += tcXml.slice(cursor);
  return out;
}

/** 표 XML 에서 (row,col) 셀 텍스트 교체. 반환: [수정된 표, 성공 여부] */
function setCellText(tblXml: string, row: number, col: number, value: string): [string, boolean] {
  let done = false;
  const out = tblXml.replace(TC_RE, (tc) => {
    if (done) return tc;
    const addr = ADDR_RE.exec(tc);
    if (!addr || Number(addr[2]) !== row || Number(addr[1]) !== col) return tc;
    done = true;
    return setCellXmlText(tc, value);
  });
  return [out, done];
}

/** 셀 내 『…』 구간만 치환(동의서·서약서 본문의 용역명). */
function replaceQuotedInCell(tblXml: string, row: number, col: number, replacement: string): [string, boolean] {
  let done = false;
  const out = tblXml.replace(TC_RE, (tc) => {
    const addr = ADDR_RE.exec(tc);
    if (!addr || Number(addr[2]) !== row || Number(addr[1]) !== col) return tc;
    const replaced = tc.replace(T_ALL_RE, (t) =>
      t.replace(/『[^』]*』/g, () => {
        done = true;
        return `『${escapeXml(replacement)}』`;
      })
    );
    return replaced;
  });
  return [out, done];
}

function rowAddrOfTr(trXml: string): number {
  const addr = ADDR_RE.exec(trXml);
  return addr ? Number(addr[2]) : -1;
}

/** tr 내 모든 셀의 rowAddr 를 newRow 로 교체. */
function shiftTrRow(trXml: string, newRow: number): string {
  return trXml.replace(/(<hp:cellAddr colAddr="\d+" rowAddr=")(\d+)(")/g, (_, a, __, c) => a + String(newRow) + c);
}

/**
 * 반복 행 채움 — fromRow 행을 템플릿으로 데이터 행을 재구성한다.
 * preserveRows(합계 등)는 데이터 뒤로 rowAddr 시프트해 보존.
 */
function fillRepeatRows(
  tblXml: string,
  fromRow: number,
  columns: { col: number; field: string }[],
  rows: Record<string, string>[],
  preserveRows: Set<number>,
  warnings: string[]
): string {
  const trs = [...tblXml.matchAll(TR_RE)].map((m) => ({ xml: m[0], start: m.index ?? 0, row: rowAddrOfTr(m[0]) }));
  const template = trs.find((t) => t.row === fromRow);
  if (!template) {
    warnings.push(`반복 행 템플릿(행 ${fromRow})을 찾지 못해 건너뜀`);
    return tblXml;
  }
  const headerTrs = trs.filter((t) => t.row >= 0 && t.row < fromRow);
  const preserved = trs.filter((t) => t.row >= fromRow && preserveRows.has(t.row));

  // 새 데이터 행 생성
  const dataTrs: string[] = rows.map((rowValues, i) => {
    let tr = shiftTrRow(template.xml, fromRow + i);
    // 매핑된 열 채움 + 매핑 없는 열은 템플릿 값 비움
    const colSet = new Set(columns.map((c) => c.col));
    tr = tr.replace(TC_RE, (tc) => {
      const addr = ADDR_RE.exec(tc);
      if (!addr) return tc;
      const col = Number(addr[1]);
      const mapped = columns.find((c) => c.col === col);
      if (mapped) return setCellXmlText(tc, rowValues[mapped.field] ?? "");
      if (!colSet.has(col)) return setCellXmlText(tc, "");
      return tc;
    });
    return tr;
  });

  const preservedShifted = preserved
    .sort((a, b) => a.row - b.row)
    .map((t, i) => shiftTrRow(t.xml, fromRow + rows.length + i));

  const newRowCnt = fromRow + rows.length + preservedShifted.length;
  const body = [...headerTrs.map((t) => t.xml), ...dataTrs, ...preservedShifted].join("");

  // 표 여는 태그~첫 tr 이전(colgroup 등) + 새 행들 + 마지막 tr 이후(닫는 태그)
  const firstTr = trs[0];
  const lastTr = trs[trs.length - 1];
  if (!firstTr || !lastTr) return tblXml;
  let out = tblXml.slice(0, firstTr.start) + body + tblXml.slice(lastTr.start + lastTr.xml.length);
  out = out.replace(/(<hp:tbl\b[^>]*rowCnt=")(\d+)(")/, (_, a, __, c) => a + String(newRowCnt) + c);
  return out;
}

/** 행이 늘어난 표에 '셀 단위로 나눔'(pageBreak=CELL) 강제 — 개별이력 등 NONE 표가 넘칠 때 잘림 방지. */
function forceCellPageBreak(tblXml: string): string {
  if (/<hp:tbl\b[^>]*pageBreak="/.test(tblXml)) {
    return tblXml.replace(/(<hp:tbl\b[^>]*pageBreak=")(\w+)(")/, (_, a, __, c) => a + "CELL" + c);
  }
  // pageBreak 속성이 없는 표 — 여는 태그에 삽입
  return tblXml.replace(/<hp:tbl\b/, '<hp:tbl pageBreak="CELL"');
}

// 셀 폭 추정용 — 전각 글자 1자 ≈ 1100 HWPUNIT(10pt 기준), 셀 안 여백 여유분.
const HWPUNIT_PER_CHAR = 1100;
const CELL_PADDING_HWPUNIT = 1200;

/**
 * 값이 셀 폭보다 길어 줄바꿈될 것 같으면 같은 행의 오른쪽 이웃 셀에서 폭을 가져와 넓힌다
 * (행 전체 폭은 유지 — 서약서 '업체명' 등 좁은 값 셀 대응).
 */
function widenCellIfNeeded(tblXml: string, row: number, col: number, value: string): string {
  const needed = value.length * HWPUNIT_PER_CHAR + CELL_PADDING_HWPUNIT;
  const cells = [...tblXml.matchAll(TC_RE)].map((m) => {
    const addr = ADDR_RE.exec(m[0]);
    const sz = /<hp:cellSz width="(\d+)"/.exec(m[0]);
    return {
      xml: m[0],
      start: m.index ?? 0,
      row: addr ? Number(addr[2]) : -1,
      col: addr ? Number(addr[1]) : -1,
      width: sz ? Number(sz[1]) : 0,
    };
  });
  const target = cells.find((c) => c.row === row && c.col === col);
  if (!target || target.width === 0 || target.width >= needed) return tblXml;
  const neighbors = cells.filter((c) => c.row === row && c.col > col).sort((a, b) => a.col - b.col);
  const donor = neighbors.find((c) => c.width > needed - target.width + 2000);
  if (!donor) return tblXml;
  const delta = needed - target.width;
  const widened = target.xml.replace(/(<hp:cellSz width=")(\d+)(")/, (_, a, __, c) => a + String(target.width + delta) + c);
  const narrowed = donor.xml.replace(/(<hp:cellSz width=")(\d+)(")/, (_, a, __, c) => a + String(donor.width - delta) + c);
  // 뒤쪽부터 교체(위치 보존)
  const parts = [
    { start: donor.start, end: donor.start + donor.xml.length, xml: narrowed },
    { start: target.start, end: target.start + target.xml.length, xml: widened },
  ].sort((a, b) => b.start - a.start);
  let out = tblXml;
  for (const p of parts) out = out.slice(0, p.start) + p.xml + out.slice(p.end);
  return out;
}

/**
 * 서식 사이 '페이지 밀어내기용' 연속 빈 문단 블록을 정리한다.
 * 원본 양식은 빈 문단 수십 개로 다음 서식을 다음 페이지 첫 줄에 맞춰 두는데, 표 행이 늘어나면
 * 그 개수만큼 다음 서식 위에 공백이 쌓인다 → 빈 문단 블록(3개 이상)을 제거하고 다음 서식의
 * 첫 문단에 쪽나눔(pageBreak="1")을 부여해 행 수와 무관하게 항상 첫 줄에서 시작하게 한다.
 */
// XML 텍스트에 나타날 수 없는 NUL 문자를 표 자리표시 토큰 구분자로 사용
const TBL_TOKEN = String.fromCharCode(0);
const SPACER_MIN_RUN = 3;

function collapseSpacerParagraphs(sectionXml: string): string {
  // 표 블록을 토큰으로 치환해 최상위 문단만 안전하게 다룬다(표 안 문단 오인 방지)
  const tableStore: string[] = [];
  const flat = sectionXml.replace(TBL_RE, (tbl) => {
    tableStore.push(tbl);
    return TBL_TOKEN + "TBL" + (tableStore.length - 1) + TBL_TOKEN;
  });
  const paras = [...flat.matchAll(/<hp:p\b[\s\S]*?<\/hp:p>/g)].map((m) => ({
    xml: m[0],
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
  const isEmptyPara = (xml: string): boolean =>
    !xml.includes(TBL_TOKEN) &&
    !/<hp:pic\b|<hp:ctrl\b/.test(xml) &&
    ![...xml.matchAll(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g)].some((m) => m[1].trim().length > 0);
  const withPageBreak = (xml: string): string => {
    const head = /^<hp:p\b[^>]*>/.exec(xml)?.[0] ?? "";
    if (/pageBreak="/.test(head)) {
      return xml.replace(/^(<hp:p\b[^>]*pageBreak=")(\w+)(")/, (_, a, __, c) => a + "1" + c);
    }
    return xml.replace(/^<hp:p\b/, '<hp:p pageBreak="1"');
  };
  // 서식 표제([별첨 서식 N]·【양식 N】 등) 문단 — 항상 새 페이지 첫 줄에서 시작해야 한다
  const isFormTitlePara = (xml: string): boolean => {
    const text = [...xml.matchAll(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g)].map((m) => m[1]).join("");
    return /^\s*(\[\s*별\s*첨|\[\s*별\s*지|\[\s*서\s*식|\[\s*양\s*식|【\s*서\s*식|【\s*양\s*식)/.test(text);
  };

  const edits: { start: number; end: number; xml: string }[] = [];
  const brokenParas = new Set<number>(); // 이미 pageBreak 를 부여한 문단 index(중복 편집 방지)
  let seenContent = false;
  let i = 0;
  while (i < paras.length) {
    if (!isEmptyPara(paras[i].xml)) {
      // 서식 표제 문단은 앞 공백 유무와 무관하게 쪽나눔 부여(문서 첫 문단 제외)
      if (seenContent && isFormTitlePara(paras[i].xml) && !brokenParas.has(i)) {
        edits.push({ start: paras[i].start, end: paras[i].end, xml: withPageBreak(paras[i].xml) });
        brokenParas.add(i);
      }
      seenContent = true;
      i += 1;
      continue;
    }
    let j = i;
    while (j < paras.length && isEmptyPara(paras[j].xml)) j += 1;
    const runLen = j - i;
    const nextIsTitle = j < paras.length && isFormTitlePara(paras[j].xml);
    // 문서 첫머리 공백은 길이 무관 제거(첫 줄부터 시작), 이후는 밀어내기 블록(>=3) 또는
    // 서식 표제 직전 공백을 제거하고 다음 문단에 쪽나눔을 부여한다
    if (!seenContent || runLen >= SPACER_MIN_RUN || nextIsTitle) {
      edits.push({ start: paras[i].start, end: paras[j - 1].end, xml: "" });
      if (seenContent && j < paras.length && !brokenParas.has(j)) {
        edits.push({ start: paras[j].start, end: paras[j].end, xml: withPageBreak(paras[j].xml) });
        brokenParas.add(j);
      }
    }
    i = j;
  }

  let out = flat;
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) out = out.slice(0, e.start) + e.xml + out.slice(e.end);
  return out.replace(new RegExp(TBL_TOKEN + "TBL(\\d+)" + TBL_TOKEN, "g"), (_, idx) => tableStore[Number(idx)]);
}

// HWPUNIT: 1pt = 100
const HWPUNIT_PER_PT = 100;

/** (row,col) 셀의 왼쪽 안 여백을 pt 로 설정 — 값이 셀 경계에 붙지 않게 한다. */
function setCellLeftMargin(tblXml: string, row: number, col: number, pt: number): string {
  let done = false;
  return tblXml.replace(TC_RE, (tc) => {
    if (done) return tc;
    const addr = ADDR_RE.exec(tc);
    if (!addr || Number(addr[2]) !== row || Number(addr[1]) !== col) return tc;
    done = true;
    const unit = Math.round(pt * HWPUNIT_PER_PT);
    let out = tc.replace(/(<hp:tc\b[^>]*hasMargin=")(\w+)(")/, (_, a, __, c) => a + "1" + c);
    if (/<hp:cellMargin\b/.test(out)) {
      out = out.replace(/(<hp:cellMargin left=")(\d+)(")/, (_, a, __, c) => a + String(unit) + c);
    } else {
      out = out.replace(/(<hp:cellSz[^>]*\/>)/, `$1<hp:cellMargin left="${unit}" right="141" top="141" bottom="141"/>`);
    }
    return out;
  });
}

interface TableSlot {
  start: number;
  end: number;
  xml: string;
}

function extractTables(sectionXml: string): TableSlot[] {
  return [...sectionXml.matchAll(TBL_RE)].map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    xml: m[0],
  }));
}

/** 단일 문서(doc)의 표 1개를 값으로 채운 XML 반환. personIndex 는 인당 문서에서 사용. */
function fillDocTable(
  tblXml: string,
  doc: ProfileDoc,
  tableIndex: number,
  data: PackageData,
  personIndex: number | null,
  warnings: string[]
): string {
  let out = tblXml;
  let grew = false;

  // 단일 필드(이 표를 참조하는 것만) — 같은 셀에 복수 필드가 매핑되면(자유 기입 1x1 표 등)
  // "라벨: 값" 줄로 합쳐 넣는다. quoted(본문 『…』 치환)는 실패 시 본문 훼손 방지 위해 폴백 없이 경고만.
  const byCell = new Map<string, { field: string; label: string; value: string; prefixColon: boolean; topPadLines: number; leftIndentPt: number }[]>();
  for (const f of doc.fields) {
    if (f.table !== tableIndex || f.row == null || f.col == null) continue;
    const resolved = resolveSingleValue(doc.docType, f.field, data, personIndex);
    if (resolved == null) continue; // 값 미제공(득점·수기 항목) — 원본 유지
    if (resolved.mode === "quoted") {
      const [next, ok] = replaceQuotedInCell(out, f.row, f.col, resolved.value);
      out = next;
      if (!ok) warnings.push(`${doc.docType}.${f.field}: 셀(${f.row},${f.col})에 『…』 패턴이 없어 건너뜀(본문 보호)`);
      continue;
    }
    const key = `${f.row}:${f.col}`;
    const list = byCell.get(key) ?? [];
    list.push({
      field: f.field,
      label: f.label,
      value: resolved.value,
      prefixColon: resolved.prefixColon === true,
      topPadLines: resolved.topPadLines ?? 0,
      leftIndentPt: resolved.leftIndentPt ?? 0,
    });
    byCell.set(key, list);
  }
  for (const [key, entries] of byCell) {
    const [row, col] = key.split(":").map(Number);
    const topPad = Math.max(...entries.map((e) => e.topPadLines));
    const leftIndent = Math.max(...entries.map((e) => e.leftIndentPt));
    const value =
      "\n".repeat(topPad) +
      (entries.length === 1
        ? (entries[0].prefixColon ? `: ${entries[0].value}` : entries[0].value)
        : entries.map((e) => `${e.label || e.field} : ${e.value}`).join("\n"));
    const [next, ok] = setCellText(out, row, col, value);
    out = next;
    if (!ok) {
      warnings.push(`${doc.docType}: 셀(${row},${col})을 찾지 못함`);
      continue;
    }
    if (leftIndent > 0) out = setCellLeftMargin(out, row, col, leftIndent);
    // ': 값' 기입형(서약서 등) 좁은 셀은 줄바꿈 방지 위해 이웃 셀에서 폭을 빌려 확장
    if (entries.some((e) => e.prefixColon)) out = widenCellIfNeeded(out, row, col, value);
  }

  // 반복 행
  if (doc.repeat && doc.repeat.table === tableIndex) {
    const rows = resolveRepeatRows(doc.docType, data, personIndex);
    if (rows.length > 0) {
      const preserveRows = new Set<number>();
      for (const f of doc.fields) {
        if (f.table === tableIndex && f.row != null && f.row >= doc.repeat.fromRow) preserveRows.add(f.row);
      }
      // 보존 행의 단일 필드는 행 시프트 전에 이미 채워졌으므로 좌표가 이동해도 값은 유지된다.
      out = fillRepeatRows(out, doc.repeat.fromRow, doc.repeat.columns, rows, preserveRows, warnings);
      grew = rows.length > 1;
    }
  }

  if (grew) out = forceCellPageBreak(out);
  return out;
}

/** 양식 HWPX + form_profile + 데이터 → 채움본 HWPX. opts.creditImage = 신용평가 등급부 이미지(스캔 교체). */
export async function fillPackageHwpx(
  formBytes: Uint8Array,
  profile: FormProfile,
  data: PackageData,
  opts?: { creditImage?: Uint8Array }
): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const warnings: string[] = [];
  const zip = await JSZip.loadAsync(formBytes);
  const sectionNames = Object.keys(zip.files)
    .filter((n) => /^Contents\/section\d+\.xml$/.test(n))
    .sort();
  if (sectionNames.length !== 1) {
    // 샘플 전수 단일 섹션 — 다중 섹션은 전역 표 인덱스 계산이 달라지므로 우선 미지원
    if (sectionNames.length === 0) throw new Error("HWPX 본문을 찾을 수 없습니다.");
    warnings.push("다중 섹션 양식 — 첫 섹션만 처리합니다.");
  }
  const sectionName = sectionNames[0];
  let xml = await zip.files[sectionName].async("string");

  const tables = extractTables(xml);
  // 표 교체는 뒤에서부터(앞 위치가 흔들리지 않게). 같은 표를 두 문서가 교체하면 좌표가
  // 어긋나므로 표당 1회만 처리(먼저 온 문서 우선).
  const replacements: { start: number; end: number; xml: string }[] = [];
  const processedTables = new Set<number>();

  for (const doc of profile.documents) {
    if (doc.docType === "unknown" || doc.docType === "org_chart") continue;

    if (doc.perPersonTable) {
      const slots = doc.tables.filter((ti) => !processedTables.has(ti)).map((ti) => tables[ti]).filter(Boolean);
      for (const ti of doc.tables) processedTables.add(ti);
      if (slots.length === 0) continue;
      const templateIndex = doc.tables[0];
      const template = tables[templateIndex];
      if (!template) continue;
      const n = personCount(data);
      // 슬롯의 '서식 블록' = 직전 표 문단 끝 ~ 이 표를 감싼 문단 끝.
      // 서식 표제([별첨 서식 N]·양식명·구분선)와 선행 공백 문단이 포함되므로, 초과 인원은
      // 블록째 복제(표제 유지 + collapse 패스가 표제에 쪽나눔 부여 → 인당 1페이지),
      // 잉여 서식은 블록째 제거(표만 지우면 표제가 남는 문제 방지).
      const blockRangeOf = (slot: TableSlot): { start: number; end: number } => {
        const paraEnd = xml.indexOf("</hp:p>", slot.end);
        const end = paraEnd >= 0 ? paraEnd + "</hp:p>".length : slot.end;
        const prev = tables.filter((t) => t.end <= slot.start).sort((a, b) => b.end - a.end)[0];
        let start: number;
        if (prev) {
          const prevParaEnd = xml.indexOf("</hp:p>", prev.end);
          start = prevParaEnd >= 0 ? prevParaEnd + "</hp:p>".length : slot.start;
        } else {
          start = xml.lastIndexOf("<hp:p", slot.start);
        }
        return { start, end };
      };
      const lastSlot = slots[slots.length - 1];
      const lastBlock = blockRangeOf(lastSlot);
      const lastBlockXml = xml.slice(lastBlock.start, lastBlock.end);
      const extraBlocks: string[] = [];
      for (let i = 0; i < Math.max(slots.length, n); i += 1) {
        if (i < n) {
          // person i 로 채움(모든 좌표는 템플릿 표 기준이라 templateIndex 로 해석)
          const filled = fillDocTable(template.xml, doc, templateIndex, data, i, warnings);
          if (i < slots.length) {
            replacements.push({ start: slots[i].start, end: slots[i].end, xml: filled });
          } else {
            // 인원이 표보다 많음 — 마지막 서식 블록을 복제해 표 부분만 채움본으로 교체
            extraBlocks.push(lastBlockXml.replace(lastSlot.xml, filled));
          }
        } else if (i < slots.length) {
          // 인원이 표보다 적음 — 남는 서식 블록(표제 포함) 제거
          replacements.push({ ...blockRangeOf(slots[i]), xml: "" });
        }
      }
      if (extraBlocks.length > 0) {
        // 같은 위치 복수 삽입은 적용 순서에 따라 순서가 뒤집히므로 하나로 합쳐 1회 삽입
        replacements.push({ start: lastBlock.end, end: lastBlock.end, xml: extraBlocks.join("") });
      }
      continue;
    }

    // 필드/반복이 참조하는 표는 doc.tables 밖이어도 처리(LLM 이 tables 나열을 빠뜨려도 주입 누락 방지)
    const refTables = new Set<number>(doc.tables);
    for (const f of doc.fields) if (f.table != null) refTables.add(f.table);
    if (doc.repeat) refTables.add(doc.repeat.table);
    for (const ti of refTables) {
      const slot = tables[ti];
      if (!slot) {
        warnings.push(`${doc.docType}: 표 ${ti} 없음`);
        continue;
      }
      if (processedTables.has(ti)) {
        warnings.push(`${doc.docType}: 표 ${ti} 는 다른 문서에서 이미 처리되어 건너뜀`);
        continue;
      }
      const filled = fillDocTable(slot.xml, doc, ti, data, null, warnings);
      if (filled !== slot.xml) {
        processedTables.add(ti);
        replacements.push({ start: slot.start, end: slot.end, xml: filled });
      }
    }
  }

  replacements.sort((a, b) => b.start - a.start);
  for (const r of replacements) {
    xml = xml.slice(0, r.start) + r.xml + xml.slice(r.end);
  }

  // 동의서·서약서 본문의 『용역명』은 표 밖 문단에도 있음 — 문서 전체 hp:t 에서 일괄 치환
  // (『…』 인용 표기는 용역명에만 쓰이는 관례. 표 안에서 이미 치환된 곳은 동일 값이라 무해)
  if (profile.documents.some((d) => d.docType === "privacy_consent" || d.docType === "security_pledge")) {
    const serviceTitle = cleanServiceTitle(data.bid.title);
    if (serviceTitle) {
      xml = xml.replace(T_ALL_RE, (t) => t.replace(/『[^』]*』/g, `『${escapeXml(serviceTitle)}』`));
    }
  }

  // 신용평가 등급부 이미지 교체 — credit_rating 문서 표 안의 스캔 이미지 BinData 를
  // 회사 프로필의 등급 이미지로 교체(프레임 비율에 맞춰 흰 배경 contain, 왜곡 방지)
  if (opts?.creditImage) {
    const creditDoc = profile.documents.find((d) => d.docType === "credit_rating");
    const refIds = new Set<string>();
    if (creditDoc) {
      for (const ti of creditDoc.tables) {
        const slotXml = tables[ti]?.xml ?? "";
        for (const m of slotXml.matchAll(/binaryItemIDRef="([^"]+)"/g)) refIds.add(m[1]);
      }
    }
    if (refIds.size === 0) {
      warnings.push("신용평가 서식에서 교체할 스캔 이미지를 찾지 못해 등급 이미지를 건너뜀");
    } else {
      for (const id of refIds) {
        const binName = Object.keys(zip.files).find((n) => n.startsWith(`BinData/${id}.`));
        if (!binName) {
          warnings.push(`등급 이미지: BinData/${id}.* 파일 없음`);
          continue;
        }
        try {
          const original = await zip.files[binName].async("uint8array");
          const meta = await sharp(Buffer.from(original)).metadata();
          const frameW = meta.width ?? 1200;
          const frameH = meta.height ?? 1600;
          const replaced = await sharp(Buffer.from(opts.creditImage))
            .resize(frameW, frameH, { fit: "contain", background: { r: 255, g: 255, b: 255 } })
            .jpeg({ quality: 92 })
            .toBuffer();
          zip.file(binName, replaced);
        } catch {
          warnings.push(`등급 이미지 교체 실패(BinData/${id})`);
        }
      }
    }
  }

  // 서식 사이 페이지 밀어내기용 빈 문단 정리 — 행이 늘어도 다음 서식이 항상 첫 줄에서 시작
  xml = collapseSpacerParagraphs(xml);

  // 줄 레이아웃 캐시 제거 — 한글이 열 때 전체 재계산(자동 페이지 분할 포함)
  xml = xml.replace(LINESEG_RE, "");

  zip.file(sectionName, xml);
  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    mimeType: "application/hwp+zip",
  });
  return { bytes, warnings };
}
