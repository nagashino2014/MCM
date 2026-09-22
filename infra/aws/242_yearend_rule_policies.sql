-- G-00B: exact-year policies for P-010/P-011 only.
-- Keeps migration 184, all yearend_tax_params rows and saved settlements unchanged.
-- A 2026 policy is NOT a validation of all legacy 2025 baseline parameters for 2026.
-- New calculations record the selected policy, baseline parameters and source evidence.
CREATE TABLE IF NOT EXISTS yearend_rule_policies (
  target_year      integer PRIMARY KEY,
  rule_version     text NOT NULL CHECK (length(btrim(rule_version)) > 0),
  base_params_year integer NOT NULL REFERENCES yearend_tax_params(target_year),
  reviewed_scope   jsonb NOT NULL CHECK (jsonb_typeof(reviewed_scope) = 'array'),
  policy           jsonb NOT NULL CHECK (jsonb_typeof(policy) = 'object'),
  sources          jsonb NOT NULL CHECK (jsonb_typeof(sources) = 'array'),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Identical re-runs are no-ops, including created_at. Unexpected existing content
-- must fail instead of relabeling or replacing an already-used rule version.
DO $$
DECLARE
  review_year integer;
  expected_policy jsonb := '{
    "earnedCreditCalculation":{"threshold":1300000,"lowNumerator":55,"highNumerator":30,"denominator":100},
    "earnedCreditCaps": [
      {"through":33000000,"base":740000,"start":0,"numerator":0,"denominator":1,"floor":740000},
      {"through":70000000,"base":740000,"start":33000000,"numerator":8,"denominator":1000,"floor":660000},
      {"through":120000000,"base":660000,"start":70000000,"numerator":1,"denominator":2,"floor":500000},
      {"through":null,"base":500000,"start":120000000,"numerator":1,"denominator":2,"floor":200000}
    ],
    "standardCredit":130000
  }'::jsonb;
  expected_scope jsonb := '["P-010","P-011"]'::jsonb;
  expected_sources jsonb;
  existing yearend_rule_policies%ROWTYPE;
BEGIN
  FOREACH review_year IN ARRAY ARRAY[2025, 2026] LOOP
    IF review_year = 2025 THEN
      expected_sources := '[{
        "url":"https://www.nts.go.kr/comm/nttFileDownload.do?fileKey=88c482e8d69eb1653515871654a4ab42",
        "article":"2025 연말정산 신고안내 PDF 180/인쇄 162 소득세법 제59조; PDF 188/인쇄 170 제59조의4 표준세액공제 및 정치자금·고향사랑·우리사주조합 기부금 병용; PDF 260/인쇄 242 작성방법 15 원 단위 미만 버림",
        "effectiveYear":2025,
        "reviewedAt":"2026-09-12",
        "scope":["P-010","P-011"]
      }]'::jsonb;
    ELSE
      expected_sources := '[{
        "url":"https://law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1032884481",
        "article":"소득세법 제59조 제1항·제2항; 시행 2026-07-01, 제2항 최종 개정 2022-12-31",
        "effectiveYear":2026,
        "reviewedAt":"2026-09-12",
        "scope":["P-010"]
      },{
        "url":"https://www.law.go.kr/LSW/lsLinkCommonInfo.do?lsJoLnkSeq=1018486177",
        "article":"소득세법 제59조의4 제9항 제1호·제6항, 시행 2026-07-01; 제52조 제8항 및 조세특례제한법 제95조의2 제3항의 신청 제외",
        "effectiveYear":2026,
        "reviewedAt":"2026-09-12",
        "scope":["P-011"]
      }]'::jsonb;
    END IF;

    INSERT INTO yearend_rule_policies
      (target_year, rule_version, base_params_year, reviewed_scope, policy, sources)
    VALUES (review_year, 'g00b-p010-p011-v1', 2025, expected_scope, expected_policy, expected_sources)
    ON CONFLICT (target_year) DO NOTHING;

    SELECT * INTO existing FROM yearend_rule_policies WHERE target_year = review_year FOR SHARE;
    IF existing.rule_version IS DISTINCT FROM 'g00b-p010-p011-v1'
      OR existing.base_params_year IS DISTINCT FROM 2025
      OR existing.reviewed_scope IS DISTINCT FROM expected_scope
      OR existing.policy IS DISTINCT FROM expected_policy
      OR existing.sources IS DISTINCT FROM expected_sources THEN
      RAISE EXCEPTION 'Year-end rule policy conflict for year %; existing content was not overwritten', review_year
        USING ERRCODE = '23514';
    END IF;
  END LOOP;
END $$;
