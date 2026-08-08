// 발주처 자체양식(HWPX)에 값 주입 — 원본을 그대로 두고 profile 이 가리키는 자리만 바꾼다(D4).
//
// 재구축이 아니라 주입인 이유: 발주처 양식은 서식이 곧 요구사항이라 우리가 다시 그리면 안 된다.
// 산출물 PDF 도 이 결과를 hwpx-pdf.ts 로 렌더하므로 한글본과 서식이 갈리지 않는다.
//
// ⚠ 문단 재조립은 표 중첩 때문에 위험하다(hwpx.ts 와 같은 판단) → 문자열 구간 치환만 한다.

import JSZip from "jszip";
import { renderBinding } from "./format";
import { compactAddress } from "./hwpx";
import { dropParagraphs, findCellSpan, replaceTexts, scanParaSpans, escapeXml, type ParaSpan } from "./template-form";
import type { DeliverableValues, TemplateProfile, TemplateSlot } from "./types";

const LINESEG_RE = /<hp:linesegarray>[\s\S]*?<\/hp:linesegarray>/g;
const T_RE = /<hp:t>([\s\S]*?)<\/hp:t>|<hp:t\/>/g;

const unescapeXml = (v: string): string =>
  v.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** 공백을 무시한 비교용 키 — 양식 라벨은 "계 약 명"처럼 자간이 공백으로 들어가 있다. */
const squeeze = (s: string): string => s.replace(/\s+/g, "");

interface TextPiece {
  /** fragment 내 <hp:t> 요소 전체의 위치 */
  start: number;
  end: number;
  /** 이어붙인 문단 텍스트에서 이 조각이 차지하는 범위 */
  from: number;
  to: number;
  text: string;
}

/** 문단(또는 셀) XML 안의 <hp:t> 조각들과 이어붙인 전체 텍스트. */
function textPieces(fragment: string): { pieces: TextPiece[]; full: string } {
  const pieces: TextPiece[] = [];
  let full = "";
  T_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = T_RE.exec(fragment))) {
    const text = m[1] == null ? "" : unescapeXml(m[1]);
    pieces.push({ start: m.index, end: m.index + m[0].length, from: full.length, to: full.length + text.length, text });
    full += text;
  }
  return { pieces, full };
}

/**
 * 공백을 무시하고 찾은 부분 문자열의 **원문** 구간(못 찾으면 null).
 * 양식 라벨은 "계 약 명"처럼 자간이 공백으로 들어가 있어 압축해서 찾아야 하는데,
 * 되돌릴 때 압축 길이로 빼면 그 공백만큼 어긋난다(그래서 시작 위치도 원문에서 직접 잡는다).
 */
function findSpan(full: string, needle: string, from = 0): { start: number; end: number } | null {
  const key = squeeze(needle);
  if (!key) return null;
  const at = squeeze(full.slice(from)).indexOf(key);
  if (at < 0) return null;
  let seen = 0;
  let start = -1;
  for (let i = from; i < full.length; i += 1) {
    if (/\s/.test(full[i])) continue;
    if (seen === at && start < 0) start = i;
    seen += 1;
    if (seen === at + key.length) return { start: start < 0 ? i : start, end: i + 1 };
  }
  return null;
}

/**
 * 라벨 뒤(있으면)부터 접미어 앞(있으면)까지를 값으로 바꾼다.
 * 예) "□ 계 약 명 : 옛 계약명"  → 라벨 "계 약 명" 기준으로 콜론 뒤를 교체
 *     "한국동서발전 귀하"        → 접미어 "귀하" 기준으로 그 앞을 교체
 *
 * 라벨·접미어와 값이 같은 <hp:t> 조각에 섞여 있어도 조각 단위로 잘라 붙여 서식(굵기 등)을 지킨다.
 */
