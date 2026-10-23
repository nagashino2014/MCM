/*
 * 마스터본 내용 → 인포그래픽 중립 구조(InfoContent). 쪽 컴포넌트가 P4 부품에 넘기던 모양을 그대로 받아 바꾼다.
 */
import { REGION_GROUPS } from "@/lib/catalog/regions";
import type { InfoContent, InfoSpec } from "./types";

/** 단계 흐름 [{label, desc}] */
export function stepsSpec(steps: Array<{ label: string; desc?: string }>): InfoSpec {
  return { type: "process", content: { items: steps.map((s, i) => ({ id: `s${i + 1}`, label: s.label, ...(s.desc ? { desc: s.desc } : {}) })) } };
}

/** "87.0점" → 87, "점" */
function parseFigure(text: string): { value: number; unit: string } {
  const m = text.replace(/,/g, "").match(/^\s*(-?\d+(?:\.\d+)?)\s*(.*)$/);
  return m ? { value: Number(m[1]), unit: m[2].trim() } : { value: 0, unit: "" };
}

/** 전후 비교 행 [{label, before, after}] */
export function compareSpec(rows: Array<{ label: string; before: string; after: string }>, legend?: [string, string]): InfoSpec {
  const content: InfoContent = {
    items: rows.map((r, i) => {
      const b = parseFigure(r.before);
      const a = parseFigure(r.after);
      return { id: `c${i + 1}`, label: r.label, prev: b.value, value: a.value, prevText: r.before, valueText: r.after, ...(a.unit ? { unit: a.unit } : {}) };
    }),
  };
  if (legend) content.legend = legend;
  return { type: "compare", content };
}

/** 범주 + 수치(권역 막대 등). region = 권역 id(지도형 변환 가능) */
export function barSpec(rows: Array<{ label: string; value: number; region?: string; key?: boolean }>, opts: { unit?: string; variant?: "h" | "v" } = {}): InfoSpec {
  return {
    type: "bar",
    variant: opts.variant ?? "h",
    content: {
      ...(opts.unit ? { unit: opts.unit } : {}),
      items: rows.map((r, i) => ({ id: `b${i + 1}`, label: r.label, value: r.value, ...(r.region ? { region: r.region } : {}), ...(r.key ? { key: true } : {}) })),
    },
  };
}

/** 구성비(도넛) */
export function shareSpec(parts: Array<{ label: string; value: number; tone?: number }>, center: { label: string; desc: string }, unit?: string): InfoSpec {
  return {
    type: "share",
    variant: "donut",
    content: { center, ...(unit ? { unit } : {}), items: parts.map((p, i) => ({ id: `p${i + 1}`, label: p.label, value: p.value, ...(p.tone ? { tone: p.tone } : {}) })) },
  };
}

/** 카드 [{title, en, desc}] */
export function cardsSpec(cards: Array<{ title: string; en?: string; desc?: string }>, cols = 2): InfoSpec {
  return {
    type: "cards",
    variant: String(cols),
    content: { items: cards.map((c, i) => ({ id: `k${i + 1}`, label: c.title, ...(c.en ? { sub: c.en } : {}), ...(c.desc ? { desc: c.desc } : {}) })) },
  };
}

/** 권역 이름 표기(막대 라벨) — 영남권 두 열은 괄호 안 이름만 */
export function regionRows(byRegion: Record<string, number>): Array<{ label: string; value: number; region: string }> {
  return REGION_GROUPS.map((g) => ({ label: g.label.replace(/^영남권\((.*)\)$/, "$1"), value: byRegion[g.id] ?? 0, region: g.id })).filter((r) => r.value > 0);
}
