-- 186_card_expense_kind.sql
-- 법인카드 사용내역의 경비 성격 사후 지정 (분개장 구분 필터 보강, 사용자 확정 2026-08-18):
--   분개장 "구분" 태그의 출장경비(법인)/지출결의(법인)은 카드 건이 결재문서에 귀속되었을 때만
--   doc_form_id 로 갈린다. 실데이터는 대부분 미귀속이라 두 태그가 빈 목록이 되므로,
--   문서 없이도 카드 건에 성격을 직접 지정할 수 있는 열을 둔다.
--   판정 우선순위: doc_form_id(실제 결재문서 귀속) > expense_kind(수동 지정) > 미지정.
-- ⚠ 파생 상태는 원장(card_transactions) 위에 둔다 — journal_entries 는 재생성 때 다시 만들어지므로 값이 날아간다.
-- 멱등: ADD COLUMN IF NOT EXISTS

ALTER TABLE card_transactions ADD COLUMN IF NOT EXISTS expense_kind text;      -- trip / expense (null=미지정)
ALTER TABLE card_transactions ADD COLUMN IF NOT EXISTS expense_kind_by text;   -- 지정한 사용자
ALTER TABLE card_transactions ADD COLUMN IF NOT EXISTS expense_kind_at text;   -- 지정 시각(KST 문자열)

-- 미지정 건 조회(분개장 "미지정" 태그)가 잦아 부분 인덱스를 둔다.
CREATE INDEX IF NOT EXISTS idx_card_txn_expense_kind ON card_transactions (expense_kind) WHERE expense_kind IS NOT NULL;
