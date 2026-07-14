// "API&스크래핑" 화면 공용 타입·라벨·소스 탭 정의.

import { INTEL_SIGNAL_TYPE_LABELS, INTEL_SIGNAL_GRADE_LABELS } from "@/lib/intel/signal-extractor";
import { INTEGRATED_PERMIT_INDUSTRIES } from "@/lib/ieps/integrated-permit-industries";

// API 응답 shape(서버 intel-queries IntelSignal과 동일).
export interface IntelSignal {
  signalId: string;
  source: string;
  externalId: string;
  corpCode: string | null;
  companyName: string | null;
  brn: string | null;
  reportName: string | null;
  signalType: string;
  signalGrade: string;
  assetClass: string | null;
  acquirePurpose: string | null;
  counterparty: string | null;
  disclosedAt: string | null;
  amount: number | null;
  url: string | null;
  facilityId: string | null;
  facilityName: string | null;
  matchStatus: string;
  matchType: string;
  linkedProjectId: string | null;
  status: string;
  duplicateOf: string | null;
  industry: string | null;
  industryRelevance: string | null; // direct | supply_chain | low | none
  relevanceNote: string | null;
  createdAt: string;
}

export interface IntelSignalDetail extends IntelSignal {
  summary: string | null;
  rawJson: Record<string, unknown> | null;
}

// ── RAG 브리핑 응답 shape(서버 rag-queries 와 동일 — 서버 모듈은 클라이언트 import 금지라 복제) ──

export interface BriefingReport {
  kpis: Array<{ label: string; value: string; sub: string | null }>;
  trends: string[];
  companies: Array<{
    name: string;
    region: string | null;
    status: string | null;
    project: string | null;
    desc: string;
    facts: Array<{ label: string; value: string }>;
    note: { kind: string; text: string } | null;
  }>;
  etcNote: string | null;
  insights: Array<{ badge: string; text: string }>;
}

export interface BriefingSource {
  signalId: string;
  score: number | null;
  source: string;
  companyName: string | null;
  reportName: string | null;
  disclosedAt: string | null;
  facilityName: string | null;
  url: string | null;
}

export interface Briefing {
  briefingId: string;
  question: string;
  answerMd: string | null;
  report: BriefingReport | null;
  sources: BriefingSource[];
  filters: { source?: string; grade?: string; from?: string; to?: string };
  model: string | null;
  createdAt: string;
}

/** 소스 탭 — gosi 는 채널로 분리(토지이음/유역청). key 는 API source 파라미터와 동일. */
export const SOURCE_TABS = [
  { key: "", label: "전체" },
  { key: "dart", label: "DART" },
  { key: "eiass", label: "EIASS" },
  { key: "press", label: "보도자료" },
  { key: "news", label: "NAVER" },
  { key: "gosi_eum", label: "토지이음" },
  { key: "gosi_me", label: "유역청" },
] as const;

export const STAT_SOURCE_LABELS: Record<string, string> = {
  dart: "DART",
  eiass: "EIASS",
  press: "보도자료",
  news: "NAVER",
  gosi_eum: "토지이음",
  gosi_me: "유역청",
};

/** DB source 값 → 표시 라벨(gosi 채널 미구분 컨텍스트용). */
export const SOURCE_LABEL: Record<string, string> = {
  dart: "DART",
  news: "NAVER",
  eiass: "EIASS",
  press: "보도자료",
  gosi: "고시",
};

export const TYPE_PILL: Record<string, string> = {
  investment: "cd-pill-info",
  expansion: "cd-pill-warn",
  new_site: "cd-pill-success",
  other: "cd-pill-idle",
};
export const STATUS_LABEL: Record<string, string> = { new: "신규", reviewed: "검토", converted: "전환", dismissed: "무시" };
export const STATUS_PILL: Record<string, string> = {
  new: "cd-pill-info",
  reviewed: "cd-pill-idle",
  converted: "cd-pill-success",
  dismissed: "cd-pill-outline",
};
export const GRADE_PILL: Record<string, string> = {
  confirmed: "cd-pill-success",
  candidate: "cd-pill-info",
  monitoring: "cd-pill-warn",
  excluded: "cd-pill-outline",
};

export const MATCH_LABEL: Record<string, string> = { matched: "매칭", unmatched: "미매칭", ignored: "무시" };

// ── 업종 상관관계(별도 축 — 등급과 직교) ──

export const RELEVANCE_LABEL: Record<string, string> = {
  direct: "직접",
  supply_chain: "공급망",
  low: "낮음",
  none: "무관",
};
export const RELEVANCE_PILL: Record<string, string> = {
  direct: "cd-pill-success",
  supply_chain: "cd-pill-info",
  low: "cd-pill-idle",
  none: "cd-pill-outline",
};

/** 업종 id → 라벨(코드 상수 + 특수 키). 설정 추가 업종은 id=label 이라 그대로 표시. */
export const INDUSTRY_LABEL: Record<string, string> = {
  ...Object.fromEntries(INTEGRATED_PERMIT_INDUSTRIES.map((i) => [i.id, i.label])),
  "industrial-complex": "산업단지",
  other: "기타(대상)",
};

export function RelevanceTag({ relevance, note }: { relevance: string | null; note?: string | null }) {
  if (!relevance) return null;
  return (
    <span
      className={`cd-pill ${RELEVANCE_PILL[relevance] ?? "cd-pill-idle"}`}
      title={note ?? (relevance === "direct" ? "통합허가 대상 업종 직접 신호" : undefined)}
    >
      {RELEVANCE_LABEL[relevance] ?? relevance}
    </span>
  );
}

export function TypeTag({ type }: { type: string }) {
  return (
    <span className={`cd-pill ${TYPE_PILL[type] ?? "cd-pill-idle"}`}>
      {INTEL_SIGNAL_TYPE_LABELS[type as keyof typeof INTEL_SIGNAL_TYPE_LABELS] ?? type}
    </span>
  );
}
export function GradeTag({ grade }: { grade: string }) {
  return (
    <span className={`cd-pill ${GRADE_PILL[grade] ?? "cd-pill-idle"}`}>
      {INTEL_SIGNAL_GRADE_LABELS[grade as keyof typeof INTEL_SIGNAL_GRADE_LABELS] ?? grade}
    </span>
  );
}
// 2차 매칭(공시자≠대상, 발주처=대상)임을 표시. direct는 배지 없음.
export function MatchTypeTag({ type }: { type: string }) {
  if (type !== "counterparty") return null;
  return (
    <span className="cd-pill cd-pill-outline" title="공시자가 아닌 거래상대방(발주처)이 통합허가 대상">
      거래상대
    </span>
  );
}
