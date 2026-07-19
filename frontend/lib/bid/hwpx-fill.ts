import JSZip from "jszip";
import type { FormProfile, ProfileDoc } from "@/lib/bid/form-analyze";
import type { PackageData } from "@/lib/bid/package-data";
import { resolveSingleValue, resolveRepeatRows, personCount } from "@/lib/bid/package-values";

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

/** 행이 늘어난 표에 '셀 단위로 나눔'(pageBreak=TABLE) 강제 — 개별이력 등 NONE 표가 넘칠 때 잘림 방지. */
function forceCellPageBreak(tblXml: string): string {
  return tblXml.replace(/(<hp:tbl\b[^>]*pageBreak=")(\w+)(")/, (_, a, __, c) => a + "TABLE" + c);
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
  const byCell = new Map<string, { field: string; label: string; value: string; prefixColon: boolean }[]>();
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
    list.push({ field: f.field, label: f.label, value: resolved.value, prefixColon: resolved.prefixColon === true });
    byCell.set(key, list);
  }
  for (const [key, entries] of byCell) {
    const [row, col] = key.split(":").map(Number);
    const value =
      entries.length === 1
        ? (entries[0].prefixColon ? `: ${entries[0].value}` : entries[0].value)
        : entries.map((e) => `${e.label || e.field} : ${e.value}`).join("\n");
    const [next, ok] = setCellText(out, row, col, value);
    out = next;
    if (!ok) warnings.push(`${doc.docType}: 셀(${row},${col})을 찾지 못함`);
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

/** 양식 HWPX + form_profile + 데이터 → 채움본 HWPX. */
export async function fillPackageHwpx(
  formBytes: Uint8Array,
  profile: FormProfile,
  data: PackageData
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
      for (let i = 0; i < Math.max(slots.length, n); i += 1) {
        const slot = slots[Math.min(i, slots.length - 1)];
        if (i < n) {
          // person i 로 채움(모든 좌표는 템플릿 표 기준이라 templateIndex 로 해석)
          const filled = fillDocTable(template.xml, doc, templateIndex, data, i, warnings);
          if (i < slots.length) {
            replacements.push({ start: slots[i].start, end: slots[i].end, xml: filled });
          } else {
            // 인원이 표보다 많음 — 마지막 표 뒤에 이어붙임
            replacements.push({ start: slot.end, end: slot.end, xml: filled });
          }
        } else if (i < slots.length) {
          // 인원이 표보다 적음 — 남는 표 제거
          replacements.push({ start: slots[i].start, end: slots[i].end, xml: "" });
        }
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
