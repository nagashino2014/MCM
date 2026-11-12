-- 366_mail_send_individual.sql
-- 코넨사인 메일 — 개인별 보내기(2026-11-12 직원 요청 2). 받는 사람마다 따로 발송해 각자 자기 주소만 받는 사람 칸에 보이는 방식.
-- 보낸메일함에는 한 건으로 남기고(받는 사람 전원 = to_addrs), 이 열로 "개인별로 보냈음"을 표시한다.
--   · 뷰어가 받는 사람 줄에 "개인별" 표시를 붙이고, [다시보내기]가 같은 방식으로 메일 쓰기를 연다.
--   · 수신 확인(mail_receipts)은 종전처럼 수신자별 추적 픽셀이라 바뀌지 않는다.
-- 앱은 이 열이 없어도 발송·조회가 실패하지 않게 짰다(발송 후 별도 UPDATE·조회는 실패 시 무시) — 적용 순서 제약 없음.
-- 상수 기본값 ADD COLUMN 은 표를 다시 쓰지 않는다(PG11+ 메타데이터 변경). 멱등. GRANT 없음(265 default privileges).

SET lock_timeout = '5s';

ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS send_individual smallint NOT NULL DEFAULT 0;  -- 1 = 개인별 보내기로 발송
