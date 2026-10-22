-- 309: 회사소개서(카탈로그) — 문서·쪽·버전·발행본·반영 대기·자산·사업 분야·서체 골격 + 권한키
--   (docs/company-catalog-blueprint.md §10, 2026-10-21 P3 데이터 기반).
-- 화면: /sales/catalog(목록·지표) · /sales/catalog/projects(실적 노출) · /sales/catalog/people(인물) · /sales/catalog/assets(로고)
-- 스튜디오(쪽 편집)·발행(P4~P7)이 쓸 표도 여기서 함께 만든다 — 표 구조를 한 번에 잡아 두고 화면은 단계별로 붙인다.
-- 규칙(마이그 110·120 사고의 교훈): 새 권한키 = 카탈로그 시드 + tpl-system-admin grant 보충 + 업무 템플릿 배분을
--   한 파일에서 끝낸다. 멱등(IF NOT EXISTS·ON CONFLICT·WHERE NOT EXISTS). 관례상 text 타임스탬프.
-- 선행: 111(tpl-system-admin)·298(tpl-ceo·tpl-sales-staff). 템플릿이 없으면 해당 grant 만 건너뛴다.

-- ── 1) 권한 카탈로그 ──
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('catalog.view',    'catalog', 'view',    '회사소개서 — 목록·지표·발행본 열람',                         'all', 0, now()::text),
  ('catalog.manage',  'catalog', 'manage',  '회사소개서 — 실적·인물·자문위원·고객사 노출 관리, 표시 범위 설정', 'all', 1, now()::text),
  ('catalog.publish', 'catalog', 'publish', '회사소개서 — 발행(대외 배포본 확정)',                          'all', 1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

-- ── 2) 템플릿 배분 ──
--   시스템 관리자: 전부(누락 시 관리자조차 403)
--   대표이사(tpl-ceo): 열람·관리·발행 — 대외 문서 발행은 대표 확인 사항(블루프린트 D4)
--   임원(tpl-exec): 열람
--   영업 담당(tpl-sales-staff): 열람·관리 — 실적 대외 표기·노출은 영업 담당이 다룬다
--   ※ 전 직원 열람(tpl-staff-basic, 블루프린트 D3)은 발행본 화면(P7)이 생길 때 별도 마이그레이션으로 연다.
INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-' || t.prefix || '-' || substr(md5(t.permission_key), 1, 16),
       t.template_id, t.permission_key, 'all', 'allow', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES
          ('sysadm',     'tpl-system-admin', 'catalog.view'),
          ('sysadm',     'tpl-system-admin', 'catalog.manage'),
          ('sysadm',     'tpl-system-admin', 'catalog.publish'),
          ('ceo',        'tpl-ceo',          'catalog.view'),
          ('ceo',        'tpl-ceo',          'catalog.manage'),
          ('ceo',        'tpl-ceo',          'catalog.publish'),
          ('exec',       'tpl-exec',         'catalog.view'),
          ('salesstaff', 'tpl-sales-staff',  'catalog.view'),
          ('salesstaff', 'tpl-sales-staff',  'catalog.manage')
       ) AS t(prefix, template_id, permission_key)
  JOIN permission_templates pt ON pt.template_id = t.template_id
  JOIN permissions p ON p.permission_key = t.permission_key
 WHERE NOT EXISTS (SELECT 1 FROM permission_template_grants g WHERE g.template_id = t.template_id AND g.permission_key = t.permission_key);

-- ── 3) 문서(판) — 마스터본·맞춤판. appendix_rules = 부록 실적 표시 범위 규칙(블루프린트 §6-4, lib/catalog/appendix-rules.ts) ──
CREATE TABLE IF NOT EXISTS catalog_documents (
  doc_id          text  PRIMARY KEY,
  title           text  NOT NULL,
  kind            text  NOT NULL DEFAULT 'master' CHECK (kind IN ('master', 'custom')),
  theme           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- 색 컨셉·서체 세트·판 옵션
  appendix_rules  jsonb NOT NULL DEFAULT '{}'::jsonb,   -- 빈 객체 = 기본값(통합환경허가 0원·그 외 500만 원 등)
  page_size       text  NOT NULL DEFAULT 'A4-landscape',
  status          text  NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  current_version int   NOT NULL DEFAULT 0,
  owner           text,
  created_at      text  NOT NULL,
  created_by      text,
  updated_at      text  NOT NULL,
  updated_by      text
);

