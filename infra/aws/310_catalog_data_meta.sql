-- 310: 회사소개서 데이터 메타 — 회사 프로필 보강(연혁 출처·공개·강조, 특허·수상, 홈페이지·비전) + 계약 없는 실적 +
--   직접 입력 임원(촉탁) + 편집 콘텐츠(대표이사 인사말·판 기록) +
--   실적 대외 표기(contract_catalog_meta) + 인물 노출(catalog_people_meta) + 자문위원 + 고객사 로고 + 외부 수치.
--   (docs/company-catalog-blueprint.md §6-3·§6-4·§6-6·§10, 2026-10-21 P3)
-- 선행: 309(catalog_assets). 멱등. 기존 행은 지우거나 바꾸지 않는다(연혁 백필은 비공개 후보로만 넣는다).

-- ── 1) 연혁 — 분류·출처·공개·강조 ──
--   source_table/source_id: 인증·특허·등록에서 자동으로 만든 줄(같은 출처는 1줄, 원본 수정·삭제 시 앱이 함께 고친다).
--   category: 설립|등록|인증|특허|수상|조직|사업 (NULL = 미분류)
ALTER TABLE company_history ADD COLUMN IF NOT EXISTS category     text;
ALTER TABLE company_history ADD COLUMN IF NOT EXISTS source_table text;
ALTER TABLE company_history ADD COLUMN IF NOT EXISTS source_id    text;
ALTER TABLE company_history ADD COLUMN IF NOT EXISTS is_public    int NOT NULL DEFAULT 1;
ALTER TABLE company_history ADD COLUMN IF NOT EXISTS highlight    int NOT NULL DEFAULT 0;
ALTER TABLE company_history ADD COLUMN IF NOT EXISTS updated_at   text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_history_source
  ON company_history(source_table, source_id) WHERE source_table IS NOT NULL;

-- ── 2) 면허·인증 — 특허·수상 종류, 공개 여부, 증빙 파일명 ──
--   079 의 인라인 CHECK(이름 company_credentials_kind_check)를 넓힌다. 다시 실행해도 같은 정의로 돌아온다.
ALTER TABLE company_credentials DROP CONSTRAINT IF EXISTS company_credentials_kind_check;
ALTER TABLE company_credentials ADD CONSTRAINT company_credentials_kind_check
  CHECK (kind IN ('license', 'certification', 'patent', 'award'));
ALTER TABLE company_credentials ADD COLUMN IF NOT EXISTS is_public int NOT NULL DEFAULT 1;
ALTER TABLE company_credentials ADD COLUMN IF NOT EXISTS file_name text;

-- ── 3) 회사 일반현황 — 홈페이지·대표 메일·로고·비전·슬로건 ──
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS website       text;
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS email         text;
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS logo_asset_id text;
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS vision        text;
ALTER TABLE company_profile ADD COLUMN IF NOT EXISTS slogan        text;

-- 기존 인증·등록의 연혁 후보 백필 — 이미 손으로 적은 연혁과 겹칠 수 있어 **비공개 후보**(is_public=0)로만 넣는다.
--   이후 저장분은 앱(lib/company/profile.ts syncCredentialHistory)이 공개(D6 권장값)로 만든다. 문구 규칙은 앱과 같다.
INSERT INTO company_history (history_id, event_ym, content, display_order, created_at, category, source_table, source_id, is_public, highlight, updated_at)
SELECT 'chs_cred_' || c.credential_id,
       r.m[1] || '-' || lpad(r.m[2], 2, '0'),
       CASE c.kind
         WHEN 'license'       THEN CASE WHEN c.name LIKE '%등록' THEN c.name ELSE c.name || ' 등록' END
         WHEN 'certification' THEN CASE WHEN c.name LIKE '%인증' THEN c.name || ' 취득' ELSE c.name || ' 인증 취득' END
         WHEN 'patent'        THEN CASE WHEN c.name LIKE '%특허%등록' THEN c.name WHEN c.name LIKE '%특허%' THEN c.name || ' 등록' ELSE c.name || ' 특허 등록' END
         ELSE CASE WHEN c.name LIKE '%수상' THEN c.name ELSE c.name || ' 수상' END
       END,
       0, now()::text,
       CASE c.kind WHEN 'license' THEN '등록' WHEN 'certification' THEN '인증' WHEN 'patent' THEN '특허' ELSE '수상' END,
       'company_credentials', c.credential_id, 0, 0, now()::text
  FROM company_credentials c
  CROSS JOIN LATERAL regexp_match(COALESCE(c.issued_at, ''), '(\d{4})\D?(\d{1,2})') AS r(m)
 WHERE r.m IS NOT NULL AND btrim(COALESCE(c.name, '')) <> ''
