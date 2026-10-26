/*
 * 회사소개서 변경 감지(P7) — 원천 지문의 모양과 비교 규칙. 클라이언트 안전(순수 함수).
 * 블루프린트 §6-1·§6-7: 초안은 라이브, 발행본은 스냅샷. tick 이 "지금 원천 지문"과 "최근 발행본 지문"을 비교해
 * 사람이 읽는 반영 대기 항목(추가·변경·삭제)을 만든다.
 *
 * 지문 = 원천별 { 항목 키 → { 이름표, 표시 칸 } }. 표시 칸은 소개서에 실제로 쓰이는 값만 짧은 글로 담는다
 * (계약의 updated_at 은 계산서·메모처럼 소개서와 무관한 수정에도 바뀌어 반영 대기가 시끄러워진다 → 실린 값 자체를 비교).
 * 칸 값이 빈 글이면 담지 않는다(빈 값 ↔ 없음이 같게).
 */

export type PendingSource = "contracts" | "people" | "company_profile" | "history" | "credentials" | "contents";
export type ChangeKind = "added" | "changed" | "removed";

export interface FpItem {
  /** 사람이 읽는 이름표(예: "2026 ○○화학 통합환경허가 취득 용역 수행 중") */
  l: string;
  /** 표시 칸 — 칸 이름(한글) → 짧은 값 */
  d: Record<string, string>;
}

export interface CatalogFingerprint {
  v: 1;
  /** 지문을 만든 때(ISO) */
  at: string;
  sources: Partial<Record<PendingSource, Record<string, FpItem>>>;
}

export interface FieldChange {
  name: string;
  before: string;
  after: string;
}

export interface PendingDiff {
  source: PendingSource;
  kind: ChangeKind;
  key: string;
  label: string;
  summary: string;
  fields: FieldChange[];
}

export const PENDING_SOURCES: PendingSource[] = ["contracts", "people", "company_profile", "history", "credentials", "contents"];

export const SOURCE_LABEL: Record<PendingSource, string> = {
  contracts: "실적(계약)",
  people: "인물",
  company_profile: "회사 정보",
  history: "연혁",
  credentials: "인증·등록·특허",
  contents: "인사말·조직도",
};

export const KIND_LABEL: Record<ChangeKind, string> = { added: "추가", changed: "변경", removed: "삭제" };

/** 원천별 문장 머리 — "새 실적 — …", "인물 빠짐 — …" */
const HEAD: Record<PendingSource, Record<ChangeKind, string>> = {
  contracts: { added: "새 실적", changed: "실적 변경", removed: "실적 빠짐" },
  people: { added: "인물 추가", changed: "인물 정보 변경", removed: "인물 빠짐" },
  company_profile: { added: "회사 정보 추가", changed: "회사 정보 변경", removed: "회사 정보 비움" },
  history: { added: "연혁 추가", changed: "연혁 변경", removed: "연혁 빠짐" },
  credentials: { added: "인증·등록 추가", changed: "인증·등록 변경", removed: "인증·등록 빠짐" },
  contents: { added: "새 확정판", changed: "새 확정판", removed: "확정판 없음" },
};

export function emptyFingerprint(at = new Date().toISOString()): CatalogFingerprint {
  return { v: 1, at, sources: {} };
}

/** 저장된 jsonb → 지문(모양이 다르면 빈 지문) */
export function parseFingerprint(v: unknown): CatalogFingerprint | null {
  if (v == null) return null;
  let o: unknown = v;
  if (typeof v === "string") {
    try {
      o = JSON.parse(v);
    } catch {
      return null;
    }
  }
  const f = o as Partial<CatalogFingerprint>;
  if (!f || f.v !== 1 || typeof f.sources !== "object" || f.sources == null) return null;
  return { v: 1, at: String(f.at ?? ""), sources: f.sources as CatalogFingerprint["sources"] };
}

/** 표시 칸 만들기 — 빈 값은 빼고 앞뒤 공백을 지운다 */
export function fields(entries: Array<[string, string | number | boolean | null | undefined]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (v == null || v === false) continue;
    const t = (v === true ? "예" : String(v)).replace(/\s+/g, " ").trim();
    if (t) out[k] = t;
  }
  return out;
}

function changedFields(a: Record<string, string>, b: Record<string, string>): FieldChange[] {
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return names.filter((n) => (a[n] ?? "") !== (b[n] ?? "")).map((n) => ({ name: n, before: a[n] ?? "", after: b[n] ?? "" }));
}

export function summarize(source: PendingSource, kind: ChangeKind, label: string, changes: FieldChange[]): string {
  const head = HEAD[source][kind];
  const tail = kind === "changed" && changes.length ? ` (${changes.slice(0, 4).map((c) => c.name).join("·")}${changes.length > 4 ? ` 외 ${changes.length - 4}` : ""})` : "";
  return `${head} — ${label}${tail}`;
}

/**
 * 기준 지문(최근 발행본) ↔ 지금 지문 → 차이 목록. 정렬: 원천 순서 → 추가·변경·삭제 → 이름표.
 * 기준에 없는 원천(옛 지문)은 비교하지 않는다 — 원천을 새로 늘린 날 모든 항목이 '추가'로 쏟아지지 않게.
 */
export function diffFingerprints(base: CatalogFingerprint, cur: CatalogFingerprint): PendingDiff[] {
  const out: PendingDiff[] = [];
  const order: Record<ChangeKind, number> = { added: 0, changed: 1, removed: 2 };
  for (const source of PENDING_SOURCES) {
    const a = base.sources[source];
    const b = cur.sources[source];
    if (!a || !b) continue;
    const list: PendingDiff[] = [];
    for (const [key, item] of Object.entries(b)) {
      const prev = a[key];
      if (!prev) list.push({ source, kind: "added", key, label: item.l, summary: summarize(source, "added", item.l, []), fields: [] });
      else {
        const ch = changedFields(prev.d ?? {}, item.d ?? {});
        if (ch.length) list.push({ source, kind: "changed", key, label: item.l, summary: summarize(source, "changed", item.l, ch), fields: ch });
      }
    }
    for (const [key, item] of Object.entries(a)) {
      if (!b[key]) list.push({ source, kind: "removed", key, label: item.l, summary: summarize(source, "removed", item.l, []), fields: [] });
    }
    list.sort((x, y) => order[x.kind] - order[y.kind] || x.label.localeCompare(y.label, "ko"));
    out.push(...list);
  }
  return out;
}

/** 원천별·종류별 건수(첫 화면 요약 "새 실적 3 · 인물 1") */
export function countBySource(items: Array<Pick<PendingDiff, "source" | "kind">>): Array<{ source: PendingSource; label: string; count: number }> {
  return PENDING_SOURCES.map((source) => ({ source, label: SOURCE_LABEL[source], count: items.filter((i) => i.source === source).length })).filter((x) => x.count > 0);
}

/** 알림 본문 — 앞 3건 + 나머지 건수 */
export function notifyBody(items: Array<Pick<PendingDiff, "summary">>): string {
  const head = items.slice(0, 3).map((i) => i.summary);
  return [...head, ...(items.length > 3 ? [`그 외 ${items.length - 3}건`] : [])].join("\n");
}
