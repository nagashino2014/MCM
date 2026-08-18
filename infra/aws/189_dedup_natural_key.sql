-- 189_dedup_natural_key.sql
-- 계좌·카드 원장 중복 정리 + dedup_key 를 자연키로 전환 (원인 실측 2026-08-18)
--
-- [원인]
--   바로빌 TransRefKey / HistoryKey 는 "거래일시(14자리) + 바로빌 내부 시퀀스(10자리)" 형태인데,
--   이 시퀀스가 재수집마다 새로 매겨진다. 같은 거래를 두 번 수집하면 값이 달라진다.
--     2026-08-10 20:19:43 국민연금 1,574,170 → 08-15 수집 ...0022960011 / 08-17 수집 ...0022964061
--   170 스키마는 이 값을 영속 고유키로 보고 dedup_key = 계좌번호:TransRefKey 로 잡았기 때문에,
--   기간을 바꿔 재수집할 때마다 전량 "신규"로 적재됐다(08-17 수집 로그 inserted 246/67/188).
--   실측: 계좌 중복 313그룹 전부, 카드 중복 220그룹 중 218이 서로 다른 수집 회차 조합.
--
-- [정리 기준]
--   계좌 = 계좌 + 거래일시(초) + 입출금 + 금액 + 거래후잔액.
--          잔액까지 같으면 물리적으로 같은 거래다(진짜 2건이면 잔액이 달라진다).
--          → 우리 계좌 간 법인잔고 이전처럼 계좌가 다른 건은 애초에 그룹이 갈려 영향 없음.
--   카드 = 카드 + 승인일시 + 승인번호 + 승인금액. 취소 건은 금액 부호가 달라 승인 건과 구분된다.
--   남기는 행 = created_at 이 가장 이른 행(최초 적재분). 대사(recon_matches)는 남는 행으로 재매핑한다.
--
-- 멱등: 백업 테이블은 IF NOT EXISTS, 삭제·재작성은 조건이 남아 있을 때만 동작.

-- ── 1) 삭제 대상 백업 (되돌릴 수 있게 원본 그대로 보관) ─────────────────────────
CREATE TABLE IF NOT EXISTS bank_transactions_dup_backup_189 (LIKE bank_transactions);
CREATE TABLE IF NOT EXISTS card_transactions_dup_backup_189 (LIKE card_transactions);

WITH ranked AS (
  SELECT txn_id,
         row_number() OVER (
           PARTITION BY account_id, txn_at, direction, amount, coalesce(balance_after, -1)
           ORDER BY created_at, txn_id
         ) AS rn
    FROM bank_transactions
)
INSERT INTO bank_transactions_dup_backup_189
SELECT t.* FROM bank_transactions t JOIN ranked r ON r.txn_id = t.txn_id
 WHERE r.rn > 1
   AND NOT EXISTS (SELECT 1 FROM bank_transactions_dup_backup_189 b WHERE b.txn_id = t.txn_id);

WITH ranked AS (
  SELECT card_txn_id,
         row_number() OVER (
           PARTITION BY card_id, approved_at, coalesce(approval_num, ''), amount_total
           ORDER BY created_at, card_txn_id
         ) AS rn
    FROM card_transactions
)
INSERT INTO card_transactions_dup_backup_189
SELECT t.* FROM card_transactions t JOIN ranked r ON r.card_txn_id = t.card_txn_id
 WHERE r.rn > 1
   AND NOT EXISTS (SELECT 1 FROM card_transactions_dup_backup_189 b WHERE b.card_txn_id = t.card_txn_id);

-- ── 2) 대사 결과 재매핑 — 지울 행에 붙은 recon_matches 를 남길 행으로 옮긴다 ──────
--    (FK 가 ON DELETE CASCADE 라 그냥 지우면 확정한 수금 대사가 함께 사라진다)
WITH ranked AS (
  SELECT txn_id, account_id, txn_at, direction, amount, coalesce(balance_after, -1) AS bal,
         row_number() OVER (
           PARTITION BY account_id, txn_at, direction, amount, coalesce(balance_after, -1)
           ORDER BY created_at, txn_id
         ) AS rn
    FROM bank_transactions
), keep AS (
  SELECT account_id, txn_at, direction, amount, bal, txn_id AS keep_id FROM ranked WHERE rn = 1
), drop_rows AS (
  SELECT r.txn_id AS drop_id, k.keep_id
    FROM ranked r
    JOIN keep k ON (k.account_id, k.txn_at, k.direction, k.amount, k.bal)
                 = (r.account_id, r.txn_at, r.direction, r.amount, r.bal)
   WHERE r.rn > 1
)
UPDATE recon_matches m
   SET txn_id = d.keep_id
  FROM drop_rows d
 WHERE m.txn_id = d.drop_id
   -- 남길 행에 이미 같은 대사가 있으면 옮기지 않는다(중복 대사 방지 — 아래에서 함께 삭제된다)
   AND NOT EXISTS (
     SELECT 1 FROM recon_matches m2
      WHERE m2.txn_id = d.keep_id AND m2.match_type = m.match_type AND m2.status = m.status
   );

-- ── 3) 중복 행 삭제 ────────────────────────────────────────────────────────────
DELETE FROM bank_transactions t
 USING bank_transactions_dup_backup_189 b
 WHERE t.txn_id = b.txn_id;

DELETE FROM card_transactions t
 USING card_transactions_dup_backup_189 b
 WHERE t.card_txn_id = b.card_txn_id;

-- ── 4) dedup_key 를 자연키로 재작성 ────────────────────────────────────────────
--    앞으로는 재수집으로 TransRefKey/HistoryKey 가 바뀌어도 UNIQUE 제약이 중복 적재를 막는다.
--    (앱 코드도 같은 규칙으로 키를 만든다 — lib/barobill/sync.ts)
UPDATE bank_transactions t
   SET dedup_key = 'nk:' || a.account_no || ':' || t.txn_at || ':' || t.direction || ':' ||
                   trim(to_char(round(t.amount), 'FM9999999999999990')) || ':' ||
                   coalesce(trim(to_char(round(t.balance_after), 'FM9999999999999990')), 'x')
  FROM bank_accounts a
 WHERE a.account_id = t.account_id
   AND t.dedup_key NOT LIKE 'nk:%';

UPDATE card_transactions t
   SET dedup_key = 'nk:' || c.card_num || ':' || coalesce(t.approval_num, '') || ':' || t.approved_at || ':' ||
                   trim(to_char(round(t.amount_total), 'FM9999999999999990'))
  FROM card_registry c
 WHERE c.card_id = t.card_id
   AND t.dedup_key NOT LIKE 'nk:%';