ON CONFLICT (source_table, source_id) WHERE source_table IS NOT NULL DO NOTHING;

-- ── 4) 실적 대외 표기 — 메타가 없어도 규칙(lib/catalog/projects.ts buildDisplayTitle)으로 부록이 만들어진다 ──
--   display_override: auto(표시 범위 규칙을 따름) | always(항상 표시) | never(항상 숨김)
--   is_public=0: 비밀유지 고객 — 총괄 건수에는 포함, 목록에는 "○○사"로 익명화(D9)
--   reviewed_at: 실적 노출 관리에서 확인한 시각(NULL = 미검토 배지)
--   site_count: 한 용역이 맡은 허가 사업장 수(최초허가 지표·총괄표 괄호). NULL = 결정번호 수(없으면 1).
--     예: 2017 환경부 시범사업(엔아이티·진주산업) 2, 한국지역난방공사 중앙지사 3, 세진메탈 1·3공장 2, 동남 울산·서산 2
CREATE TABLE IF NOT EXISTS contract_catalog_meta (
  contract_id      text PRIMARY KEY REFERENCES contracts(contract_id) ON DELETE CASCADE,
  display_title    text,
  display_industry text,
  is_public        int  NOT NULL DEFAULT 1,
  is_featured      int  NOT NULL DEFAULT 0,
  display_override text NOT NULL DEFAULT 'auto' CHECK (display_override IN ('auto', 'always', 'never')),
  group_key        text,
  note             text,
  site_count       int  CHECK (site_count BETWEEN 1 AND 50),
  reviewed_at      text,
  updated_by       text,
  updated_at       text NOT NULL
);
-- 이 파일의 앞선 판을 적용한 개발 DB도 같은 결과가 되도록(스테이징 미적용 — CREATE 에 이미 포함)
ALTER TABLE contract_catalog_meta ADD COLUMN IF NOT EXISTS site_count int CHECK (site_count BETWEEN 1 AND 50);
CREATE INDEX IF NOT EXISTS idx_contract_catalog_meta_group ON contract_catalog_meta(group_key) WHERE group_key IS NOT NULL;

-- ── 4-1) 계약 없는 실적 — 정식 계약 없이 수행한 실적을 회사소개서 지표·부록에만 넣는다(계약 관리 수주·매출 집계와 무관) ──
--   예: 석문에너지 통합환경허가 — 한국종합기술이 수행하지 못한 허가 취득을 위임받아 수행, 정식 계약 없이 대금만 수령(사용자 확인 10-22).
--   category 는 계약 관리 5분류 이름, subtype 은 계약 세분류와 같은 값(최초허가·변경허가 등).
--   완료 판정: permit_issued_at 이 있거나 status='completed'. site_count NULL = 결정번호 수(없으면 1).
CREATE TABLE IF NOT EXISTS catalog_manual_projects (
  manual_id        text PRIMARY KEY,
  category         text NOT NULL,
  subtype          text,
  title            text NOT NULL,             -- 내부 이름(예: 석문에너지 통합환경허가 취득 — 한국종합기술 위임)
  display_title    text,                      -- 대외 표기명(비우면 규칙으로 자동 생성)
  counterparty_name text,                     -- 발주처·위임자(예: 한국종합기술)
  site_name        text,                      -- 사업장(예: 석문에너지)
  region_sido      text,
  industry         text,                      -- 업종(통합허가 20개 업종 라벨 권장)
  started_at       text,                      -- YYYY-MM-DD 또는 YYYY-MM
  ended_at         text,
  status           text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'ongoing')),
  permit_issued_at text,
  permit_no        text,
  site_count       int  CHECK (site_count BETWEEN 1 AND 50),
  amount           double precision,          -- 수령액(표시 범위 금액 기준용, 선택)
  display_override text NOT NULL DEFAULT 'auto' CHECK (display_override IN ('auto', 'always', 'never')),
  is_public        int  NOT NULL DEFAULT 1,
  is_featured      int  NOT NULL DEFAULT 0,
  group_key        text,
  note             text,                      -- 계약이 없는 사유 등(내부용)
  created_at       text NOT NULL,
  created_by       text,
  updated_at       text NOT NULL,
  updated_by       text
);

