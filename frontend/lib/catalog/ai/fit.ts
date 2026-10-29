/*
 * 회사소개서 AI 편집 — 넘침 줄이기(copy_fit) 대상 만들기. 클라이언트 안전(순수 함수 + 불러온 일러스트 등록부).
 * §7-5 G: 일러스트 자리의 제목 뒤 지표 칩(suffix)은 축약 글자 수에 칩 폭을 넣고, {{metric:…}} 표식으로 넘겨 칩을 지우지 못하게 한다.
 */
import { suffixItems } from "@/lib/catalog/illustration-types";
import { illustrationRender } from "@/lib/catalog/render/infographic/illustration";
import { INFO_TYPE_META, type InfoContent, type InfoType } from "@/lib/catalog/render/infographic/types";
import { charLen, metricText, type MetricBrief, type ProposedChange } from "./patch";

export const shrinkTo = (text: string, metrics: Record<string, MetricBrief>, ratio: number, floor = 6) => Math.max(floor, Math.floor(charLen(text, metrics) * ratio));

export type FitItem = { key: string; text: string; maxChars: number };

/** 일러스트 제목 뒤에 지표 칩이 붙는 항목(그 일러스트를 아직 불러오지 않았으면 없음) */
export function chipItems(illust: string | undefined, content: InfoContent): Set<number> {
  const info = illust ? illustrationRender(illust)?.info : undefined;
  return info ? suffixItems(info, content) : new Set();
}

const chipToken = (metric: string) => `{{metric:${metric}}}`;

/** 줄인 라벨에서 붙여 보낸 칩 표식을 뗀다(표식을 지운 응답이어도 칩은 지표에서 다시 그려진다) */
function stripChip(text: string, metric: string | undefined, fallback: string): string {
  if (!metric) return text;
  const tok = chipToken(metric);
  const i = text.lastIndexOf(tok);
  const out = (i >= 0 ? text.slice(0, i) + text.slice(i + tok.length) : text).replace(/\s+/g, " ").trim();
  return out || fallback;
}

/**
 * 인포그래픽 항목 줄이기 대상 — 라벨·설명. 일러스트 제목 뒤 지표 칩이 붙는 라벨은 '라벨 {{metric:id}}'로 보내고,
 * 칩(값 + 단위) 폭까지 넣은 전체 길이에 비율을 곱한 뒤 칩 몫을 뺀 만큼을 라벨 몫으로 준다(칩은 줄지 않으므로 라벨이 그만큼 더 준다).
 */
export function infoFitItems(id: string, content: InfoContent, type: InfoType, illust: string | undefined, metrics: Record<string, MetricBrief>, ratio: { label: number; desc: number }): FitItem[] {
  const meta = INFO_TYPE_META[type];
  const maxLabel = meta?.maxLabel ?? 12;
  const chips = chipItems(illust, content);
  const out: FitItem[] = [];
  content.items.forEach((it, i) => {
    if (it.metric && chips.has(i)) {
      const valueLen = charLen(chipToken(it.metric), metrics);
      const chip = valueLen + (it.unit ?? content.unit ?? metrics[it.metric]?.unit ?? "").replace(/\s+/g, "").length;
      const budget = Math.min(maxLabel, Math.max(4, Math.floor((charLen(it.label, metrics) + chip) * ratio.label) - chip));
      out.push({ key: `${id}@${i}.label`, text: `${it.label} ${chipToken(it.metric)}`, maxChars: budget + valueLen });
    } else out.push({ key: `${id}@${i}.label`, text: it.label, maxChars: Math.min(maxLabel, shrinkTo(it.label, metrics, ratio.label, 4)) });
    if (it.desc) out.push({ key: `${id}@${i}.desc`, text: it.desc, maxChars: Math.min(Math.max(meta?.maxDesc ?? 24, 12), shrinkTo(it.desc, metrics, ratio.desc, 8)) });
  });
  return out;
}

/** 줄인 결과 → 항목(칩 표식은 떼고) */
export function fittedItems(id: string, content: InfoContent, illust: string | undefined, got: Map<string, string>): InfoContent["items"] {
  const chips = chipItems(illust, content);
  return content.items.map((it, i) => {
    const l = got.get(`${id}@${i}.label`);
    const d = got.get(`${id}@${i}.desc`);
    return {
      ...it,
      label: l == null ? it.label : chips.has(i) ? stripChip(l, it.metric, it.label) : l,
      ...(it.desc != null ? { desc: d ?? it.desc } : {}),
    };
  });
}

export const infoContentOf = (c: ProposedChange): InfoContent | undefined => c.edit?.info?.content ?? c.content;
export const infoTypeOf = (c: ProposedChange): InfoType => (c.edit?.info?.type ?? c.infoType ?? "process") as InfoType;

/** 넘친 글이 든 바꿈(없으면 글·목록·인포그래픽·모양 바꿈 전부) — 일러스트 자리 글(제목 + 지표 칩 값)과도 맞춰 본다 */
export function overflowTargets(changes: ProposedChange[], texts: string[], metrics: Record<string, MetricBrief> = {}): ProposedChange[] {
  const norm = (s: string) => s.replace(/\s+/g, "");
  const keys = texts.map((t) => norm(t).slice(0, 12)).filter((t) => t.length >= 4);
  const hay = (c: ProposedChange) => {
    const content = infoContentOf(c);
    const items = content?.items.map((it) => `${it.label}${it.metric ? `${metricText(metrics[it.metric])}${it.unit ?? metrics[it.metric]?.unit ?? ""}` : ""}|${it.desc ?? ""}`).join("|") ?? "";
    return norm(`${c.after.join("")}|${items}`);
  };
  const pool = changes.filter((c) => c.kind !== "cases" && c.kind !== "style");
  const hit = pool.filter((c) => keys.some((k) => hay(c).includes(k)));
  return hit.length ? hit : pool;
}
