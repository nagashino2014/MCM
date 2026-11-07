-- 338_mail_com_inbound_ses.sql
-- koensain.com 수신 2단계 — MX 를 아마란스에서 SES 로 옮긴 뒤 inbound_mode 를 'ses' 로 바꾼다(2026-11-04 사용자 결정, 아마란스 해지).
-- ⚠ 적용 시점: Wix 에서 koensain.com MX 를 inbound-smtp.ap-northeast-2.amazonaws.com 으로 바꾼 "직후"에 적용한다.
--   먼저 적용하면 앱에서 동료 .com 주소로 보낸 메일이 사내 단락(.app 봉투)을 거치지 않고 아마란스로 간다.
--   늦게 적용해도 수신은 빠지지 않는다(inbound.ts 가 등록 도메인 전체를 로컬파트로 해석). 단락만 늦게 바뀐다.
-- 되돌리기: UPDATE mail_domains SET inbound_mode = 'external' WHERE domain = 'koensain.com' (MX 를 되돌릴 때 함께).
-- 절차: docs/koensain-com-mx-cutover.md. 관례: 멱등. GRANT 없음(265 default privileges).

UPDATE mail_domains
   SET inbound_mode = 'ses',
       note = 'MX=SES(2단계, 아마란스 해지) — 338',
       updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE domain = 'koensain.com'
   AND inbound_mode <> 'ses';

-- 검증: koensain.com 행이 있고 ses 여야 한다(280 미적용 환경이면 설치를 멈춘다).
DO $$
DECLARE
  mode text;
BEGIN
  SELECT inbound_mode INTO mode FROM mail_domains WHERE domain = 'koensain.com';
  IF mode IS NULL THEN
    RAISE EXCEPTION '338: mail_domains 에 koensain.com 이 없습니다 — 280 적용 여부를 확인하세요.';
  END IF;
  IF mode <> 'ses' THEN
    RAISE EXCEPTION '338: koensain.com inbound_mode = % (ses 여야 함)', mode;
  END IF;
END $$;
