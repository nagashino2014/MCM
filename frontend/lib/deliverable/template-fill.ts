// 발주처 자체양식(HWPX)에 값 주입 — 원본을 그대로 두고 profile 이 가리키는 자리만 바꾼다(D4).
//
// 재구축이 아니라 주입인 이유: 발주처 양식은 서식이 곧 요구사항이라 우리가 다시 그리면 안 된다.
// 산출물 PDF 도 이 결과를 hwpx-pdf.ts 로 렌더하므로 한글본과 서식이 갈리지 않는다.
//
// ⚠ 문단 재조립은 표 중첩 때문에 위험하다(hwpx.ts 와 같은 판단) → 문자열 구간 치환만 한다.

import JSZip from "jszip";
import { formatValue, renderBinding, spreadName } from "./format";
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
/**
 * 라벨 폭 통일(2026-08-19 사용자 피드백) — "용역명"처럼 짧은 라벨을 "착수년월일" 폭에 맞춰
 * 글자 사이를 벌린다("용  역  명"). 콜론이 세로로 정렬된다(기본양식 관행, spec-hwpx 와 동일 규칙).
 */
function padLabel(label: string, width: number): string {
  const chars = [...label.replace(/\s+/g, "")];
  if (chars.length <= 1) return label;
  const base = chars.reduce((a, ch) => a + textWidth(ch), 0);
  const slots = chars.length - 1;
  const need = width - base;
  if (need <= 0) return chars.join("");
  // 균등 분배(2026-08-19 사용자 확정) — 3글자는 2칸, 4글자는 1칸이 되어 라벨 폭이 고르게 보인다.
  // 나머지를 앞 슬롯에만 몰면 "용 역 금액"처럼 마지막 글자만 붙는다.
  const per = Math.max(0, Math.round(need / slots));
  return chars.map((ch, i) => (i === chars.length - 1 ? ch : ch + " ".repeat(per))).join("");
}