function fillParaValue(fragment: string, label: string, suffix: string | undefined, value: string): string | null {
  const { pieces, full } = textPieces(fragment);
  if (!pieces.length) return null;

  // 값 시작 = 라벨 끝(+구분자). 라벨이 없으면 문단 처음부터.
  let cut = 0;
  if (label) {
    const span = findSpan(full, label);
    if (!span) return null;
    cut = span.end;
    const sep = /^\s*[:：]\s*/.exec(full.slice(cut));
    if (sep) cut += sep[0].length;
  }

  // 값 끝 = 접미어 시작(앞 공백까지 물려 잡는다). 접미어가 없으면 문단 끝까지.
  let tailStart = full.length;
  if (suffix) {
    const span = findSpan(full, suffix, cut);
    if (!span) return null;
    let s = span.start;
    while (s > cut && /\s/.test(full[s - 1])) s -= 1;
    tailStart = Math.max(cut, s);
  }

  const head = full.slice(0, cut);
  // 빈 양식은 "계 약 명 :" 처럼 구분자에서 끝나 값이 콜론에 바로 붙는다 → 한 칸 띄운다.
  const gap = /[:：]$/.test(head) ? " " : "";
  // 접미어 앞도 마찬가지("…㈜대표이사" 처럼 붙지 않게)
  const tailGap = tailStart < full.length && !/^\s/.test(full.slice(tailStart)) ? " " : "";

  let out = "";
  let placed = false;
  let cursor = 0;
  for (const p of pieces) {
    let next = head.slice(Math.min(p.from, head.length), Math.min(p.to, head.length));
    if (!placed && p.to >= cut) {
      next += gap + value + tailGap;
      placed = true;
    }
    if (p.to > tailStart) next += full.slice(Math.max(p.from, tailStart), p.to);
    out += fragment.slice(cursor, p.start) + `<hp:t>${escapeXml(next)}</hp:t>`;
    cursor = p.end;
  }
  out += fragment.slice(cursor);
  return placed ? out : null;
}

export interface FillResult {
  xml: string;
  /** 주입하지 못한 자리(라벨을 못 찾음 등) — UI 경고용 */
  missed: TemplateSlot[];
}

/**
 * 앞 문단 값의 **연장 줄**인가 — 라벨 없이 앞 값의 나머지만 담긴 줄.
 * 양식에 샘플 값이 두 줄로 들어 있을 때 생긴다("… 통합환경 인허가 및" / "PSM 외 작성 용역").
 * 값을 첫 문단에 통째로 넣으므로 이 줄을 비우지 않으면 옛 값의 꼬리가 남는다.
 *
 * ⚠ 판정은 **그 줄의 내용이 새 값 안에 실제로 있을 때**로 좁힌다. 줄 모양만 보면
 * 착수계의 "(₩171,500,000) VAT포함" 처럼 독립된 둘째 줄까지 지워 버린다.
 */
function isContinuation(fragment: string, value: string, slotParas: Set<number>, paraIndex?: number): boolean {
  if (paraIndex != null && slotParas.has(paraIndex)) return false; // 자기 값 자리가 있는 문단
  const { full } = textPieces(fragment);
  const text = squeeze(full);
  if (!text) return false;
  if (/[:：]/.test(text)) return false;
  if (/^(\d+\s*[.)]|[□■○●▪·-])/.test(text)) return false;
  return squeeze(value).includes(text);
}

/**
 * 자리에 넣을 값. 주소는 축약해 **한 줄에 앉힌다** — 발주처 양식은 여백 줄이 빠듯해
 * 주소가 두 줄로 흐르면 그 아래(인감 포함)가 밀리고, 접힌 둘째 줄은 들여쓰기도 잃는다.
 */
function valueFor(slot: TemplateSlot, values: DeliverableValues): string {
  const raw = renderBinding(slot.binding, values, slot.format);
  // 시·도 축약 + 건물명 제거에 더해 층까지 뗀다("서울 금천구 가산디지털1로 100").
  // 기본양식 착수계도 첫 줄은 이 형태이고, 건물명·층은 둘째 줄이 있을 때만 쓴다.
  return slot.binding === "company.address" ? compactAddress(raw).replace(/,\s*\d+층\s*$/, "") : raw;
}