-- 마스터본 1건(표시 범위 규칙의 기본 저장처). 이미 있으면 그대로 둔다.
--   theme.fontSet = 기본 서체 세트 프리텐다드(D2 변경, 사용자 결정 10-22) — 서체 라이브러리(P5b)의 세트 id 와 맞춘다.
--   theme.cover = 표지 디자인 leaf|strips|center|band(기본 leaf, 사용자 지시 10-22), theme.coverPhoto = photo|none
--   (선택지 목록은 frontend/lib/catalog/document-theme.ts COVER_DESIGNS 하나로 관리 — B·C 확정 대기)
INSERT INTO catalog_documents (doc_id, title, kind, theme, created_at, updated_at)
VALUES ('master', '회사소개서(마스터본)', 'master', '{"fontSet": "pretendard", "cover": "leaf", "coverPhoto": "photo"}'::jsonb, now()::text, now()::text)
ON CONFLICT (doc_id) DO NOTHING;
UPDATE catalog_documents SET theme = '{"fontSet": "pretendard", "cover": "leaf", "coverPhoto": "photo"}'::jsonb
 WHERE doc_id = 'master' AND theme = '{}'::jsonb;

-- ── 4) 쪽 — 문서의 쪽 순서·쪽 유형·노드 트리(스튜디오, P5) ──
CREATE TABLE IF NOT EXISTS catalog_pages (
  page_id     text  PRIMARY KEY,
  doc_id      text  NOT NULL REFERENCES catalog_documents(doc_id) ON DELETE CASCADE,
  order_no    int   NOT NULL DEFAULT 0,
  page_type   text  NOT NULL,                 -- C01~C19·A01~A03(블루프린트 §3-2)
  section_key text,
  tree        jsonb NOT NULL DEFAULT '{}'::jsonb,
  hidden      int   NOT NULL DEFAULT 0,
  updated_at  text  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catalog_pages_doc ON catalog_pages(doc_id, order_no);

-- ── 5) 버전 스냅샷 — recruit_posting_versions 패턴 ──
CREATE TABLE IF NOT EXISTS catalog_versions (
  doc_id   text  NOT NULL REFERENCES catalog_documents(doc_id) ON DELETE CASCADE,
  version  int   NOT NULL,
  snapshot jsonb NOT NULL,
  note     text,
  saved_at text  NOT NULL,
  saved_by text,
  PRIMARY KEY (doc_id, version)
);

-- ── 6) 발행본 — 발행 시점 데이터 스냅샷·지문·PDF 고정 보관(대외 제출 이력) ──
CREATE TABLE IF NOT EXISTS catalog_editions (
  edition_id        text  PRIMARY KEY,
  doc_id            text  NOT NULL REFERENCES catalog_documents(doc_id) ON DELETE RESTRICT,
  version           int   NOT NULL,
  options           jsonb NOT NULL DEFAULT '{}'::jsonb,   -- 판(실명·마스킹)·분야 필터
  data_snapshot     jsonb NOT NULL DEFAULT '{}'::jsonb,
  fingerprint       jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_key           text,
  png_prefix        text,
  page_map          jsonb,
  distribution_note text,
  published_by      text,
  published_at      text  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catalog_editions_doc ON catalog_editions(doc_id, published_at DESC);

-- ── 7) 반영 대기 — 변경 감지 tick(P7)이 최근 발행본과 현재 데이터의 차이를 사람이 읽는 항목으로 남긴다 ──
CREATE TABLE IF NOT EXISTS catalog_pending_changes (
  change_id           text  PRIMARY KEY,
  doc_id              text  NOT NULL REFERENCES catalog_documents(doc_id) ON DELETE CASCADE,
  source              text  NOT NULL,          -- contracts|people|company_profile|history|credentials
  change_kind         text  NOT NULL CHECK (change_kind IN ('added', 'changed', 'removed')),
  summary             text  NOT NULL,
  ref                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at         text  NOT NULL,
  resolved_edition_id text REFERENCES catalog_editions(edition_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_catalog_pending_open ON catalog_pending_changes(doc_id) WHERE resolved_edition_id IS NULL;

-- ── 8) 자산 — 사진·로고·증서·지도. 파일은 계약 문서 저장소 catalog/ 프리픽스 ──
CREATE TABLE IF NOT EXISTS catalog_assets (
  asset_id     text  PRIMARY KEY,
  kind         text  NOT NULL CHECK (kind IN ('photo', 'logo', 'certificate', 'map')),
  storage_key  text  NOT NULL,
  file_name    text,
  content_type text,
  width        int,
  height       int,
  focal_x      double precision,
  focal_y      double precision,
  caption      text,
  taken_ym     text,
  rights_note  text,
  created_by   text,
  created_at   text  NOT NULL
);

-- ── 9) 사업 분야 — 계약 관리 5분류(categoryCaseSql)와 1:1로 시작(D11). display_name 만 소개서용으로 바꿀 수 있다 ──
--   6번째 '응용소프트웨어'(사용자 지시 10-22)는 소개서 전용 분야 — 계약 관리 분류에는 넣지 않고, 서비스 유형이
--   소프트웨어·SW·그룹웨어·ERP 인 공급 계약만 소개서에서 이 분야로 센다(lib/catalog/areas.ts). products = 제품 목록.
CREATE TABLE IF NOT EXISTS catalog_business_areas (
  area_id       text  PRIMARY KEY,
  name          text  NOT NULL,              -- 계약 관리 분류명(lib/ieps/contracts.ts DASHBOARD_SERVICE_CATEGORIES)
  display_name  text,                        -- 소개서 표기명(예: 기타 용역 → 환경 인허가·연구·교육, D15)
  order_no      int   NOT NULL DEFAULT 0,
  color_slot    text,                        -- area-1..5
  service_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  products      jsonb NOT NULL DEFAULT '[]'::jsonb,
  description   text,
  is_active     int   NOT NULL DEFAULT 1,
  updated_at    text  NOT NULL
);

