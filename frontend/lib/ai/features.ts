/**
 * AI 기능 레지스트리 — Claude 호출 지점마다 고유 키를 부여해 사용량·비용을 기능 단위로 집계한다.
 * (docs/ai-api-usage-management-blueprint.md §4.1, P0)
 * - 키 형식: `<도메인>.<기능>[:<슬롯>]` — 같은 기능 안에서 모델이 갈리는 경로(고품질 재분석 등)는 슬롯으로 나눈다.
 * - defaultModel 은 코드 기본값. 실제 적용 모델은 호출부 인자 → (P1) 관리 화면 오버라이드 → 이 값 순으로 정한다.
 * - critical: 사용자 대면 경로(예산 초과 시 마지막까지 살려야 하는 기능). 비필수는 P2 예산 정책이 먼저 차단한다.
 */

export type AiFeatureGroup = "전자결재" | "업무보고" | "문서 파싱" | "양식 분석" | "영업 인텔" | "스크래퍼";

export interface AiFeatureDef {
  label: string;
  group: AiFeatureGroup;
  /** 사용자 대면 경로 여부 — 예산 정책의 차단 우선순위에 쓴다. */
  critical: boolean;
  /** 코드 기본 모델(정규형 ID, 날짜 접미사 없음). */
  defaultModel: string;
  /** 이미지·PDF 입력을 쓰는지 — 모델 변경 시 비전 지원 검사에 쓴다. */
  vision: boolean;
}

export const AI_FEATURES = {
  // 전자결재
  "approval.doc_summary": { label: "결재 문서 AI 요약", group: "전자결재", critical: true, defaultModel: "claude-haiku-4-5", vision: false },
  "approval.precheck": { label: "상신 전 AI 검토", group: "전자결재", critical: true, defaultModel: "claude-haiku-4-5", vision: false },
  "approval.analytics_ask": { label: "결재 데이터 질의(NLQ)", group: "전자결재", critical: false, defaultModel: "claude-haiku-4-5", vision: false },
  "approval.metrics_suggest": { label: "지표 정의 제안", group: "전자결재", critical: false, defaultModel: "claude-haiku-4-5", vision: false },
  // 업무보고
  "workplan.progress_summary": { label: "업무보고 추진내역 요약", group: "업무보고", critical: true, defaultModel: "claude-haiku-4-5", vision: false },
  // 문서·이미지 파싱
  "receipt.parse": { label: "영수증 파싱", group: "문서 파싱", critical: true, defaultModel: "claude-haiku-4-5", vision: true },
  "business_card.parse": { label: "명함 파싱", group: "문서 파싱", critical: true, defaultModel: "claude-haiku-4-5", vision: true },
  "business_certificate.parse": { label: "사업자등록증 파싱", group: "문서 파싱", critical: true, defaultModel: "claude-haiku-4-5", vision: true },
  "business_certificate.parse:high": { label: "사업자등록증 파싱(고품질 재분석)", group: "문서 파싱", critical: false, defaultModel: "claude-opus-4-8", vision: true },
  "yearend.pdf_parse": { label: "연말정산 간소화 PDF 파싱", group: "문서 파싱", critical: true, defaultModel: "claude-haiku-4-5", vision: true },
  "company.credential_parse": { label: "회사 면허·인증서 파싱", group: "문서 파싱", critical: false, defaultModel: "claude-sonnet-5", vision: true },
  "company.finance_parse:statement": { label: "회사 표준재무제표 파싱", group: "문서 파싱", critical: false, defaultModel: "claude-sonnet-5", vision: true },
  "company.finance_parse:credit": { label: "회사 신용평가등급 파싱", group: "문서 파싱", critical: false, defaultModel: "claude-haiku-4-5", vision: true },
  "contract.permit_review_parse": { label: "허가 검토결과서 파싱", group: "문서 파싱", critical: false, defaultModel: "claude-sonnet-5", vision: true },
  // 양식 분석
  "bid.form_analyze": { label: "입찰 서류 양식 분석", group: "양식 분석", critical: false, defaultModel: "claude-sonnet-5", vision: false },
  "deliverable.template_analyze": { label: "착수·준공계 양식 분석(HWPX)", group: "양식 분석", critical: false, defaultModel: "claude-sonnet-5", vision: false },
  "deliverable.template_scan": { label: "착수·준공계 양식 재구축(스캔 PDF)", group: "양식 분석", critical: false, defaultModel: "claude-sonnet-5", vision: true },
  "deliverable.template_scan:high": { label: "착수·준공계 양식 재구축(고품질)", group: "양식 분석", critical: false, defaultModel: "claude-opus-5", vision: true },
  "agreement.analyze:overlay": { label: "계약서 양식 분석(overlay)", group: "양식 분석", critical: false, defaultModel: "claude-sonnet-5", vision: false },
  "agreement.analyze:hwpx": { label: "계약서 양식 분석(조문 추출)", group: "양식 분석", critical: false, defaultModel: "claude-sonnet-5", vision: false },
  // 영업 인텔·RAG
  "intel.news_classify": { label: "뉴스·보도 발주신호 분류", group: "영업 인텔", critical: false, defaultModel: "claude-haiku-4-5", vision: false },
  "intel.eiass_classify": { label: "EIASS 협의건 판별", group: "영업 인텔", critical: false, defaultModel: "claude-haiku-4-5", vision: false },
  "intel.dart_supply_classify": { label: "DART 공급계약 발주처 분류", group: "영업 인텔", critical: false, defaultModel: "claude-haiku-4-5", vision: false },
  "intel.rag_briefing": { label: "AI 브리핑 생성", group: "영업 인텔", critical: false, defaultModel: "claude-sonnet-5", vision: false },
  "intel.rag_briefing:refine": { label: "AI 브리핑 추가 분석", group: "영업 인텔", critical: false, defaultModel: "claude-sonnet-5", vision: false },
  // 스크래퍼 소스 분석
  "scraper.analyze_source:profile": { label: "소스 분석 — API 프로필 생성", group: "스크래퍼", critical: false, defaultModel: "claude-sonnet-5", vision: false },
  "scraper.analyze_source:catalog": { label: "소스 분석 — 카탈로그 목록 추출", group: "스크래퍼", critical: false, defaultModel: "claude-sonnet-5", vision: false },
  "scraper.analyze_source:op_detail": { label: "소스 분석 — 오퍼레이션 상세 추출", group: "스크래퍼", critical: false, defaultModel: "claude-sonnet-5", vision: false },
  "scraper.analyze_source:build": { label: "소스 분석 — 카탈로그→프로필 구성", group: "스크래퍼", critical: false, defaultModel: "claude-sonnet-5", vision: false },
} as const satisfies Record<string, AiFeatureDef>;

export type AiFeatureKey = keyof typeof AI_FEATURES;

export function getAiFeature(key: AiFeatureKey): AiFeatureDef {
  return AI_FEATURES[key];
}

export function isAiFeatureKey(v: unknown): v is AiFeatureKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(AI_FEATURES, v);
}