function applySlots(xml: string, slots: TemplateSlot[], values: DeliverableValues): FillResult {
  const missed: TemplateSlot[] = [];
  const slotParas = new Set(slots.filter((s) => s.target === "para" && s.para != null).map((s) => s.para as number));
  // 뒤에서부터 고쳐야 앞 구간의 오프셋이 밀리지 않는다
  const spans = scanParaSpans(xml);
  const byPara = new Map<number, ParaSpan>(spans.map((s) => [s.index, s]));
  const tableSpan = new Map<number, { start: number; end: number }>();
  for (const s of spans) for (const t of s.tables) tableSpan.set(t.index, { start: t.start, end: t.end });

  interface Edit {
    start: number;
    end: number;
    text: string;
  }
  const edits: Edit[] = [];
  for (const slot of slots) {
    const value = valueFor(slot, values);
    if (slot.target === "cell") {
      const span = slot.table != null ? tableSpan.get(slot.table) : undefined;
      if (!span || slot.row == null || slot.col == null) {
        missed.push(slot);
        continue;
      }
      const tableXml = xml.slice(span.start, span.end);
      const cell = findCellSpan(tableXml, slot.row, slot.col);
      if (!cell) {
        missed.push(slot);
        continue;
      }
      const start = span.start + cell.start;
      const end = span.start + cell.end;
      edits.push({ start, end, text: replaceTexts(xml.slice(start, end), value) });
      continue;
    }
    const span = slot.para != null ? byPara.get(slot.para) : undefined;
    if (!span) {
      missed.push(slot);
      continue;
    }
    const filled = fillParaValue(xml.slice(span.start, span.end), slot.label, slot.suffix, value);
    if (filled == null) {
      missed.push(slot);
      continue;
    }
    edits.push({ start: span.start, end: span.end, text: filled });

    // 원본 양식의 값이 두 줄이면 그 아래에 **연장 문단**이 따로 있다(라벨 없이 나머지만 담긴 줄).
    // 값을 첫 문단에 통째로 넣었으므로 연장 문단을 비우지 않으면 옛 값의 꼬리가 그대로 남는다.
    const nextSpan = slot.para != null ? byPara.get(slot.para + 1) : undefined;
    if (nextSpan && isContinuation(xml.slice(nextSpan.start, nextSpan.end), value, slotParas, slot.para! + 1)) {
      edits.push({ start: nextSpan.start, end: nextSpan.end, text: replaceTexts(xml.slice(nextSpan.start, nextSpan.end), "") });
    }
  }

  edits.sort((a, b) => b.start - a.start);
  let out = xml;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const e of edits) {
    if (e.end > lastStart) continue; // 구간이 겹치면(표 안 문단 등) 뒤엣것만 반영
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    lastStart = e.start;
  }
  return { xml: out, missed };
}

/** 선택하지 않은 서식의 문단 구간을 잘라낸다(한 파일에 여러 장이 든 양식). */
function keepDocs(xml: string, profile: TemplateProfile, docTypes: string[]): string {
  const keep = new Set(docTypes);
  const drop = profile.docs.filter(
    (d) => keep.size > 0 && !keep.has(d.docType) && d.paraFrom != null && d.paraTo != null
  );
  if (!drop.length) return xml;
  const spans = scanParaSpans(xml);
  const ranges = drop
    .map((d) => ({ from: d.paraFrom as number, to: d.paraTo as number }))
    .map((r) => ({ start: spans[r.from]?.start, end: spans[Math.min(r.to, spans.length) - 1]?.end }))
    .filter((r): r is { start: number; end: number } => r.start != null && r.end != null && r.end > r.start)
    .sort((a, b) => b.start - a.start);
  let out = xml;
  for (const r of ranges) out = out.slice(0, r.start) + out.slice(r.end);
  return out;
}

/**
 * 발주처 양식 원본 + 매핑 + 값 → 값이 채워진 HWPX.
 * keepLineSeg 는 기본양식(hwpx.ts)과 같은 뜻 — PDF 렌더용 사본만 좌표를 남긴다.
 */
export async function fillTemplateHwpx(
  source: Uint8Array,
  profile: TemplateProfile,
  docTypes: string[],
  values: DeliverableValues,
  opts: { keepLineSeg?: boolean; dropParas?: number[] } = {}
): Promise<{ bytes: Uint8Array; missed: TemplateSlot[] }> {
  const zip = await JSZip.loadAsync(source);
  const entry = zip.file("Contents/section0.xml");
  if (!entry) throw new Error("HWPX 본문(Contents/section0.xml)을 찾을 수 없습니다.");

  const keep = new Set(docTypes);
  const docs = profile.docs.filter((d) => !keep.size || keep.has(d.docType));
  const slots = docs.flatMap((d) => d.slots);

  const original = await entry.async("string");
  // 서식을 먼저 골라낸 뒤 주입해야 남은 문단의 연번이 어긋나지 않는다 —
  // 그래서 골라내기 전 좌표로 주입하고, 골라내기는 마지막에 한다.
  const applied = applySlots(original, slots, values);
  let xml = keepDocs(applied.xml, profile, docTypes);
  if (opts.dropParas?.length) xml = dropParagraphs(xml, opts.dropParas);
  if (!opts.keepLineSeg) xml = xml.replace(LINESEG_RE, "");

  zip.file("Contents/section0.xml", xml);
  const mimetype = zip.file("mimetype");
  if (mimetype) zip.file("mimetype", await mimetype.async("uint8array"), { compression: "STORE" });
  return { bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), missed: applied.missed };
}
