// 착수계·준공계 HWPX 렌더러 — 실물 hwp 를 한컴에서 저장한 템플릿
// (public/hwpx/start-notice.hwpx · completion.hwpx)의 문단 텍스트를 값으로 치환한다.
// 공문(lib/letter/hwpx.ts)과 같은 계열이지만 {{토큰}} 이 아니라 **실물 라벨**을 키로 쓴다 —
// 템플릿이 실제 발송 문서 원본이라 토큰을 심어두지 않아도 되고, 서식(글꼴·자간·표 선)이 실물과 같다.
//
// 준공 템플릿은 한 파일에 3장(준공검사원·정산동의서·감독신청)이 순차로 들어있다.
// 선택하지 않은 서식은 장 구간을 통째로 잘라낸다.
// ⚠ 표·문단이 중첩돼 있어 문단 단위 재조립은 위험하다 → 문자열 구간 제거 + 텍스트 치환만 한다.

import { readFile } from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { formatValue, renderBinding, renderTemplate, spreadName } from "./format";
import type { DeliverableKind, DeliverableValues } from "./types";

const LINESEG_RE = /<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g; // 한글이 줄 배치를 재계산하도록 제거
const P_RE = /<hp:p\b[\s\S]*?<\/hp:p>/g;
const T_ALL_RE = /<hp:t>[\s\S]*?<\/hp:t>/g;

