-- 079: 회사 프로필 관리 — 자사 일반현황·연혁·면허/인증 보유현황
-- (docs/bid-package-blueprint.md §4-3. 입찰 증빙서류 패키지의 자사 데이터 공급원. 멱등)

-- 자사 일반현황(단일 행 profile_id='default'): 업체명·대표자·사업자번호·주소·업종 등 +
-- 신용평가등급(credit jsonb)·연도별 재정상황(finance jsonb) + 주요 사업내용.
CREATE TABLE IF NOT EXISTS company_profile (
  profile_id text PRIMARY KEY,
  company_name text,
  ceo_name text,
  biz_reg_no text,
  corp_reg_no text,
  address text,
  phone text,
  fax text,
  biz_field text,
  founded_ym text,
  main_business text,
  credit jsonb,
  finance jsonb,
  updated_by text,
  updated_at text
);

INSERT INTO company_profile (profile_id, updated_at)
VALUES ('default', now()::text)
ON CONFLICT (profile_id) DO NOTHING;

-- 주요연혁(타임라인): 연월 + 내용.
CREATE TABLE IF NOT EXISTS company_history (
  history_id text PRIMARY KEY,
  event_ym text NOT NULL,
  content text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at text NOT NULL
);

-- 면허/허가/등록증·인증 보유현황: kind=license(면허류)|certification(인증류).
-- LLM 파싱(취득일·번호·유효기간 자동입력) 대상. 증빙 파일은 storage_key 로 보관(선택).
CREATE TABLE IF NOT EXISTS company_credentials (
  credential_id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('license','certification')),
  name text NOT NULL,
  credential_no text,
  issued_at text,
  valid_until text,
  issuer text,
  note text,
  storage_key text,
  display_order integer NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
