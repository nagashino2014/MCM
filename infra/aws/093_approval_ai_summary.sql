-- 093: 결재자 AI 요약(AX-P2) — 상신 시 생성해 저장하는 파생 데이터.
-- 구조: { lines:[3줄], figures:[{label,value}], precedent, model, generatedAt }.
-- 원본 field_values 와 분리(재생성 가능·원장 불변). 설계: §9-3.

ALTER TABLE approval_docs ADD COLUMN IF NOT EXISTS ai_summary jsonb;
