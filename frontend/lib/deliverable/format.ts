// 착수계·준공계 값 포맷터 — 순수 함수(클라/서버 공용). PDF·HWPX 렌더러와 작성 화면
// 미리보기가 같은 결과를 내도록 여기 하나만 쓴다.
// 표기는 실물 실측(docs/contract-deliverables-blueprint.md §1)을 따른다.

import { toHangulAmount } from "@/lib/quote/hangul-amount";
import { DELIVERABLE_BINDINGS, type DeliverableSpec, type DeliverableValues, type FieldFormat } from "./types";

const DEFAULT_FORMAT: Record<string, FieldFormat> = Object.fromEntries(
  DELIVERABLE_BINDINGS.map((b) => [b.key, b.format])
);

/**
 * VAT 표기 기본값.
 * 계약관리에 입력하는 계약금액은 **VAT 미포함(공급가액)** 기준이다(2026-08-07 사용자 확정) →
 * 기본을 'VAT 별도'로 두고, 부가세는 역산이 아니라 가산한다(lib/deliverable/data.ts splitVat).
 * VAT 포함 금액으로 입력된 계약만 작성 화면에서 meta.vatNote 를 'VAT 포함'으로 바꾼다.
 */
export const DEFAULT_VAT_NOTE = "VAT 별도";

interface Ymd {
  y: string;
  m: string;
  d: string;
}

