-- 332_purchase_finance_fk_drop.sql
-- 331 의 재무 감시 표 참조 외래키 2개 제거(2026-11-03 장애 수정).
--   purchase_contract_milestones.hometax_hti_id → 홈택스 세금계산서 표
--   purchase_contracts.account_code            → 계정과목 표
--   외래키는 참조되는 쪽 표에 내부 RI 트리거 2개를 만든다. 두 표는 재무 설치 지문(r1_installation_catalog 가
--   내부 트리거까지 비교)의 구조 감시 표라 지문이 어긋났다.
--   · 홈택스 표 → vat-use 설치 검사 불일치. 감시 표 22개의 쓰기 트리거가 모두 실패 — 바로빌 계좌·카드 수집,
--     카드 원장 지출 분류, 세금계산서·홈택스·대사 연결 저장 등.
--   · 계정과목 표 → journal-use 설치 검사 불일치. /api/finance/journal-use 실패.
--   연결 검증은 앱이 한다 — milestones PATCH(계산서 존재·direction='purchase'·중복 연결),
--   purchase-contracts POST/PATCH(계정과목 존재). 열과 기존 값은 그대로 둔다.
--   제약 이름은 스테이징 실측(PostgreSQL 기본 이름). 동적 SQL 을 쓰지 않는다 — 적용 스크립트의 회계 보호 검사 대상.
-- 멱등: IF EXISTS.

ALTER TABLE IF EXISTS purchase_contract_milestones DROP CONSTRAINT IF EXISTS purchase_contract_milestones_hometax_hti_id_fkey;
ALTER TABLE IF EXISTS purchase_contracts DROP CONSTRAINT IF EXISTS purchase_contracts_account_code_fkey;
