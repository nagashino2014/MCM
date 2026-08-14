-- 163: 특수관계인 플래그 + 보험 제외 연령 설정 (2026-08-14 사용자 요청)
-- 특수관계인(대표 친족 등)은 고용·산재보험 가입 대상 제외(가입해도 혜택 없어 실무상 미가입 관행)
--   → 고용보험 근로자 공제 산출에서 제외. 세액 설정 탭에서 직원별 체크.
-- 제외 연령은 법 개정 대응을 위해 설정값으로 관리(162 payroll_insurance_rates 재사용, rate=연령):
--   'nps-max-age' 60 = 국민연금 납부 제외 연령(EDI에 미포함되므로 검증·경고 억제용)
--   'ei-exempt-age' 65 = 고용보험 실업급여분 면제 연령(실측: 이유억 등 0원)
ALTER TABLE payroll_tax_profiles ADD COLUMN IF NOT EXISTS special_relation integer NOT NULL DEFAULT 0;

INSERT INTO payroll_insurance_rates (rate_id, kind, valid_from, rate, source, note) VALUES
  ('nps-max-age-2000-01',   'nps-max-age',   '2000-01', 60, 'seed', '국민연금 납부 제외 연령(만)'),
  ('ei-exempt-age-2000-01', 'ei-exempt-age', '2000-01', 65, 'seed', '고용보험 실업급여분 면제 연령(만)')
ON CONFLICT (kind, valid_from) DO NOTHING;
