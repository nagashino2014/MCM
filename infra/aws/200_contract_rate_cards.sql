-- 200: 단가 계약 단가 기준표(2026-08-24 사용자 확정).
-- 배경: 계약 종류 '단가 계약'(contracts.contract_kind='unit_price')의 실체 기능이 없었다.
-- 발주처별 단가표(에이에스이코리아·삼성전기·해성디에스 실물 분석)는 양식이 제각각이지만
-- "지급 구분(그룹) > 항목 > 단위 > 단가 > 수량 > 비고" 행 목록으로 평탄화된다 →
-- 행 배열을 jsonb 통째로 저장(계약당 1행). 지급 구분명이 청구·수금 단계명 목록이 되고
-- 구분 소계가 단계 금액으로 자동 적용된다.
-- items 항목 형태: [{"id","groupName","name","unit","unitPrice","qty","note"}]
-- 관례: text 타임스탬프, 멱등(IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS contract_rate_cards (
  contract_id text PRIMARY KEY REFERENCES contracts(contract_id) ON DELETE CASCADE,
  items       jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at  text NOT NULL,
  updated_by  text
);
