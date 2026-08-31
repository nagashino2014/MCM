-- 직원 입금 계좌 은행명(2026-08-26) — 인사관리 탭 계좌 정보에 은행코드와 별도로
-- 사람이 읽는 은행명을 둔다(CMS 계좌정보 파일의 금융기관명 그대로 보관).
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS bank_name text;
