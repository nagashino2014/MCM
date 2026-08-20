-- 197: 법인카드 전자 전표(PDF) 사전 생성 (사용자 확정 2026-08-20).
-- 배경: 지출결의서·출장보고서에 법인카드 건을 담을 때 증빙(매출전표)을 그 자리에서 만들면
--       작성이 수 초씩 멈춘다. 바로빌 매입내역 수집 후 야간 배치가 전표를 미리 만들어 두고,
--       기안 화면은 이미 만들어진 PDF 를 첨부만 한다(개인 영수증의 pdf_key 와 같은 규약).
-- slip_key = 스토리지 key(첨부 file_attachments 의 key 로 그대로 쓴다), slip_at = 생성 시각(KST).
-- 재생성이 필요하면 slip_key 를 NULL 로 지우면 다음 배치가 다시 만든다.
-- 멱등: ADD COLUMN IF NOT EXISTS

ALTER TABLE card_transactions ADD COLUMN IF NOT EXISTS slip_key text;
ALTER TABLE card_transactions ADD COLUMN IF NOT EXISTS slip_at  text;

-- 배치가 매번 "전표 없는 승인 건"을 훑는다 — 미생성 건만 남는 부분 인덱스.
CREATE INDEX IF NOT EXISTS idx_card_txn_slip_pending
  ON card_transactions (approved_at DESC)
  WHERE slip_key IS NULL AND approval_type = '승인';

-- 배치 실행 이력(일 1회 멱등 판정 + 운영 확인용) — file_retention_runs 와 같은 형식.
CREATE TABLE IF NOT EXISTS card_slip_runs (
  run_id     bigserial PRIMARY KEY,
  ran_at     text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  created    integer NOT NULL DEFAULT 0,   -- 생성한 전표 수
  failed     integer NOT NULL DEFAULT 0,   -- 실패 건수(다음 회차에 재시도)
  note       text
);
