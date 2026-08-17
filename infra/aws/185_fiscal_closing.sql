-- 185_fiscal_closing.sql
-- 회계 확충 P9: 결산·법인세 준비 — 연차 마감 스냅 + 기초 잔액 인수 + 법인세 파라미터 시드
-- 블루프린트: docs/accounting-expansion-blueprint.md §5 P9
-- 원칙: 마감 = 전표 재생성 잠금 + 재무제표 스냅 보존(재생성 원칙과의 경계). 기초 잔액은
--   세무법인 전기 재무상태표에서 인수(앱 전표는 2026 발생분부터라 기초 없이는 재무상태표 불완전).
-- 멱등: CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING

-- ─────────────────────────────────────────────
-- 1. 연차 마감 — closed 연도는 전표 재생성 거부(regenerateJournal 가드)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fiscal_closings (
  closing_id   text PRIMARY KEY,          -- 'fc-' + 연도 해시
  fiscal_year  integer NOT NULL UNIQUE,
  status       text NOT NULL DEFAULT 'draft',  -- draft / closed
  snapshot     jsonb,                     -- 마감 시점 시산·손익·재무상태표 스냅(감사 추적)
  memo         text,
  closed_by    text,
  closed_at    text,
  created_at   text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at   text
);

-- ─────────────────────────────────────────────
-- 2. 기초 잔액 (연도 1/1 시점, 차변+ 규약 — 대변 잔액 계정은 음수)
--    세무법인 전기 재무상태표 인수용. 화면(결산 탭)에서 입력·수정.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS opening_balances (
  ob_id        text PRIMARY KEY,          -- 'ob-' + (연도:계정) 해시
  fiscal_year  integer NOT NULL,
  account_code text NOT NULL REFERENCES journal_accounts(account_code),
  amount       bigint NOT NULL,           -- 차변+ / 대변-
  memo         text,
  created_at   text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at   text,
  UNIQUE (fiscal_year, account_code)
);

-- ─────────────────────────────────────────────
-- 3. 법인세 파라미터 시드 (§7 T4) — 세무조정 후보 감지 기준
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS corp_tax_params (
  fiscal_year integer PRIMARY KEY,
  params      jsonb NOT NULL,
  created_at  text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')
);

INSERT INTO corp_tax_params (fiscal_year, params) VALUES
(2026, '{
  "entertainmentBaseLimit": 36000000,
  "entertainmentRevenueRate": 0.003,
  "congratulationCashLimit": 200000,
  "receiptEvidenceFloor": 30000
}'::jsonb)
ON CONFLICT (fiscal_year) DO NOTHING;
