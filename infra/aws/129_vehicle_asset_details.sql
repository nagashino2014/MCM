-- 129: 법인차량 자산 상세 관리(사용자 요구 — 자산 관리 화면 개편).
-- reservable_assets 에 차량 전용 컬럼 추가: 차량번호·소유 유형(장기 렌트/법인 소유/리스)·
-- 소유자·취득(계약)일·계약기간(개월)·반납(매각)일·취득 가격·렌트(리스)료 + 계약서/등록증 PDF(S3 키).
-- name 컬럼은 차량의 경우 '차종'으로 쓰인다(기존 값 니로/K8 그대로 — 리네임 없음,
-- 출장 문서 이름 기반 매칭(lib/assets/usage.ts) 보호). 회의실·기타 자산은 전부 NULL.
-- ownership: rent(장기 렌트) | owned(법인 소유) | lease(리스) — 검증은 앱 계층.
-- 멱등: ADD COLUMN IF NOT EXISTS.

ALTER TABLE reservable_assets ADD COLUMN IF NOT EXISTS plate_no text;
ALTER TABLE reservable_assets ADD COLUMN IF NOT EXISTS ownership text;
ALTER TABLE reservable_assets ADD COLUMN IF NOT EXISTS owner_name text;
ALTER TABLE reservable_assets ADD COLUMN IF NOT EXISTS acquired_at text;
ALTER TABLE reservable_assets ADD COLUMN IF NOT EXISTS contract_months integer;
ALTER TABLE reservable_assets ADD COLUMN IF NOT EXISTS returned_at text;
ALTER TABLE reservable_assets ADD COLUMN IF NOT EXISTS acquisition_price bigint;
ALTER TABLE reservable_assets ADD COLUMN IF NOT EXISTS monthly_fee bigint;
ALTER TABLE reservable_assets ADD COLUMN IF NOT EXISTS contract_doc_key text;
ALTER TABLE reservable_assets ADD COLUMN IF NOT EXISTS contract_doc_name text;
ALTER TABLE reservable_assets ADD COLUMN IF NOT EXISTS registration_doc_key text;
ALTER TABLE reservable_assets ADD COLUMN IF NOT EXISTS registration_doc_name text;