function fillParaValue(
  fragment: string,
  label: string,
  suffix: string | undefined,
  value: string,
  labelDisplay?: string
): { xml: string; headWidth: number } | null {
  const { pieces, full } = textPieces(fragment);
  if (!pieces.length) return null;

  // 값 시작 = 라벨 끝(+구분자). 라벨이 없으면 문단 처음부터.
  let cut = 0;
  let labelSpan: { start: number; end: number } | null = null;
  if (label) {
    const span = findSpan(full, label);
    if (!span) return null;
    labelSpan = span;
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

  let head = full.slice(0, cut);
  // 라벨 폭 통일 — 원문 라벨 구간만 표시용 라벨로 바꾼다(선행 기호·구분자는 원문 유지)
  if (labelDisplay && labelSpan) {
    head = full.slice(0, labelSpan.start) + labelDisplay + full.slice(labelSpan.end, cut);
  }
  // 빈 양식은 "계 약 명 :" 처럼 구분자에서 끝나 값이 콜론에 바로 붙는다 → 한 칸 띄운다.
  const gap = /[:：]$/.test(head) ? " " : "";
  // 접미어 앞도 마찬가지("…㈜대표이사" 처럼 붙지 않게)
  const tailGap = tailStart < full.length && !/^\s/.test(full.slice(tailStart)) ? " " : "";

  let out = "";
  let placed = false;
  let cursor = 0;
  if (labelDisplay && labelSpan) {
    // 라벨 재작성 시에는 조각 좌표가 원문과 어긋나므로 첫 조각에 통짜로 싣는다
    for (const p of pieces) {
      let next = "";
      if (!placed) {
        next = head + gap + value + tailGap + (tailStart < full.length ? full.slice(tailStart) : "");
        placed = true;
      }
      out += fragment.slice(cursor, p.start) + `<hp:t>${escapeXml(next)}</hp:t>`;
      cursor = p.end;
    }
    out += fragment.slice(cursor);
    return placed ? { xml: out, headWidth: textWidth(head + gap) } : null;
  }
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
  return placed ? { xml: out, headWidth: textWidth(head + gap) } : null;
}

/** 값을 limit(반각 칸) 이하가 되도록 공백 경계에서 두 도막으로 나눈다. */
function splitByWidth(value: string, limit: number): [string, string] {
  if (limit <= 0 || textWidth(value) <= limit) return [value, ""];
  const parts = value.split(/(\s+)/);
  let head = "";
  let i = 0;
  for (; i < parts.length; i += 1) {
    if (head.trim() && textWidth(head + parts[i]) > limit) break;
    head += parts[i];
  }
  const rest = parts.slice(i).join("").trimStart();
  return rest ? [head.trimEnd(), rest] : [value, ""];
}

export interface FillResult {
  xml: string;
  /** 주입하지 못한 자리(라벨을 못 찾음 등) — UI 경고용 */
  missed: TemplateSlot[];
}

/**
 * 앞 문단 값의 **연장 줄**인가 — 라벨 없이 앞 값의 나머지만 담긴 줄.
 * 양식에 샘플 값이 두 줄로 들어 있을 때 생긴다("… 통합환경 인허가 및" / "PSM 외 작성 용역").
 * 새 값이 길면 이 자리에 나머지를 담고, 짧으면 지운다(안 그러면 옛 값의 꼬리가 남는다).
 *
 * ⚠ 착수계의 "(₩171,500,000) VAT포함" 처럼 **괄호·통화기호로 시작하는 독립 표기**는 제외한다 —
 * 라벨이 없다는 것만으로 지우면 멀쩡한 둘째 줄까지 없앤다.
 */
function isContinuation(fragment: string, slotParas: Set<number>, paraIndex?: number): boolean {
  if (paraIndex != null && slotParas.has(paraIndex)) return false; // 자기 값 자리가 있는 문단
  const { full } = textPieces(fragment);
  const text = full.trim();
  if (!text) return false;
  if (/[:：]/.test(text)) return false;
  if (/^(\d+\s*[.)]|[□■○●▪·-])/.test(text)) return false;
  if (/^[(（[［{＜<₩￦$]/.test(text)) return false;
  return true;
}

/**
 * 자리에 넣을 값. 주소는 축약해 **한 줄에 앉힌다** — 발주처 양식은 여백 줄이 빠듯해
 * 주소가 두 줄로 흐르면 그 아래(인감 포함)가 밀리고, 접힌 둘째 줄은 들여쓰기도 잃는다.
 */
function valueFor(slot: TemplateSlot, values: DeliverableValues): string {
  const raw = renderBinding(slot.binding, values, slot.format);
  // 주소는 시·도 축약 + 건물명 제거로 한 줄에 앉힌다(층은 남긴다 — 사업장 표기에 필요).
  // 그래도 원본보다 길면 서명란 전체를 왼쪽으로 당겨 흡수한다(shiftLeft).
  return slot.binding === "company.address" ? compactAddress(raw) : raw;
}

/** 반각 기준 표기 폭 — 한글·전각은 2, 나머지는 1(hwpx.ts 와 같은 척도). */
function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[가-힣ㄱ-ㅎㆍ-ㆎ가-힣　-〿！-｠]/.test(ch) ? 2 : 1;
  return w;
}

/** 서명란을 왼쪽으로 당길 때 남겨 둘 최소 들여쓰기(칸) — 본문 왼쪽 끝에 붙지 않게. */
const MIN_LEAD = 2;

/** 문단 첫머리의 들여쓰기 공백 길이. */
function leadWidth(fragment: string): number {
  const m = /<hp:t>([\s\S]*?)<\/hp:t>/.exec(fragment);
  return m ? (/^[ 　]*/.exec(m[1])?.[0] ?? "").length : 0;
}

/** 문단 첫머리의 들여쓰기 공백을 count 칸 걷어낸다(문단을 왼쪽으로 당긴다). */
function shiftLeft(fragment: string, count: number): string {
  if (count <= 0) return fragment;
  let done = false;
  return fragment.replace(/<hp:t>([\s\S]*?)<\/hp:t>/, (all, inner: string) => {
    if (done) return all;
    done = true;
    const lead = /^[ 　]*/.exec(inner)?.[0] ?? "";
    if (!lead) return all;
    return `<hp:t>${inner.slice(Math.min(count, lead.length))}</hp:t>`;
  });
}

/** 셀 fragment 안 모든 문단의 정렬 스타일을 바꾼다(배분정렬 서명 셀 → 왼쪽 정렬). */
function retargetCellAlign(fragment: string, paraPrId: string | null): string {
  if (!paraPrId) return fragment;
  return fragment.replace(/paraPrIDRef="\d+"/g, `paraPrIDRef="${paraPrId}"`);
}

/**
 * 서명부 셀 주입(2026-08-19 사용자 피드백) — 라벨 없는 회사 셀(주소·상호·대표자)은
 * 원본이 배분정렬(DISTRIBUTE)이라 값을 넣으면 글자가 쫙 벌어진다("1 0 0 , 1 2 층").
 * 기본양식 서명란 형태를 복제한다: 주소·상호는 왼쪽 정렬로, 대표자는 원본 표기
 * ("대표이사   이 유 억   (인)")를 라벨 보존 + 성명 벌려쓰기로 재구성(정렬은 원본 유지 —
 * 배분정렬이 "(인)"을 오른쪽 끝에 붙여 종이 절대좌표 인감과 맞는다).
 */
function fillSignatureCell(
  cellXml: string,
  slot: TemplateSlot,
  values: DeliverableValues,
  leftParaPr: string | null
): { xml: string; text: string } {
  const raw = renderBinding(slot.binding, values, slot.format);
  if (slot.binding === "company.ceo") {
    const { full } = textPieces(cellXml);
    const hasMark = full.includes("(인)");
    // 원문 "대표이사   이 유 억   (인)" — 2칸 이상 간격으로 가르면 [직함, 성명]이 나온다.
    // 토큰이 2개 이상일 때 첫 토큰이 직함 라벨(성명만 있으면 토큰 1개 — 벌려쓰기는 1칸 공백).
    const parts = full.replace("(인)", "").trim().split(/\s{2,}/).map((t) => t.trim()).filter(Boolean);
    const label = parts.length >= 2 && squeeze(parts[0]) !== squeeze(raw) ? parts[0] : "";
    const text = [label, spreadName(raw), hasMark ? "(인)" : ""].filter(Boolean).join("   ");
    return { xml: retargetCellAlign(replaceTexts(cellXml, text), leftParaPr), text };
  }
  const value = slot.binding === "company.address" ? compactAddress(raw) : raw;
  return { xml: retargetCellAlign(replaceTexts(cellXml, value), leftParaPr), text: value };
}

function applySlots(xml: string, slots: TemplateSlot[], values: DeliverableValues, leftParaPr: string | null = null): FillResult {
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
    /** 서명란 왼쪽 정렬 조정용 — 값을 넣어 원본보다 늘어난 폭(반각 칸) */
    binding?: string;
    overflow?: number;
  }
  const edits: Edit[] = [];
  /** 서명부 셀(라벨 없는 회사 셀) — 표 단위 후처리(인감 정렬·글자 크기 통일)용 */
  const signCells: { table: number; binding: string; text: string; editIndex: number }[] = [];
  // 라벨 폭 통일(2026-08-19) — 항목 라벨("용역명"~"준공년월일")을 최장 라벨 폭에 맞춰 벌린다.
  // 콜론이 붙은 본문 라벨만 대상(서명부·표 셀 라벨은 제외).
  const labelCore = (label: string) => label.replace(/\s*[:：]\s*$/, "").replace(/\s+/g, "");
  const paraLabels = slots.filter((sl) => sl.target === "para" && /[:：]\s*$/.test(sl.label ?? ""));
  const maxLabelW = Math.max(0, ...paraLabels.map((sl) => textWidth(labelCore(sl.label))));
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
      const isSignCell = !slot.label && slot.binding.startsWith("company.");
      if (isSignCell) {
        const filledCell = fillSignatureCell(xml.slice(start, end), slot, values, leftParaPr);
        edits.push({ start, end, text: filledCell.xml });
        signCells.push({ table: slot.table as number, binding: slot.binding, text: filledCell.text, editIndex: edits.length - 1 });
      } else {
        edits.push({ start, end, text: replaceTexts(xml.slice(start, end), value) });
      }
      continue;
    }
    const span = slot.para != null ? byPara.get(slot.para) : undefined;
    if (!span) {
      missed.push(slot);
      continue;
    }
    const original = xml.slice(span.start, span.end);
    const origWidth = textWidth(textPieces(original).full);

    // 원본 양식의 값이 두 줄이면 그 아래에 **연장 문단**이 따로 있다(라벨 없이 나머지만 담긴 줄).
    const nextSpan = slot.para != null ? byPara.get(slot.para + 1) : undefined;
    const nextXml = nextSpan ? xml.slice(nextSpan.start, nextSpan.end) : "";
    const hasContinuation = !!nextSpan && isContinuation(nextXml, slotParas, slot.para! + 1);

    const wantsPad = slot.target === "para" && /[:：]\s*$/.test(slot.label ?? "") && maxLabelW > 0;
    // 라벨(slot.label)에 콜론이 포함돼 있어 표시용 라벨에도 구분자를 되붙인다(" : " — 원문 관행)
    const display = wantsPad ? `${padLabel(labelCore(slot.label), maxLabelW)} : ` : undefined;
    let filled = fillParaValue(original, slot.label, slot.suffix, value, display);
    if (filled == null) {
      missed.push(slot);
      continue;
    }

    if (hasContinuation) {
      // 값이 한 줄을 넘으면 원본처럼 두 줄로 나눠 담는다 — 둘째 줄은 값 시작 위치에 맞춰
      // 들여쓴다(그냥 넘기면 한글이 접어 왼쪽 끝에 붙는다). 남으면 연장 문단은 지운다.
      const [head, rest] = splitByWidth(value, Math.max(0, origWidth - filled.headWidth));
      if (rest) {
        const again = fillParaValue(original, slot.label, slot.suffix, head, display);
        if (again) filled = again;
        edits.push({ start: nextSpan!.start, end: nextSpan!.end, text: replaceTexts(nextXml, " ".repeat(filled.headWidth) + rest) });
      } else {
        edits.push({ start: nextSpan!.start, end: nextSpan!.end, text: "" });
      }
    }

    // 원본이 한 줄에 들어갔으므로, 그 폭을 넘지 않으면 새 값도 한 줄에 들어간다
    const overflow = textWidth(textPieces(filled.xml).full) - origWidth;
    edits.push({ start: span.start, end: span.end, text: filled.xml, binding: slot.binding, overflow });
  }

  // ── 서명부 표 후처리(2026-08-19 사용자 피드백) — 인감(종이 절대좌표)과 표(문단 흐름 배치)가
  //    어긋난다 → 표 머리의 <hp:pos>만 종이 절대 배치로 바꿔 마지막 줄(대표자)이 인감과
  //    겹치게 하고, 셀 글자 크기(charPr)를 상호 줄 기준으로 통일하며, 값이 넘치면 표 폭을
  //    왼쪽 시작 위치 고정한 채 늘린다(pos·sz 는 표 머리라 셀 edits 와 구간이 겹치지 않는다).
  for (const tableIdx of [...new Set(signCells.map((c) => c.table))]) {
    const group = signCells.filter((c) => c.table === tableIdx);
    if (group.length < 2) continue;
    const span = tableSpan.get(tableIdx);
    if (!span) continue;
    const tableXml = xml.slice(span.start, span.end);
    const headEnd = tableXml.indexOf("<hp:tr");
    if (headEnd < 0) continue;
    const head = tableXml.slice(0, headEnd);

    // 글자 크기 통일 — 상호(name) 셀의 charPr 을 기준으로 나머지 서명 셀에 적용
    const nameCell = group.find((c) => c.binding === "company.name") ?? group[0];
    const charPr = /charPrIDRef="(\d+)"/.exec(edits[nameCell.editIndex].text)?.[1] ?? null;
    if (charPr) {
      for (const c of group) {
        if (c === nameCell) continue;
        edits[c.editIndex].text = edits[c.editIndex].text.replace(/charPrIDRef="\d+"/g, `charPrIDRef="${charPr}"`);
      }
    }

    const szM = /<hp:sz width="(\d+)"[^>]*height="(\d+)"[^>]*\/>/.exec(head);
    const rowHM = /<hp:cellSz width="\d+" height="(\d+)"/.exec(tableXml);
    const posM = /<hp:pos[^>]*\/>/.exec(head);
    if (!szM || !rowHM || !posM) continue;
    const tblW = Number(szM[1]);
    const tblH = Number(szM[2]);
    const rowH = Number(rowHM[1]);
    const marginL = Number(/<hp:cellMargin left="(\d+)"/.exec(tableXml)?.[1] ?? 141);
    const charH = 1300; // 서명부 실측 13pt(발주처 준공계 관행 12~13pt) — 반각 폭 = height/2
    const half = charH / 2;

    // 폭 확장 — 가장 긴 줄이 셀에 접히지 않게. 표 머리 sz 와 각 서명 셀의 cellSz 를 함께 늘린다.
    const needW = Math.round(Math.max(...group.map((c) => textWidth(c.text))) * half + marginL * 2 + 300);
    if (needW > tblW) {
      edits.push({
        start: span.start + szM.index,
        end: span.start + szM.index + szM[0].length,
        text: szM[0].replace(/width="\d+"/, `width="${needW}"`),
      });
      for (const c of group) {
        edits[c.editIndex].text = edits[c.editIndex].text.replace(/(<hp:cellSz width=")\d+(")/, `$1${needW}$2`);
      }
    }

    // 서명부·인감 배치(2026-08-19 확정) — 표 오른쪽 끝을 본문 우측에서 40pt 들여 놓고
    // (세 줄 시작 위치 동일·기본양식 관행), 인감은 대표자 줄 "(인)" 중심으로 옮긴다.
    // 크기도 기본양식 인감(5008x4899 HWPUNIT)으로 통일한다 — 서식마다 도장 크기가 달랐다.
    const pic = /<hp:pic\b[\s\S]*?<\/hp:pic>/g;
    let anchor: { xml: string; start: number; end: number; x: number; y: number; w: number; h: number } | null = null;
    let pm: RegExpExecArray | null;
    while ((pm = pic.exec(xml))) {
      if (!/vertRelTo="PAPER"/.test(pm[0])) continue;
      anchor = {
        xml: pm[0],
        start: pm.index,
        end: pm.index + pm[0].length,
        x: Number(/horzOffset="(-?\d+)"/.exec(pm[0])?.[1] ?? 0),
        y: Number(/vertOffset="(-?\d+)"/.exec(pm[0])?.[1] ?? 0),
        w: Number(/<hp:sz width="(\d+)"/.exec(pm[0])?.[1] ?? 0),
        h: Number(/<hp:sz width="\d+"[^>]*height="(\d+)"/.exec(pm[0])?.[1] ?? 0),
      };
      break;
    }
    const ceo = group.find((c) => c.binding === "company.ceo");
    const markAt = ceo ? ceo.text.indexOf("(인)") : -1;
    if (anchor && anchor.w > 0 && ceo && markAt >= 0) {
      // 페이지 기하 — 양식의 secPr 에서 읽는다(없으면 A4 기본값)
      const pageW = Number(/<hp:pagePr[^>]*width="(\d+)"/.exec(xml)?.[1] ?? 59528);
      const marginR = Number(/<hp:margin[^>]*right="(\d+)"/.exec(xml)?.[1] ?? 5669);
      const finalW = Math.max(tblW, needW);
      const tableX = Math.max(2000, pageW - marginR - 4000 - finalW);
      const tableY = Math.max(0, Math.round(anchor.y + anchor.h / 2 - tblH + rowH / 2));
      edits.push({
        start: span.start + posM.index,
        end: span.start + posM.index + posM[0].length,
        text:
          `<hp:pos treatAsChar="0" affectLSpacing="0" flowWithText="0" allowOverlap="1" holdAnchorAndSO="0" ` +
          `vertRelTo="PAPER" horzRelTo="PAPER" vertAlign="TOP" horzAlign="LEFT" vertOffset="${tableY}" horzOffset="${tableX}"/>`,
      });
      // 인감 이동·크기 통일 — (인) 중심 위에, 5008x4899(기본양식 실측)로
      const SW = 5008;
      const SH = 4899;
      const beforeW = textWidth(ceo.text.slice(0, markAt));
      const markW = textWidth("(인)");
      const markCX = tableX + marginL + (beforeW + markW / 2) * half;
      const oldCY = anchor.y + anchor.h / 2;
      const orgW = Number(/<hp:orgSz width="(\d+)"/.exec(anchor.xml)?.[1] ?? SW);
      const orgH = Number(/<hp:orgSz width="\d+" height="(\d+)"/.exec(anchor.xml)?.[1] ?? SH);
      let nextPic = anchor.xml
        .replace(/(<hp:curSz width=")\d+(" height=")\d+(")/, `$1${SW}$2${SH}$3`)
        .replace(/(<hp:sz width=")\d+("[^>]*height=")\d+(")/, `$1${SW}$2${SH}$3`)
        .replace(/(centerX=")\d+(" centerY=")\d+(")/, `$1${Math.round(SW / 2)}$2${Math.round(SH / 2)}$3`)
        .replace(/horzOffset="-?\d+"/, `horzOffset="${Math.round(markCX - SW / 2)}"`)
        .replace(/vertOffset="-?\d+"/, `vertOffset="${Math.round(oldCY - SH / 2)}"`);
      if (orgW > 0 && orgH > 0) {
        nextPic = nextPic.replace(
          /(<hc:scaMatrix e1=")[\d.]+(" e2="0" e3="0" e4="0" e5=")[\d.]+(")/,
          `$1${(SW / orgW).toFixed(6)}$2${(SH / orgH).toFixed(6)}$3`
        );
      }
      edits.push({ start: anchor.start, end: anchor.end, text: nextPic });
    }
  }

  // 서명란(계약상대자·주소·상호·대표자)은 값이 원본보다 길어지기 쉽다. 줄을 접는 대신
  // **네 줄을 함께 왼쪽으로 당겨** 흡수한다 — 따로 당기면 서로 어긋나 보이므로 같은 칸수로.
  const sign = edits.filter((e) => e.binding?.startsWith("company."));
  const need = Math.max(0, ...sign.map((e) => e.overflow ?? 0));
  if (need > 0 && sign.length) {
    const room = Math.min(...sign.map((e) => Math.max(0, leadWidth(e.text) - MIN_LEAD)));
    const shift = Math.min(need, room);
    if (shift > 0) for (const e of sign) e.text = shiftLeft(e.text, shift);
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

/**
 * 매핑되지 않은 작성일 문단 자동 치환(2026-08-19 사용자 피드백) — 발주처 양식의 가운데
 * 작성일("2020. 07. 16")이 슬롯 분석에서 빠지면 원본 날짜가 그대로 남는다.
 * 슬롯이 없는 최상위 문단 중 날짜만 담긴 문단을 issue.date 로 바꾼다(원본 표기 유지:
 * 년월일 표기는 dateKorean, 점 표기는 dateDotted — 끝 마침표 유무도 원본을 따른다).
 */
const DATE_ONLY_RE = /^\d{4}\s*([.년])\s*\d{1,2}\s*[.월]\s*\d{1,2}\s*[.일]?\s*$/;

function fillLooseDateParas(xml: string, slots: TemplateSlot[], values: DeliverableValues): string {
  const issue = values["issue.date"];
  if (issue == null || issue === "") return xml;
  const slotParas = new Set(slots.filter((s) => s.target === "para" && s.para != null).map((s) => s.para as number));
  const spans = scanParaSpans(xml).filter((sp) => !slotParas.has(sp.index));
  const edits: { start: number; end: number; text: string }[] = [];
  for (const sp of spans) {
    const fragment = xml.slice(sp.start, sp.end);
    if (fragment.includes("<hp:tbl")) continue; // 표를 품은 문단은 건드리지 않는다
    const text = textPieces(fragment).full.trim();
    const m = DATE_ONLY_RE.exec(text);
    if (!m) continue;
    let value = formatValue(issue, m[1] === "년" ? "dateKorean" : "dateDotted", values);
    if (m[1] === "." && !/\.$/.test(text)) value = value.replace(/\.$/, ""); // 원본이 끝점 없는 표기
    edits.push({ start: sp.start, end: sp.end, text: replaceTexts(fragment, value) });
  }
  let out = xml;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
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

  // 서명 셀 왼쪽 정렬용 — 이 양식 헤더에서 왼쪽 정렬 paraPr 을 찾는다(없으면 정렬 유지)
  let leftParaPr: string | null = null;
  const headerXml = await zip.file("Contents/header.xml")?.async("string");
  if (headerXml) {
    const m = /<hh:paraPr id="(\d+)"[^>]*>(?:(?!<\/hh:paraPr>)[\s\S])*?<hh:align horizontal="LEFT"/.exec(headerXml);
    leftParaPr = m ? m[1] : null;
  }

  const original = await entry.async("string");
  // 서식을 먼저 골라낸 뒤 주입해야 남은 문단의 연번이 어긋나지 않는다 —
  // 그래서 골라내기 전 좌표로 주입하고, 골라내기는 마지막에 한다.
  const applied = applySlots(original, slots, values, leftParaPr);
  let xml = fillLooseDateParas(applied.xml, slots, values);
  xml = keepDocs(xml, profile, docTypes);
  if (opts.dropParas?.length) xml = dropParagraphs(xml, opts.dropParas);
  if (!opts.keepLineSeg) xml = xml.replace(LINESEG_RE, "");

  zip.file("Contents/section0.xml", xml);
  const mimetype = zip.file("mimetype");
  if (mimetype) zip.file("mimetype", await mimetype.async("uint8array"), { compression: "STORE" });
  return { bytes: await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }), missed: applied.missed };
}
