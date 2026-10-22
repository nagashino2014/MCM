/*
 * 회사소개서 편집 콘텐츠 공용 타입·정리 함수 — 클라이언트 안전(DB 접근은 contents.ts).
 *   ceo_message  대표이사 인사말(C03) — 본문·사진·서명
 *   org_chart    조직도(C12) — MCM 조직 마스터에서 기본안을 만들고 소개서 전용으로 고친 편집본(사용자 요구 10-22)
 * 두 콘텐츠 모두 임시 저장(draft) → 확정(새 판) → 소개서는 최신 확정판을 쓴다.
 */

export const CONTENT_KEYS = ["ceo_message", "org_chart"] as const;
export type ContentKey = (typeof CONTENT_KEYS)[number];

export interface CeoMessage {
  title: string;
  body: string;
  signTitle: string;
  signName: string;
  photoAssetId: string | null;
}

/** 조직도 상자 1개 — label = 조직·직책 이름, sub = 아래 줄(책임자·인원 등), badge = 촉탁 등 표시 */
export interface OrgNode {
  id: string;
  label: string;
  sub: string;
  badge: string;
  children: OrgNode[];
}

export interface OrgChartDoc {
  nodes: OrgNode[];
}

export interface ContentDataMap {
  ceo_message: CeoMessage;
  org_chart: OrgChartDoc;
}

export interface ContentVersion<K extends ContentKey = ContentKey> {
  version: number;
  data: ContentDataMap[K];
  note: string;
  savedAt: string;
  savedByName: string;
}

export interface ContentState<K extends ContentKey = ContentKey> {
  key: K;
  draft: ContentDataMap[K];
  publishedVersion: number | null;
  /** 임시 저장본이 최신 확정판과 다른지(확정 대기) */
  draftDiffers: boolean;
  updatedAt: string | null;
  versions: ContentVersion<K>[];
}

export const ORG_BADGES = ["촉탁", "자문", "외부"] as const;
export const ORG_LIMITS = { maxNodes: 150, maxDepth: 5, label: 40, sub: 80 } as const;

export function isContentKey(v: string): v is ContentKey {
  return (CONTENT_KEYS as readonly string[]).includes(v);
}

const str = (v: unknown, max: number): string => (v == null ? "" : String(v).trim()).slice(0, max);

export function sanitizeCeoMessage(input: unknown): CeoMessage {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    title: str(o.title, 100),
    // 본문은 줄바꿈을 살린다(앞뒤 공백만 정리)
    body: (o.body == null ? "" : String(o.body)).replace(/\r\n/g, "\n").trim().slice(0, 6000),
    signTitle: str(o.signTitle, 50),
    signName: str(o.signName, 50),
    photoAssetId: str(o.photoAssetId, 64) || null,
  };
}

/** 조직도 정리 — 깊이·상자 수·글자 수 제한, 이름 없는 상자와 중복 id 정리. */
export function sanitizeOrgChart(input: unknown): OrgChartDoc {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  let count = 0;
  const seen = new Set<string>();
  const walk = (list: unknown, depth: number): OrgNode[] => {
    if (!Array.isArray(list) || depth > ORG_LIMITS.maxDepth) return [];
    const out: OrgNode[] = [];
    for (const raw of list) {
      if (count >= ORG_LIMITS.maxNodes) break;
      const n = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const label = str(n.label, ORG_LIMITS.label);
      if (!label) continue;
      let id = str(n.id, 64) || `n:${count}`;
      while (seen.has(id)) id = `${id}_`;
      seen.add(id);
      count += 1;
      const badge = str(n.badge, 10);
      out.push({
        id,
        label,
        sub: str(n.sub, ORG_LIMITS.sub),
        badge: (ORG_BADGES as readonly string[]).includes(badge) ? badge : "",
        children: walk(n.children, depth + 1),
      });
    }
    return out;
  };
  return { nodes: walk(o.nodes, 1) };
}

export function countOrgNodes(nodes: OrgNode[]): number {
  return nodes.reduce((acc, n) => acc + 1 + countOrgNodes(n.children), 0);
}
