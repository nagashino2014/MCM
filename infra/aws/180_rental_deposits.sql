-- 180_rental_deposits.sql
-- 회계 확충 P5 보강: 간주임대료(임대 보증금 이자상당액) — 부가세 과세표준 가산
-- 근거: 2026 1기 확정 세무법인 부동산임대공급가액명세서 실측(2026-08-17 대사) —
--   간주임대료 = 보증금 × 과세기간 겹침일수 / 365(윤년 366) × 정기예금이자율(3.1%), 건별 원 미만 절사.
--   이자율은 국세청 고시로 개정되므로 DB 시드로 관리(§7 T4 — 코드 하드코딩 금지).
-- 멱등: CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING

-- 임대 보증금 (물건지·임차인별)
CREATE TABLE IF NOT EXISTS rental_deposits (
  deposit_id       text PRIMARY KEY,          -- 'rd-' + (물건지:임차인) 해시 앞 12자
  property_label   text NOT NULL,             -- 물건지 (예: 벽산디지털밸리5차 1201호)
  tenant_name      text NOT NULL,
  tenant_corp_num  text,
  deposit_amount   numeric NOT NULL,
  date_from        text NOT NULL,             -- 임대차 기간 시작 YYYY-MM-DD
  date_to          text,                      -- null = 계속 임대 중
  memo             text,
  is_active        integer NOT NULL DEFAULT 1,
  created_at       text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at       text
);

-- 연도별 정기예금이자율 고시 (기획재정부령 — 개정 시 다음 연도 행 추가)
CREATE TABLE IF NOT EXISTS vat_deposit_interest_rates (
  year  integer PRIMARY KEY,
  rate  numeric NOT NULL                      -- 예: 0.031 = 3.1%
);

INSERT INTO vat_deposit_interest_rates (year, rate) VALUES
  (2025, 0.031),
  (2026, 0.031)                               -- 2026 1기 확정 세무법인 명세서 역산 실측
ON CONFLICT (year) DO NOTHING;

-- 보증금 시드 — 2026 1기 확정 명세서 역산 실측(원 단위 정합 검증 완료).
-- ⚠ date_from 은 실제 임대차 계약 시작일이 미상이라 2026-01-01 로 두었다(올해 신고 계산에는 충분).
--    과거 기수 재계산이 필요하면 화면에서 실제 계약일로 수정할 것.
INSERT INTO rental_deposits (deposit_id, property_label, tenant_name, tenant_corp_num, deposit_amount, date_from, memo) VALUES
  ('rd-seed-altr01', '벽산디지털밸리5차 1201호',   '주식회사 알트리젠',         '4628700325', 55000000, '2026-01-01', '2026 1기 확정 명세서 역산 시드 — 시작일은 실제 계약일로 수정'),
  ('rd-seed-3dt001', '에이스골드타워 1203~1205호', '쓰리디테크놀로지스 주식회사', '8538102906', 50000000, '2026-01-01', '2026 1기 확정 명세서 역산 시드 — 시작일은 실제 계약일로 수정'),
  ('rd-seed-dald01', '에이스골드타워 1201호',      '달다봄',                    '7733300348', 12000000, '2026-01-01', '2026 1기 확정 명세서 역산 시드 — 시작일은 실제 계약일로 수정'),
  ('rd-seed-leeu01', '에이스골드타워 1209호',      '이유억 행정사사무소',        '3572100954',  3000000, '2026-01-01', '2026 1기 확정 명세서 역산 시드 — 시작일은 실제 계약일로 수정'),
  ('rd-seed-seoy01', '의왕스마트시티퀀텀 921호',   '(주)서연오토비전',          '3128151755', 15000000, '2026-01-01', '2026 1기 확정 명세서 역산 시드 — 시작일은 실제 계약일로 수정')
ON CONFLICT (deposit_id) DO NOTHING;
