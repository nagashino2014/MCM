-- mail-com-cutover-readiness.sql — koensain.com MX 전환(아마란스 → SES) 직전 점검. 읽기 전용(쓰기 없음).
-- 실행: PGOPTIONS='-c default_transaction_read_only=on' psql -X -f infra/aws/ops/mail-com-cutover-readiness.sql
-- 해석 규칙은 lib/mail/inbound.ts resolveRecipients 와 같다:
--   ① 주소 원장(mailbox_addresses)·mailboxes.address → ② 메일함 local_part → ③ users.email_local(수신 시 메일함 자동 생성)
--   → ④ 별칭(mail_aliases). 넷 다 없으면 MX 전환 뒤 그 주소로 온 메일은 배달되지 않는다(S3 원문만 90일 남음).
-- 절차: docs/koensain-com-mx-cutover.md §2.

-- 1) 지금까지 메일에 나온 koensain.com 주소(아마란스 백업 가져오기·사내 메일)가 전환 뒤 어디로 배달되는가.
WITH seen AS (
  SELECT lower(x->>'address') AS address, count(*) AS n, max(left(coalesce(m.received_at, m.sent_at, m.created_at), 10)) AS last_day
    FROM mail_messages m,
         LATERAL jsonb_array_elements(m.to_addrs || m.cc_addrs) x
   WHERE lower(x->>'address') LIKE '%@koensain.com'
   GROUP BY 1
), res AS (
  SELECT s.address, s.n, s.last_day, split_part(s.address, '@', 1) AS local_part,
         (SELECT ma.mailbox_id FROM mailbox_addresses ma WHERE ma.address = s.address
           UNION SELECT mb.mailbox_id FROM mailboxes mb WHERE lower(mb.address) = s.address LIMIT 1) AS by_ledger,
         (SELECT mb.mailbox_id FROM mailboxes mb WHERE mb.local_part = split_part(s.address, '@', 1) AND mb.status = 'active' LIMIT 1) AS by_local,
         (SELECT u.user_id FROM users u WHERE lower(coalesce(u.email_local, '')) = split_part(s.address, '@', 1) AND u.status = 'active' LIMIT 1) AS by_user,
         (SELECT a.alias_id FROM mail_aliases a WHERE a.alias_local = split_part(s.address, '@', 1) AND a.active = 1 LIMIT 1) AS by_alias
    FROM seen s
)
SELECT address, n AS mails, last_day,
       CASE WHEN by_ledger IS NOT NULL THEN '원장'
            WHEN by_local IS NOT NULL THEN '메일함 앞자리'
            WHEN by_user IS NOT NULL THEN '직원 앞자리(자동 생성)'
            WHEN by_alias IS NOT NULL THEN '별칭'
            ELSE '⚠ 배달 불가' END AS route
  FROM res
 ORDER BY (by_ledger IS NULL AND by_local IS NULL AND by_user IS NULL AND by_alias IS NULL) DESC, n DESC, address;

-- 2) 재직 직원 중 메일 주소가 될 앞자리(email_local)가 없는 사람 — 전환 뒤 .com 메일을 받을 길이 없다.
SELECT u.user_id, u.name, u.email
  FROM users u
 WHERE u.status = 'active' AND coalesce(trim(u.email_local), '') = ''
 ORDER BY u.name;

-- 3) 아마란스 백업 가져오기 현황(사람별) — 해지 전에 받은·보낸 메일함을 모두 가져왔는지 본다.
SELECT u.name, mb.address,
       count(j.job_id) FILTER (WHERE j.source_label LIKE '%아마란스%' AND j.status = 'done') AS amaranth_jobs,
       max(left(j.finished_at, 10)) FILTER (WHERE j.source_label LIKE '%아마란스%' AND j.status = 'done') AS last_import,
       coalesce(sum(j.imported_count) FILTER (WHERE j.source_label LIKE '%아마란스%' AND j.status = 'done'), 0) AS imported
  FROM users u
  LEFT JOIN mailboxes mb ON mb.user_id = u.user_id
  LEFT JOIN mail_import_jobs j ON j.user_id = u.user_id
 WHERE u.status = 'active'
 GROUP BY u.name, mb.address
 ORDER BY amaranth_jobs, u.name;

-- 4) 도메인 수신 모드(전환 전 koensain.com = external, 338 적용 후 ses).
SELECT domain, inbound_mode, send_enabled, note FROM mail_domains ORDER BY domain;
