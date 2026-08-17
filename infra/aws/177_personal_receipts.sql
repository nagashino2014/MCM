-- 177: 개인카드 영수증 스톡 (블루프린트: docs/accounting-expansion-blueprint.md §2, P1)
-- 자동 수집이 안 되는 개인카드 지출의 지류 영수증을 촬영 → Claude vision 파싱 → 스톡해 두었다가
-- 지출결의서·출장보고서 기안 시 불러와 표에 자동 기입한다(법인카드 card_transactions의 doc_id 귀속 규약과 동일).
-- 이미지 원본(JPEG)과 증빙 PDF(pdf-lib 임베드)는 계약문서 스토리지(receipts/ 프리픽스)에 저장 —
-- PDF 키는 결재 첨부(field_values.file_attachments)로 그대로 실려 결재자가 뷰어에서 원본을 확인한다.
-- 환급 정산은 급여 합산 금지·별도 이체(사용자 확정 2026-08-16 — 급여성 지급 간주 시 소득세 증가).

CREATE TABLE IF NOT EXISTS personal_receipts (
  receipt_id     text PRIMARY KEY,                  -- 'rcp-' + sha256 12자리
  owner_user_id  text NOT NULL,                     -- 촬영자(users.id) — 본인 것만 조회·사용
  paid_at        text,                              -- 거래일시 YYYY-MM-DD HH:MI (파싱값, 수정 가능)
  store_name     text,
  store_corp_num text,                              -- 사업자번호(파싱 시) — 자동분류 입력
  total_amount   numeric NOT NULL DEFAULT 0,
  supply_amount  numeric,
  tax_amount     numeric,
  card_last4     text,                              -- 카드번호 끝 4자리
  approval_num   text,                              -- 승인번호 — 중복 감지 보조
  items_json     jsonb,                             -- 품목 요약(상위 몇 개)
  parsed_json    jsonb,                             -- LLM 파싱 원본(감사·재파싱용)
  category_key   text,                              -- expense_categories 프리셋(자동분류)
  category_source text,                             -- store_rule/learned/keyword/rule/manual
  image_key      text NOT NULL,                     -- 스토리지 키(정규화 JPEG 원본)
  pdf_key        text NOT NULL,                     -- 스토리지 키(증빙 PDF)
  doc_id         text,                              -- 귀속 결재문서(null = 미사용) — card_transactions 규약과 동일
  doc_form_id    text,
  excluded       integer NOT NULL DEFAULT 0,        -- 개인용/오촬영 제외 표시
  memo           text,
  created_at     text NOT NULL,
  updated_at     text
);

CREATE INDEX IF NOT EXISTS idx_personal_receipts_owner ON personal_receipts(owner_user_id, paid_at);
CREATE INDEX IF NOT EXISTS idx_personal_receipts_doc ON personal_receipts(doc_id);