/** 자유 형식 날짜 문자열 → 연·월·일. 파싱 불가(자유 텍스트)면 null. */
export function parseYmd(value: unknown): Ymd | null {
  const s = value != null ? String(value).trim() : "";
  if (!s) return null;
  const m = s.match(/(\d{4})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/);
  if (!m) return null;
  return { y: m[1], m: m[2].padStart(2, "0"), d: m[3].padStart(2, "0") };
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function formatMoney(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}

/** "일금 일억칠천일백오십만원정" — 착수계 실측(붙임형 한글금액). */
export function amountHangulText(n: number): string {
  return `일금 ${toHangulAmount(n, { leadingOne: true })}원정`;
}

/** "일금 구천삼백칠십팔만일천오백 원정(￦ 93,781,500–VAT 포함)" — 준공 3종 실측. */
export function amountBothText(n: number, vatNote: string): string {
  return `일금 ${toHangulAmount(n, { leadingOne: true })} 원정(￦ ${formatMoney(n)}–${vatNote})`;
}

/**
 * 단일 값 포맷. 값이 비었으면 빈 문자열(미리보기에서 빈칸으로 보이고 사용자가 채운다).
 * 날짜가 자유 텍스트('용역 완료시 까지' 등)면 원문을 그대로 통과시킨다(계약 데이터 관행).
 */
export function formatValue(raw: unknown, format: FieldFormat | undefined, values: DeliverableValues): string {
  const s = raw != null ? String(raw).trim() : "";
  const vatNote = String(values["meta.vatNote"] ?? DEFAULT_VAT_NOTE);
  switch (format) {
    case "amountHangul": {
      const n = toNumber(raw);
      return n == null ? s : amountHangulText(n);
    }
    case "amountNumber": {
      const n = toNumber(raw);
      return n == null ? s : formatMoney(n);
    }
    case "amountBoth": {
      const n = toNumber(raw);
      return n == null ? s : amountBothText(n, vatNote);
    }
    case "dateDotted": {
      const p = parseYmd(raw);
      return p ? `${p.y}. ${p.m}. ${p.d}.` : s;
    }
    case "dateKorean": {
      const p = parseYmd(raw);
      return p ? `${p.y}년  ${p.m}월  ${p.d}일` : s;
    }
    case "dateSpaced": {
      // 작성일(서명 위) 실측 표기 — 월·일의 선행 0을 떼고 넓은 간격
      const p = parseYmd(raw);
      return p ? `${p.y}년    ${Number(p.m)}월     ${Number(p.d)}일` : s;
    }
    case "period": {
      // "2026년 05월 28일 ~ 2026년 07월 24일" — 값이 "시작~종료" 또는 이미 완성된 문구
      const parts = s.split("~");
      if (parts.length === 2) {
        const a = parseYmd(parts[0]);
        const b = parseYmd(parts[1]);
        if (a && b) return `${a.y}년 ${a.m}월 ${a.d}일 ~ ${b.y}년 ${b.m}월 ${b.d}일`;
      }
      return s;
    }
    case "percent": {
      const n = toNumber(raw);
      return n == null ? s : `${n}%`;
    }
    case "nameSpread":
      return spreadName(s);
    case "multiline":
    case "text":
    default:
      return s;
  }
}

/**
 * 문서 표기용 상호 축약 — "주식회사 한국환경안전연구원" → "㈜한국환경안전연구원".
 * 실물 양식이 ㈜ 표기이고, 풀 표기는 표 셀에서 3줄로 접혀 행 높이가 커지며 페이지가 밀린다
 * (2026-08-07 사용자 확정). 회사 프로필 원본 값은 그대로 두고 출력에서만 줄인다.
 */
export function compactCompanyName(name: string): string {
  return (name ?? "")
    .trim()
    .replace(/^주식회사\s*/, "㈜")
    .replace(/\s*주식회사$/, "")
    .replace(/^\(주\)\s*/, "㈜");
}

/** 성명 글자 벌리기 — "이유억" → "이 유 억" (실물 서명란 표기). 한글 2~4자에만 적용. */
export function spreadName(name: string): string {
  const t = (name ?? "").trim();
  return /^[가-힣]{2,4}$/.test(t) ? t.split("").join(" ") : t;
}

/** 바인딩 키의 값을 정의된 기본 포맷(또는 지정 포맷)으로 렌더. */
export function renderBinding(binding: string, values: DeliverableValues, format?: FieldFormat): string {
  const out = formatValue(values[binding], format ?? DEFAULT_FORMAT[binding], values);
  // 자사 상호는 문서 표기 관행(㈜)으로 줄여 쓴다 — PDF·HWPX 공통
  return binding === "company.name" ? compactCompanyName(out) : out;
}

/**
 * 본문 문구·고정 텍스트의 토큰 치환. `{{키}}` 또는 `{{키|포맷}}`.
 * 예: "(￦{{contract.amount|amountNumber}}) {{meta.vatNote}}"
 */
export function renderTemplate(text: string, values: DeliverableValues): string {
  return text.replace(/\{\{\s*([\w.]+)\s*(?:\|\s*(\w+)\s*)?\}\}/g, (_all, key: string, fmt?: string) =>
    renderBinding(key, values, fmt as FieldFormat | undefined)
  );
}

/** FieldRow·CellSpec 처럼 binding 또는 text 중 하나를 갖는 자리의 최종 문자열. */
export function renderSlot(
  slot: { binding?: string; text?: string; format?: FieldFormat; suffix?: string },
  values: DeliverableValues
): string {
  const base = slot.binding ? renderBinding(slot.binding, values, slot.format) : renderTemplate(slot.text ?? "", values);
  const suffix = slot.suffix ? renderTemplate(slot.suffix, values) : "";
  if (!suffix) return base;
  return base ? `${base}   ${suffix}` : suffix;
}

/**
 * Spec 이 실제로 사용하는 바인딩 키 목록(등장 순서).
 * 작성 화면은 이 목록만 입력란으로 노출한다 — 선택하지 않은 서식의 필드는 보이지 않는다.
 */
export function collectBindings(specs: DeliverableSpec[]): string[] {
  const out: string[] = [];
  const add = (key?: string) => {
    if (key && !out.includes(key)) out.push(key);
  };
  const fromText = (text?: string) => {
    if (!text) return;
    for (const m of text.matchAll(/\{\{\s*([\w.]+)\s*(?:\|\s*\w+\s*)?\}\}/g)) add(m[1]);
  };
  const fromSlot = (slot?: { binding?: string; text?: string; suffix?: string }) => {
    if (!slot) return;
    add(slot.binding);
    fromText(slot.text);
    fromText(slot.suffix);
  };
  for (const spec of specs) {
    for (const block of spec.blocks) {
      switch (block.kind) {
        case "fields":
          for (const row of block.rows) {
            fromSlot(row);
            fromSlot(row.secondLine);
          }
          break;
        case "table":
          fromText(block.caption);
          for (const row of block.rows) for (const cell of row) fromSlot(cell);
          break;
        case "signature":
          for (const row of block.rows) fromSlot(row);
          break;
        case "para":
        case "note":
          fromText(block.text);
          break;
        case "dateLine":
        case "receiver":
          add(block.binding);
          break;
        case "stampBox":
          fromText(block.label);
          break;
        default:
          break;
      }
    }
  }
  return out;
}

/** 항목 번호 접두 — fields 블록의 numbering. */
export function numberPrefix(numbering: "none" | "decimal" | "square", index: number): string {
  if (numbering === "decimal") return `${index + 1}. `;
  if (numbering === "square") return "□ ";
  return "";
}
