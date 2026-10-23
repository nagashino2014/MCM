/*
 * 스튜디오 문서 상태 — 문서(판)의 설정(theme)과 쪽별 상태(순서·숨김·편집층). 클라이언트 안전.
 * 저장: catalog_documents.theme · catalog_pages(page_id = "{doc_id}:{쪽 키}", order_no, hidden, tree = 편집층) · catalog_versions(스냅샷).
 * 쪽 목록 자체는 데이터에서 만든 쪽 계획이 정한다 — 상태가 없는 쪽(새로 생긴 부록 분야 등)은 쪽 계획의 자리에 끼워 넣는다.
 */
import type { DocumentTheme } from "@/lib/catalog/document-theme";
import type { PagePlanItem } from "@/lib/catalog/render/components/plan";
import { isEmptyEdits, sanitizePageEdits, type PageEdits } from "./edits";

export interface StudioPageState {
  key: string;
  /** 사용자가 정한 순서(없으면 쪽 계획 순서) */
  order: number | null;
  hidden: boolean;
  edits: PageEdits;
}

export interface StudioDoc {
  docId: string;
  title: string;
  theme: DocumentTheme;
  pages: StudioPageState[];
  /** 저장 기준(동시 편집 감지) — catalog_documents.updated_at */
  rev: string;
  /** 마지막 버전 번호(catalog_documents.current_version) */
  version: number;
}

export const PAGE_KEY_RE = /^[a-z0-9-]{1,40}$/;

export function sanitizeStudioPages(input: unknown): StudioPageState[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: StudioPageState[] = [];
  for (const raw of input.slice(0, 300)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const key = typeof o.key === "string" ? o.key : "";
    if (!PAGE_KEY_RE.test(key) || seen.has(key)) continue;
    seen.add(key);
    const order = typeof o.order === "number" && Number.isInteger(o.order) && o.order >= 0 && o.order < 10000 ? o.order : null;
    out.push({ key, order, hidden: o.hidden === true, edits: sanitizePageEdits(o.edits) });
  }
  return out;
}

/** 저장할 가치가 있는 상태인가(순서·숨김·편집 중 하나라도 있음) */
export function isMeaningfulPage(p: StudioPageState): boolean {
  return p.order != null || p.hidden || !isEmptyEdits(p.edits);
}

/** 쪽 계획 + 쪽 상태 → 그릴 순서(숨긴 쪽 포함). 상태 순서가 없는 쪽은 쪽 계획에서 바로 앞 쪽 뒤에 끼운다. */
export function orderPlan<T extends Pick<PagePlanItem, "key">>(plan: T[], pages: StudioPageState[]): T[] {
  const byKey = new Map(pages.map((p) => [p.key, p]));
  const known = plan.filter((it) => byKey.get(it.key)?.order != null).sort((a, b) => byKey.get(a.key)!.order! - byKey.get(b.key)!.order!);
  if (known.length === 0) return [...plan];
  const result = [...known];
  const placed = new Set(result.map((r) => r.key));
  plan.forEach((it, i) => {
    if (placed.has(it.key)) return;
    let j = i - 1;
    while (j >= 0 && !placed.has(plan[j].key)) j--;
    const at = j < 0 ? 0 : result.findIndex((r) => r.key === plan[j].key) + 1;
    result.splice(at, 0, it);
    placed.add(it.key);
  });
  return result;
}

/** 순서를 바꾼 뒤 모든 쪽에 순서 번호를 매긴 상태 목록 */
export function withOrder(pages: StudioPageState[], orderedKeys: string[]): StudioPageState[] {
  const byKey = new Map(pages.map((p) => [p.key, p]));
  const out: StudioPageState[] = orderedKeys.map((key, i) => ({ ...(byKey.get(key) ?? { key, hidden: false, edits: { v: 1 } }), order: i }));
  for (const p of pages) if (!orderedKeys.includes(p.key)) out.push(p);
  return out;
}

export function pageState(pages: StudioPageState[], key: string): StudioPageState {
  return pages.find((p) => p.key === key) ?? { key, order: null, hidden: false, edits: { v: 1 } };
}

export function upsertPage(pages: StudioPageState[], next: StudioPageState): StudioPageState[] {
  const i = pages.findIndex((p) => p.key === next.key);
  if (i < 0) return [...pages, next];
  const out = [...pages];
  out[i] = next;
  return out;
}
