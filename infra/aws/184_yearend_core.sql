-- 184_yearend_core.sql
-- 회계 확충 P8: 연말정산 자체 수행 — 귀속연도별 세율·공제 파라미터(시드) + 직원별 정산 스냅
-- 블루프린트: docs/accounting-expansion-blueprint.md §5 P8
-- 원칙(§7 T4): 세율·공제 기준은 코드 하드코딩 금지 — 귀속연도별 JSON 시드로 관리, 개정 시 연도 행 추가.
-- 멱등: CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING / UPDATE ... WHERE taxable IS NULL

-- ─────────────────────────────────────────────
-- 1. 귀속연도별 세율·공제 파라미터 (2025 귀속 = 2026년 초 시행 기준)
--    구간표 표현: [상한(null=무한), 율, 구간시작까지 누적액, 구간시작] — 엔진(lib/finance/yearend.ts)이 해석.
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS yearend_tax_params (
  target_year integer PRIMARY KEY,   -- 귀속연도
  params      jsonb NOT NULL,
  note        text,
  created_at  text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS')
);

INSERT INTO yearend_tax_params (target_year, params, note) VALUES
(2025, '{
  "basicBrackets": [[14000000, 0.06, 0], [50000000, 0.15, 1260000], [88000000, 0.24, 5760000], [150000000, 0.35, 15440000], [300000000, 0.38, 19940000], [500000000, 0.40, 25940000], [1000000000, 0.42, 35940000], [null, 0.45, 65940000]],
  "earnedIncomeDeduction": [[5000000, 0.70, 0, 0], [15000000, 0.40, 3500000, 5000000], [45000000, 0.15, 7500000, 15000000], [100000000, 0.05, 12000000, 45000000], [null, 0.02, 14750000, 100000000]],
  "earnedIncomeDeductionCap": 20000000,
  "personalDeductionPer": 1500000,
  "elderlyExtra": 1000000,
  "disabledExtra": 2000000,
  "earnedTaxCredit": {"threshold": 1300000, "rateLow": 0.55, "rateHigh": 0.30, "caps": [[33000000, 740000], [70000000, 660000], [120000000, 500000], [null, 200000]]},
  "pensionAccountCredit": {"rateLow": 0.15, "rateHigh": 0.12, "grossThreshold": 55000000, "cap": 9000000},
  "insuranceCredit": {"rate": 0.12, "cap": 1000000},
  "medicalCredit": {"rate": 0.15, "grossFloorRate": 0.03, "dependentCap": 7000000},
  "educationCredit": {"rate": 0.15},
  "donationCredit": {"rate": 0.15, "highRate": 0.30, "highThreshold": 10000000},
  "monthlyRentCredit": {"rate": 0.15, "rateLow": 0.17, "grossThreshold": 55000000, "cap": 10000000, "grossLimit": 80000000},
  "cardDeduction": {"floorRate": 0.25, "creditRate": 0.15, "checkCashRate": 0.30, "traditionalTransitRate": 0.40, "baseCap": [[70000000, 3000000], [null, 2500000]], "extraCap": 3000000},
  "childCredit": [250000, 300000, 400000],
  "standardCredit": 130000,
  "localRate": 0.1
}'::jsonb, '2025 귀속(2026년 초 시행). 자녀세액공제는 2025 개정(첫째25·둘째30·셋째+40만) 반영 — 시행 확정치와 다르면 이 행만 수정. 근로소득세액공제 한도는 구간 근사(감소식 단순화 — 병행 검증 T1로 보정)')
ON CONFLICT (target_year) DO NOTHING;

-- ─────────────────────────────────────────────
-- 2. 직원별 정산 스냅 — 총급여·기납부는 급여대장에서 자동, 공제 입력·계산 결과 JSON 보존(드릴다운 T5)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS yearend_settlements (
  settle_id     text PRIMARY KEY,       -- 'ye-' + (연도:employee) 해시
  target_year   integer NOT NULL,
  employee_id   text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'draft',  -- draft / confirmed
  gross_pay     bigint NOT NULL DEFAULT 0,      -- 총급여(과세 지급 합 — 대장 자동)
  prepaid_tax   bigint NOT NULL DEFAULT 0,      -- 기납부 소득세(간이세액+중도정산 — 대장 자동)
  inputs        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 공제 입력(부양가족·간소화 파싱 값 등)
  result        jsonb,                           -- 계산 스냅(단계별 브레이크다운)
  pdf_key       text,                            -- 간소화 PDF S3 키(업로드 시)
  memo          text,
  confirmed_at  text,
  created_at    text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS'),
  updated_at    text,
  UNIQUE (target_year, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_yearend_settlements_year ON yearend_settlements(target_year);

-- ─────────────────────────────────────────────
-- 3. 급여 항목 과세 여부 시드 보정 — 총급여(과세) 산정용. NULL(미정)만 채운다.
--    비과세: 식대(월 20만 한도 운용 실측)·차량유지비(자가운전 보조)·육아수당(월 20만 한도).
--    나머지 지급 항목은 과세. 공제 항목은 해당 없음(0 유지).
-- ─────────────────────────────────────────────
UPDATE payroll_item_defs SET taxable = 0 WHERE item_id IN ('meal', 'vehicle', 'childcare') AND taxable IS NULL;
UPDATE payroll_item_defs SET taxable = 1 WHERE kind = 'pay' AND taxable IS NULL;
