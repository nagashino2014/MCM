// 업종 상관관계 규칙 층(블루프린트 §4-①) — LLM 호출 없이 자명한 케이스를 태깅한다.
// 우선순위: facilities 매칭(마스터가 정답) > 소스별 규칙 > LLM 판정(분류기).
// industry 특수 키: 'industrial-complex'(산단·농공단지 = 입주 기반), 'other'(대상이나 업종 미상).

import { rowsToObjects, type PgDatabase } from "@/lib/db";
import {
  INTEGRATED_PERMIT_INDUSTRIES,
  industryCodeMatchesCategory,
} from "@/lib/ieps/integrated-permit-industries";

export type IndustryRelevance = "direct" | "supply_chain" | "low" | "none";

export interface IndustryTag {
  industry: string | null;
  relevance: IndustryRelevance | null;
  note: string | null;
}

export const EMPTY_INDUSTRY_TAG: IndustryTag = { industry: null, relevance: null, note: null };

/** facilities.industry_code(줄바꿈/쉼표/슬래시 연결 복수 KSIC) → 대상 업종 id 첫 매치. */
export function industryIdFromKsic(industryCode: string | null | undefined): string | null {
  if (!industryCode) return null;
  const codes = String(industryCode).split(/[\n,/]+/).map((s) => s.trim()).filter(Boolean);
  for (const cat of INTEGRATED_PERMIT_INDUSTRIES) {
    for (const code of codes) {
      if (industryCodeMatchesCategory(code, cat)) return cat.id;
    }
  }
  return null;
}

/**
 * facilities 매칭 신호의 태그 — 마스터(통합허가 대상 사업장)가 정답이므로 relevance=direct.
 * KSIC 로 업종을 못 찾으면 'other'(대상이지만 업종 미상).
 */
export async function industryTagForFacility(db: PgDatabase, facilityId: string): Promise<IndustryTag> {
  try {
    const rows = rowsToObjects(
      await db.exec(`SELECT industry_code FROM facilities WHERE facility_id = $1`, [facilityId])
    );
    const id = industryIdFromKsic(rows.length ? (rows[0].industry_code as string | null) : null);
    return { industry: id ?? "other", relevance: "direct", note: null };
  } catch {
    return { industry: "other", relevance: "direct", note: null };
  }
}

/** EIASS bizCategory 규칙 — 자명 카테고리만. '공장' 등 업종 판단이 필요한 건 null(LLM 위임). */
export function ruleTagForEiass(bizCategory: string | null | undefined): IndustryTag | null {
  const biz = (bizCategory ?? "").trim();
  if (!biz) return null;
  if (/산업입지|산업단지|농공단지|도시첨단/.test(biz)) {
    return { industry: "industrial-complex", relevance: "direct", note: null };
  }
  if (/폐기물|분뇨|자원순환/.test(biz)) {
    return { industry: "waste-incineration", relevance: "direct", note: null };
  }
  if (/에너지개발/.test(biz)) {
    return { industry: "power", relevance: "direct", note: null };
  }
  return null;
}

/** 고시(토지이음 산단 고시·환경청 RSS) — 산단 입주 기반 고정. */
export const GOSI_INDUSTRY_TAG: IndustryTag = {
  industry: "industrial-complex",
  relevance: "direct",
  note: null,
};