-- ── 5) 인물 노출 — 임원진·기술인력(사용자관리 등록 재직자만 대상, 퇴사 시 즉시 빠짐) ──
--   section_override: NULL = 규칙(직급이 부장보다 높으면 임원진, 부장 이하는 직원 — 사용자 확인 10-22), exec|staff = 수동 지정
--   photo_consent: NULL 미확인 · 1 동의 · 0 거부 — 직원 사진은 동의(1)만, 임원은 거부(0)가 아니면 게재(D5 권장값)
CREATE TABLE IF NOT EXISTS catalog_people_meta (
  employee_id      text PRIMARY KEY REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  display_override text NOT NULL DEFAULT 'auto' CHECK (display_override IN ('auto', 'always', 'never')),
  section_override text CHECK (section_override IN ('exec', 'staff')),
  order_no         int,
  role_label       text,
  bio_short        text,
  photo_consent    int CHECK (photo_consent IN (0, 1)),
  photo_asset_id   text REFERENCES catalog_assets(asset_id) ON DELETE SET NULL,  -- 소개서 전용 사진(비우면 인사 사진)
  updated_by       text,
  updated_at       text NOT NULL
);
-- 이 파일의 앞선 판을 적용한 개발 DB도 같은 결과가 되도록(스테이징 미적용 — CREATE 에 이미 포함)
ALTER TABLE catalog_people_meta ADD COLUMN IF NOT EXISTS photo_asset_id text REFERENCES catalog_assets(asset_id) ON DELETE SET NULL;

-- ── 5-1) 직접 입력하는 임원 — 고문 등 근로계약 없이 자문(촉탁) 계약을 맺어 사용자관리에 없는 인물(사용자 요구 10-22) ──
--   임원진 목록에 자동 판정 임원과 합쳐 표시한다. count_in_total=1 이면 임직원·임원 인원 수에도 넣는다.
CREATE TABLE IF NOT EXISTS catalog_extra_people (
  person_id       text PRIMARY KEY,
  name            text NOT NULL,
  role_label      text,                      -- 소개서 직함(예: 고문)
  employment_type text NOT NULL DEFAULT '촉탁' CHECK (employment_type IN ('촉탁', '자문', '기타')),
  bio_short       text,                      -- 약력 요약(3~4줄)
  career          text,                      -- 상세 경력(이력 쪽용, 줄바꿈 구분)
  photo_asset_id  text REFERENCES catalog_assets(asset_id) ON DELETE SET NULL,
  order_no        int,
  is_public       int  NOT NULL DEFAULT 1,
  count_in_total  int  NOT NULL DEFAULT 1,
  created_at      text NOT NULL,
  created_by      text,
  updated_at      text NOT NULL,
  updated_by      text
);

-- ── 5-2) 편집 콘텐츠 — 대표이사 인사말 등 수시로 고치는 본문(사용자 요구 10-22) ──
--   draft = 편집 중 내용(jsonb), 확정할 때마다 catalog_content_versions 에 판을 남긴다. 소개서는 최신 확정판을 쓴다.
--   ceo_message draft: {title, body, signTitle, signName, photoAssetId}
--   org_chart   draft: {nodes: [{id, label, sub, badge, children: [...]}]} — 기본값은 MCM 조직 마스터에서 만들고 소개서 전용으로 고친다(10-22)
CREATE TABLE IF NOT EXISTS catalog_contents (
  content_key       text PRIMARY KEY,
  draft             jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_version int,
  updated_at        text NOT NULL,
  updated_by        text
);