function escapeXml(v: string): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 문단의 표시 텍스트(모든 hp:t 이어붙이기) */
function paraText(pXml: string): string {
  return [...pXml.matchAll(/<hp:t>([\s\S]*?)<\/hp:t>/g)]
    .map((m) => m[1])
    .join("")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** 첫 hp:t 에 값을 넣고 나머지는 비운다 — lib/letter/hwpx.ts setParagraphText 이식 */
function setParaText(pXml: string, value: string): string {
  let first = true;
  return pXml.replace(T_ALL_RE, () => {
    if (first) {
      first = false;
      return `<hp:t>${escapeXml(value)}</hp:t>`;
    }
    return "<hp:t></hp:t>";
  });
}

const norm = (s: string) => s.replace(/\s/g, "");

/** 라벨(공백 무시) → 값 렌더 함수 */
type Filler = (v: DeliverableValues) => string;

const COMMON_LABELS: Record<string, Filler> = {
  계약명: (v) => renderBinding("contract.title", v),
  용역명: (v) => renderBinding("contract.title", v),
  계약금액: (v) => renderBinding("contract.amount", v, "amountBoth"),
  준공기성금액: (v) => renderBinding("completion.currentAmount", v, "amountBoth"),
  누계준공금액: (v) => renderBinding("completion.cumulativeAmount", v, "amountBoth"),
  계약일: (v) => renderBinding("contract.date", v, "dateKorean"),
  착수일: (v) => renderBinding("contract.startDate", v, "dateKorean"),
  준공예정일: (v) => renderBinding("contract.endDate", v, "dateKorean"),
  실준공일: (v) => renderBinding("completion.actualDate", v, "dateKorean"),
  계약상대자: (v) => renderBinding("company.name", v),
  주소: (v) => renderBinding("company.address", v),
  상호: (v) => renderBinding("company.name", v),
  // 실물 서명란은 성명을 벌려 쓴다("이 유 억")
  대표자: (v) => `${spreadName(renderBinding("company.ceo", v))}   (인)`,
};

/** 착수계 전용(라벨 표기·포맷이 다르다) */
const START_LABELS: Record<string, Filler> = {
  ...COMMON_LABELS,
  계약금액: (v) => renderBinding("contract.amount", v, "amountHangul"),
  착수일자: (v) => renderBinding("contract.startDate", v, "dateDotted"),
  완료일자: (v) => renderBinding("contract.endDate", v, "dateDotted"),
};

/** "1. 계   약   명 : 값" → 라벨·구분자는 원본 유지하고 값만 교체. 매칭 실패면 null */
function fillLabeled(text: string, table: Record<string, Filler>, values: DeliverableValues): string | null {
  const idx = text.indexOf(":");
  if (idx < 0) return null;
  const head = text.slice(0, idx + 1);
  const label = norm(head.replace(/^[\s\d.□■]*/, "").replace(/[:：]\s*$/, ""));
  const filler = table[label];
  if (!filler) return null;
  return `${head} ${filler(values)}`;
}

const DATE_KOREAN_RE = /\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일/g;
const DATE_DOTTED_RE = /\d{4}\s*\.\s*\d{1,2}\s*\.\s*\d{1,2}\s*\./g;
const MONEY_RE = /^-?[\d,]+$/;

/** 장(서식) 1개 구간의 문단 텍스트를 값으로 치환한다. */
function fillSection(xml: string, kind: DeliverableKind, values: DeliverableValues): string {
  const table = kind === "start" ? START_LABELS : COMMON_LABELS;
  const paras = [...xml.matchAll(P_RE)];
  // 표 숫자 셀 순서: 전회공급·전회부가세·금회공급·금회부가세·누계공급·누계부가세 → 합계 3칸
  const moneyBindings = [
    "completion.prevSupply",
    "completion.prevVat",
    "completion.curSupply",
    "completion.curVat",
    "completion.cumSupply",
    "completion.cumVat",
    "completion.prevTotal",
    "completion.curTotal",
    "completion.cumTotal",
  ];
  let moneyIdx = 0;
  let companyCellDone = false;
  let out = "";
  let last = 0;

  for (const m of paras) {
    const pXml = m[0];
    const start = m.index ?? 0;
    const text = paraText(pXml);
    const t = text.trim();
    let next: string | null = null;

    if (!t) {
      // 빈 문단 유지
    } else if (MONEY_RE.test(t) && moneyIdx < moneyBindings.length) {
      // 준공금액 표의 숫자 셀(등장 순서대로 매핑)
      next = renderBinding(moneyBindings[moneyIdx++], values, "amountNumber");
    } else if (norm(t) === "전회") {
      // 대금지급단계 2단계=전회 / 3단계 이상=기지급 (사용자 확정)
      next = String(values["meta.priorLabel"] ?? "전회");
    } else if (!companyCellDone && /^㈜?한국환경$/.test(t)) {
      next = renderBinding("company.name", values); // 표 첫 열(2줄 분리 셀) — 첫 줄에 상호 전체
      companyCellDone = true;
    } else if (companyCellDone && /^안전연구원$/.test(t)) {
      next = ""; // 둘째 줄 비움
    } else if (t.endsWith("귀하")) {
      next = text.replace(/^(\s*).*귀하\s*$/, (_, pad) => `${pad}${renderBinding("orderer.name", values)} 귀하`);
    } else if (t.startsWith("(￦") || t.startsWith("(₩")) {
      // 착수계 계약금액 둘째 행
      next = text.replace(/^(\s*).*$/, (_, pad) => `${pad}${renderTemplate("(￦{{contract.amount|amountNumber}}) {{meta.vatNote}}", values)}`);
    } else if (t.includes("부터") && t.includes("까지")) {
      // 준공 감독 신청 본문의 기간 — 계약일 ~ 실준공일. 본문 내 인라인이라 실물처럼 한 칸 간격
      const single = (s: string) => s.replace(/\s{2,}/g, " ");
      const a = single(renderBinding("contract.date", values, "dateKorean"));
      const b = single(renderBinding("completion.actualDate", values, "dateKorean"));
      let i = 0;
      next = text.replace(DATE_KOREAN_RE, () => (i++ === 0 ? a : b));
    } else if (DATE_KOREAN_RE.test(t) && !t.includes(":") && t.length < 30) {
      DATE_KOREAN_RE.lastIndex = 0;
      next = text.replace(DATE_KOREAN_RE, formatValue(values["issue.date"], "dateSpaced", values)); // 작성일
    } else if (DATE_DOTTED_RE.test(t) && !t.includes(":") && t.length < 30) {
      DATE_DOTTED_RE.lastIndex = 0;
      next = text.replace(DATE_DOTTED_RE, formatValue(values["issue.date"], "dateDotted", values));
    } else {
      next = fillLabeled(text, table, values);
      // 주소 둘째 행(라벨 없는 연장행)은 비운다 — 주소 전체를 첫 행에 넣었으므로
      if (next == null && /골드타워|층$/.test(t) && !t.includes(":")) next = "";
    }
    DATE_KOREAN_RE.lastIndex = 0;
    DATE_DOTTED_RE.lastIndex = 0;

    if (next != null) {
      out += xml.slice(last, start) + setParaText(pXml, next);
      last = start + pXml.length;
    }
  }
  return out + xml.slice(last);
}

/** 준공 템플릿의 장 경계(제목 문단 시작 위치) — 표제 텍스트로 식별 */
function sectionRanges(xml: string): { docType: string; start: number; end: number }[] {
  const titles: { docType: string; key: string }[] = [
    { docType: "completion_inspection", key: "준공검사원" },
    { docType: "completion_settlement", key: "준공금액정산동의서" },
    { docType: "completion_supervision", key: "준공감독신청" },
  ];
  const found: { docType: string; start: number }[] = [];
  for (const m of xml.matchAll(P_RE)) {
    const t = norm(paraText(m[0]));
    const hit = titles.find((x) => x.key === t);
    if (hit && !found.some((f) => f.docType === hit.docType)) found.push({ docType: hit.docType, start: m.index ?? 0 });
  }
  found.sort((a, b) => a.start - b.start);
  return found.map((f, i) => ({ docType: f.docType, start: f.start, end: i + 1 < found.length ? found[i + 1].start : xml.length }));
}

const templateCache = new Map<string, Buffer>();
async function loadTemplate(file: string): Promise<Buffer> {
  const cached = templateCache.get(file);
  if (cached) return cached;
  const bytes = await readFile(path.join(process.cwd(), "public", "hwpx", file));
  templateCache.set(file, bytes);
  return bytes;
}

/**
 * 착수계·준공계 HWPX 생성.
 * 준공은 선택한 서식의 장만 남긴다(예: 준공검사원만 선택 → 나머지 2장 제거).
 * 기본양식 전용이며, 발주처 자체양식(deliverable_templates)은 PDF 만 지원한다(D4 이후 과제).
 */
export async function renderDeliverableHwpx(
  kind: DeliverableKind,
  docTypes: string[],
  values: DeliverableValues
): Promise<Uint8Array> {
  const file = kind === "start" ? "start-notice.hwpx" : "completion.hwpx";
  const zip = await JSZip.loadAsync(await loadTemplate(file));
  const sectionPath = "Contents/section0.xml";
  const entry = zip.file(sectionPath);
  if (!entry) throw new Error(`${file} 템플릿에 section0.xml 이 없습니다.`);
  let xml = (await entry.async("string")).replace(LINESEG_RE, "");

  if (kind === "completion") {
    const ranges = sectionRanges(xml);
    const keep = new Set(docTypes.length ? docTypes : ranges.map((r) => r.docType));
    // 뒤에서부터 잘라내야 앞 구간의 인덱스가 밀리지 않는다
    const drop = ranges.filter((r) => !keep.has(r.docType)).sort((a, b) => b.start - a.start);
    for (const r of drop) xml = xml.slice(0, r.start) + xml.slice(r.end);
    const kept = sectionRanges(xml).sort((a, b) => b.start - a.start);
    for (const r of kept) xml = xml.slice(0, r.start) + fillSection(xml.slice(r.start, r.end), kind, values) + xml.slice(r.end);
  } else {
    xml = fillSection(xml, kind, values);
  }

  zip.file(sectionPath, xml);
  const mimetype = zip.file("mimetype");
  if (mimetype) zip.file("mimetype", await mimetype.async("uint8array"), { compression: "STORE" });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