INSERT INTO catalog_business_areas (area_id, name, order_no, color_slot, updated_at)
VALUES
  ('permit',  '통합환경허가', 1, 'area-1', now()::text),
  ('chem',    '장외·화관법',  2, 'area-2', now()::text),
  ('haps',    'HAPs 용역',    3, 'area-3', now()::text),
  ('esg',     'ESG·탄소중립', 4, 'area-4', now()::text),
  ('other',   '기타 용역',    5, 'area-5', now()::text)
ON CONFLICT (area_id) DO NOTHING;
-- 이 파일의 앞선 판을 적용한 개발 DB도 같은 결과가 되도록(스테이징 미적용 — CREATE 에 이미 포함)
ALTER TABLE catalog_business_areas ADD COLUMN IF NOT EXISTS products jsonb NOT NULL DEFAULT '[]'::jsonb;
INSERT INTO catalog_business_areas (area_id, name, order_no, color_slot, service_types, products, updated_at)
VALUES ('software', '응용소프트웨어', 6, 'area-6', '["소프트웨어", "SW", "그룹웨어", "ERP"]'::jsonb,
        '["그룹웨어 & ERP", "통합허가 계획서 플랫폼", "ESG 통합관리 플랫폼"]'::jsonb, now()::text)
ON CONFLICT (area_id) DO NOTHING;

-- ── 10) 인포그래픽 유형 선택 기록(분야별 기본값, P6) ──
CREATE TABLE IF NOT EXISTS catalog_infographic_prefs (
  slot_key   text  PRIMARY KEY,              -- area_id 또는 쪽·슬롯 키
  info_type  text  NOT NULL,
  variant    text,
  updated_at text  NOT NULL,
  updated_by text
);

-- ── 11) 서체 라이브러리(P5b) — 삭제 대신 비활성화(발행본 재현) ──
CREATE TABLE IF NOT EXISTS catalog_fonts (
  font_id       text  PRIMARY KEY,
  family        text  NOT NULL,
  display_name  text  NOT NULL,
  source        text  NOT NULL DEFAULT 'upload' CHECK (source IN ('bundled', 'upload')),
  files         jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{weight, style, storage_key, woff2_key, format, size}]
  roles_allowed jsonb NOT NULL DEFAULT '[]'::jsonb,  -- display|body|figure
  license_type  text,
  license_note  text,
  embed_policy  text,                                -- OS/2 fsType 판정
  coverage      jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics       jsonb NOT NULL DEFAULT '{}'::jsonb,
  size_adjust   jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active     int   NOT NULL DEFAULT 1,
  uploaded_by   text,
  uploaded_at   text  NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_font_sets (
  set_id          text  PRIMARY KEY,
  name            text  NOT NULL,
  display_font_id text REFERENCES catalog_fonts(font_id) ON DELETE SET NULL,
  body_font_id    text REFERENCES catalog_fonts(font_id) ON DELETE SET NULL,
  figure_font_id  text REFERENCES catalog_fonts(font_id) ON DELETE SET NULL,
  weight_map      jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_preset       int   NOT NULL DEFAULT 0,
  order_no        int   NOT NULL DEFAULT 0,
  updated_at      text  NOT NULL
);