CREATE TABLE IF NOT EXISTS catalog_content_versions (
  content_key text  NOT NULL REFERENCES catalog_contents(content_key) ON DELETE CASCADE,
  version     int   NOT NULL,
  data        jsonb NOT NULL,
  note        text,
  saved_at    text  NOT NULL,
  saved_by    text,
  PRIMARY KEY (content_key, version)
);

-- ── 6) 자문위원 명부 ──
CREATE TABLE IF NOT EXISTS catalog_advisors (
  advisor_id text PRIMARY KEY,
  name       text NOT NULL,
  field      text,            -- 자문 분야(예: 대기·수질·화학안전·ESG)
  org        text,            -- 소속
  title      text,            -- 직위
  career     text,            -- 주요 경력(줄바꿈 구분)
  order_no   int  NOT NULL DEFAULT 0,
  is_public  int  NOT NULL DEFAULT 1,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  updated_by text
);

-- ── 7) 고객사·협력 기관(로고 월) ──
CREATE TABLE IF NOT EXISTS catalog_clients (
  client_id     text PRIMARY KEY,
  facility_id   text REFERENCES facilities(facility_id) ON DELETE SET NULL,
  name          text NOT NULL,
  category      text NOT NULL DEFAULT '민간' CHECK (category IN ('공공', '민간', '협회')),
  logo_asset_id text REFERENCES catalog_assets(asset_id) ON DELETE SET NULL,
  order_no      int  NOT NULL DEFAULT 0,
  is_public     int  NOT NULL DEFAULT 1,
  created_at    text NOT NULL,
  updated_at    text NOT NULL,
  updated_by    text
);

-- ── 8) 외부 수치 — 지표의 분모 등 앱이 계산할 수 없는 값(출처·기준일 필수) ──
CREATE TABLE IF NOT EXISTS catalog_external_figures (
  figure_key text PRIMARY KEY,
  label      text NOT NULL,
  value      double precision,
  unit       text,
  source     text,
  as_of      text,
  note       text,
  updated_by text,
  updated_at text NOT NULL
);

-- 현행 카탈로그(2026.06판 8장)에 적힌 분모 — 출처 원문 확인 전까지 '카탈로그 기재값'으로 표시한다.
INSERT INTO catalog_external_figures (figure_key, label, value, unit, source, as_of, note, updated_at)
VALUES
  ('permit.sites.total',    '통합허가 완료 사업장 수(환경부)',       1307, '개소', '현행 회사소개서(2026.06판) 기재값', '2026-06', '원 출처(환경부 통합환경허가시스템) 확인 필요', now()::text),
  ('permit.sites.cohort1',  '통합허가 사업장 수 — 1차년도 발전·폐기물', 294, '개소', '현행 회사소개서(2026.06판) 기재값', '2026-06', NULL, now()::text),
  ('permit.sites.cohort2',  '통합허가 사업장 수 — 2차년도 철강·비철',   194, '개소', '현행 회사소개서(2026.06판) 기재값', '2026-06', NULL, now()::text),
  ('permit.sites.cohort3',  '통합허가 사업장 수 — 3차년도 석유화학',    228, '개소', '현행 회사소개서(2026.06판) 기재값', '2026-06', NULL, now()::text),
  ('permit.sites.cohort4',  '통합허가 사업장 수 — 4차년도 제지·전자',   162, '개소', '현행 회사소개서(2026.06판) 기재값', '2026-06', NULL, now()::text),
  ('permit.sites.cohort5',  '통합허가 사업장 수 — 5차년도 반도체 등',   429, '개소', '현행 회사소개서(2026.06판) 기재값', '2026-06', NULL, now()::text),
  ('permit.agencies.total', '통합허가대행업 등록 컨설팅사 수',         136, '개소', '현행 회사소개서(2026.06판) 기재값', '2026-06', NULL, now()::text)
ON CONFLICT (figure_key) DO NOTHING;
