-- 339_mail_com_amaranth_addresses.sql
-- koensain.com MX 전환(아마란스 해지) 준비 — 아마란스 주소가 앱 대표 주소와 다른 재직자의 옛 주소를 원장(mailbox_addresses)에 보조 주소로 더한다.
-- 근거(2026-11-04 스테이징 읽기 전용 조회, ops/mail-com-cutover-readiness.sql): 아마란스 백업으로 가져온 메일의 받는 사람
--   표시 이름(이름/직급/부서)과 앱 대표 주소를 대조했다. 설계안의 ".com 앞자리 = 앱 이메일 앞자리" 가정이 아래 사람들에게는 맞지 않아
--   이 행이 없으면 MX 전환 뒤 옛 주소로 온 메일이 배달되지 않는다.
-- 대표(발신) 주소는 바꾸지 않는다(is_primary=0). 메일함이 없거나(미사용) 주소를 이미 다른 메일함이 쓰면 건너뛴다.
-- 메일함은 대표 주소가 아니라 원장(mailbox_addresses)·mailboxes.address 어느 쪽에든 있는 주소로 찾는다 — 적용 전에 관리 화면에서
--   대표를 바꿔도(예: 이홍길 shied202001 → shield202001, 앱 쪽 오타로 2026-11-05 사용자 확인) 같은 메일함을 찾고 검증을 통과한다.
-- MX 전환 전에 적용하면 달라지는 것: 앱에서 이 옛 주소로 보낸 메일이 아마란스 대신 그 사람의 앱 메일함으로 간다(대표 주소와 같은 사내 단락).
-- 선행: 280. 관례: 멱등. GRANT 없음(265 default privileges). 절차: docs/koensain-com-mx-cutover.md.

WITH map(old_address, primary_address) AS (
  VALUES
    ('haewon@koensain.com',       'ssss8008@koensain.com'),
    ('19940807@koensain.com',     'ssss8008@koensain.com'),
    ('onemost@koensain.com',      'onemost8260@koensain.com'),
    ('shield202001@koensain.com', 'shied202001@koensain.com'),
    ('kojok56@koensain.com',      'kojok5586@koensain.com'),
    ('puresnow28@koensain.com',   'puresnow_28@koensain.com'),
    ('chookhwan@koensain.com',    'chosun21@koensain.com'),
    ('19890708@koensain.com',     'sangsoon07@koensain.com'),
    ('19910531@koensain.com',     'ccb0531@koensain.com'),
    ('19920804@koensain.com',     'mato5543@koensain.com'),
    ('19941204@koensain.com',     'xogjs1123@koensain.com'),
    ('19930227@koensain.com',     'qldkbia310@koensain.com'),
    ('19910512@koensain.com',     'kesimnmk@koensain.com'),
    ('19540917@koensain.com',     'yeok2011dc@koensain.com')
)
INSERT INTO mailbox_addresses (address, mailbox_id, domain, local_part, is_primary, source, created_at)
SELECT m.old_address, mb.mailbox_id, 'koensain.com', split_part(m.old_address, '@', 1), 0, 'manual',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM map m
  JOIN mailboxes mb ON mb.mailbox_id = (
         SELECT x.mailbox_id FROM (
           SELECT ma.mailbox_id FROM mailbox_addresses ma WHERE ma.address = m.primary_address
           UNION SELECT b.mailbox_id FROM mailboxes b WHERE lower(b.address) = m.primary_address
         ) x LIMIT 1)
 WHERE EXISTS (SELECT 1 FROM mail_domains d WHERE d.domain = 'koensain.com')
   AND NOT EXISTS (SELECT 1 FROM mailboxes o WHERE lower(o.address) = m.old_address)
ON CONFLICT (address) DO NOTHING;

-- 검증: 옮겨 적은 옛 주소가 짝지은 주소의 메일함이 아닌 다른 메일함에 붙어 있으면 설치를 멈춘다(대표 주소 불변식은 건드리지 않음).
DO $$
DECLARE
  bad integer;
BEGIN
  SELECT count(*) INTO bad
    FROM mailbox_addresses ma
    JOIN (VALUES
      ('haewon@koensain.com', 'ssss8008@koensain.com'), ('19940807@koensain.com', 'ssss8008@koensain.com'),
      ('onemost@koensain.com', 'onemost8260@koensain.com'), ('shield202001@koensain.com', 'shied202001@koensain.com'),
      ('kojok56@koensain.com', 'kojok5586@koensain.com'), ('puresnow28@koensain.com', 'puresnow_28@koensain.com'),
      ('chookhwan@koensain.com', 'chosun21@koensain.com'), ('19890708@koensain.com', 'sangsoon07@koensain.com'),
      ('19910531@koensain.com', 'ccb0531@koensain.com'), ('19920804@koensain.com', 'mato5543@koensain.com'),
      ('19941204@koensain.com', 'xogjs1123@koensain.com'), ('19930227@koensain.com', 'qldkbia310@koensain.com'),
      ('19910512@koensain.com', 'kesimnmk@koensain.com'), ('19540917@koensain.com', 'yeok2011dc@koensain.com')
    ) AS m(old_address, primary_address) ON m.old_address = ma.address
   WHERE NOT EXISTS (SELECT 1 FROM mailbox_addresses p WHERE p.address = m.primary_address AND p.mailbox_id = ma.mailbox_id)
     AND NOT EXISTS (SELECT 1 FROM mailboxes b WHERE lower(b.address) = m.primary_address AND b.mailbox_id = ma.mailbox_id);
  IF bad > 0 THEN
    RAISE EXCEPTION '339: 옛 아마란스 주소 %건이 다른 메일함에 붙어 있습니다 — mailbox_addresses 를 확인하세요.', bad;
  END IF;
END $$;
