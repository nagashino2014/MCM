-- 280: 메일 다중 도메인(koensain.com 1단계) — 2026-10-15 사용자 요청
-- .app 발신이 발주처 그룹웨어·전자조달에서 차단돼 koensain.com 으로 발신을 옮긴다. MX 는 아마란스 유지.
-- 메일함 하나가 여러 주소(.app 수신 + .com 발신)를 갖도록 주소 원장을 둔다.
-- mailboxes.address 는 "대표(발신) 주소 캐시"로 유지 — 대표 주소 전환 시 lib/mail/mailbox.ts setPrimaryAddress 가 함께 갱신.
-- 설계: docs/company-email-com-domain-phase1.md §3.
-- 관례: 멱등(IF NOT EXISTS·ON CONFLICT DO NOTHING). GRANT 없음(265 default privileges).

-- 메일 도메인 — inbound_mode: ses = MX 가 SES(앱이 직접 수신) / external = 외부 MX(아마란스 등).
-- send_enabled = SES identity·DKIM 검증 후 관리자가 1 로 켠다(꺼져 있으면 해당 도메인 발신은 오류로 멈춤).
CREATE TABLE IF NOT EXISTS mail_domains (
  domain        text PRIMARY KEY,
  inbound_mode  text NOT NULL CHECK (inbound_mode IN ('ses', 'external')),
  send_enabled  integer NOT NULL DEFAULT 0,
  note          text,
  created_at    text NOT NULL,
  updated_at    text NOT NULL
);

-- 메일함 주소 원장 — address 는 소문자 전체 주소. is_primary = 발신 대표 주소(메일함당 1개).
CREATE TABLE IF NOT EXISTS mailbox_addresses (
  address     text PRIMARY KEY,
  mailbox_id  text NOT NULL REFERENCES mailboxes(mailbox_id) ON DELETE CASCADE,
  domain      text NOT NULL REFERENCES mail_domains(domain),
  local_part  text NOT NULL,
  is_primary  integer NOT NULL DEFAULT 0,
  source      text NOT NULL DEFAULT 'legacy' CHECK (source IN ('legacy', 'auto', 'manual')),
  created_at  text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_addresses_primary ON mailbox_addresses(mailbox_id) WHERE is_primary = 1;
CREATE INDEX IF NOT EXISTS idx_mailbox_addresses_mailbox ON mailbox_addresses(mailbox_id);

-- 도메인 시드: .app 은 현행(SES 수신·발신), .com 은 발신 꺼진 상태로 시작.
INSERT INTO mail_domains (domain, inbound_mode, send_enabled, note, created_at, updated_at)
VALUES
  ('koensain.app', 'ses', 1, '앱 기본 도메인 — MX=SES', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')),
  ('koensain.com', 'external', 0, '아마란스 MX 유지, SES 발신만(1단계)', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
ON CONFLICT (domain) DO NOTHING;

-- 기존 메일함 주소의 도메인이 시드에 없으면(MAIL_DOMAIN 을 바꿔 운영한 이력 등) 그 도메인을 ses 로 보강.
INSERT INTO mail_domains (domain, inbound_mode, send_enabled, note, created_at, updated_at)
SELECT DISTINCT lower(split_part(mb.address, '@', 2)), 'ses', 1, '280 백필 — 기존 메일함 도메인',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM mailboxes mb
 WHERE position('@' IN mb.address) > 0
ON CONFLICT (domain) DO NOTHING;

-- 기존 메일함 주소 → 대표 주소로 백필.
INSERT INTO mailbox_addresses (address, mailbox_id, domain, local_part, is_primary, source, created_at)
SELECT lower(mb.address), mb.mailbox_id, lower(split_part(mb.address, '@', 2)), lower(split_part(mb.address, '@', 1)), 1, 'legacy',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM mailboxes mb
 WHERE position('@' IN mb.address) > 0
ON CONFLICT (address) DO NOTHING;

-- 검증: 대표 주소 불변식(mailboxes.address = 원장 대표 주소). 어긋나면 설치를 멈춘다.
DO $$
DECLARE
  bad integer;
BEGIN
  SELECT count(*) INTO bad
    FROM mailboxes mb
    LEFT JOIN mailbox_addresses ma ON ma.mailbox_id = mb.mailbox_id AND ma.is_primary = 1
   WHERE position('@' IN mb.address) > 0
     AND (ma.address IS NULL OR ma.address <> lower(mb.address));
  IF bad > 0 THEN
    RAISE EXCEPTION '280: 대표 주소 백필 불일치 %건 — mailboxes.address 와 mailbox_addresses 를 확인하세요.', bad;
  END IF;
END $$;
