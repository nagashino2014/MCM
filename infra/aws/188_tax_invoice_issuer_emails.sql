-- 188_tax_invoice_issuer_emails.sql
-- 전자세금계산서 발행 담당자 이메일 목록(사용자 확정 2026-08-18):
--   지금은 env BAROBILL_INVOICER_EMAIL 하나뿐이라 다른 주소로 보내려면 매번 손으로 고쳐야 했다.
--   자주 쓰는 주소를 저장해 두고 발행 모달에서 골라 쓰도록 목록을 둔다.
--   env 값은 여전히 기본값(폴백)이며, 이 표는 그 위에 얹는 선택지다.
-- 멱등: CREATE TABLE IF NOT EXISTS

CREATE TABLE IF NOT EXISTS tax_invoice_issuer_emails (
  email      text PRIMARY KEY,
  label      text,                                   -- 표시용 메모(담당자명 등, 선택)
  created_by text,
  created_at text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  used_at    text                                    -- 마지막으로 발행에 쓴 시각(최근순 정렬용)
);
