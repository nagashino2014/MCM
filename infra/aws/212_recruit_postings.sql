-- 212: 홍보·채용공고 — 채용공고 템플릿 편집기(핸드오프 패키지 업로드 → 노드트리 파싱 → WYSIWYG 편집).
-- 화면: /admin/recruit(공고 목록) · /admin/recruit/templates(템플릿 관리) · /admin/recruit/[postingId](에디터)
-- 모델: 템플릿(디자인 골격, 업로드로 라인업 확장)과 공고(템플릿 인스턴스 + 편집된 콘텐츠)를 분리.
--   design_tree/content_tree 는 태그·스타일 화이트리스트를 통과한 노드트리 JSON(frontend/lib/recruit/types.ts).
-- 멱등.

-- ── 권한키 ──
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('recruit.view',   'recruit', 'view',   '홍보·채용공고 — 공고·템플릿 열람',                       'all', 0, now()::text),
  ('recruit.manage', 'recruit', 'manage', '홍보·채용공고 — 템플릿 업로드·공고 작성·편집·삭제',       'all', 1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

-- 시스템 관리자 템플릿(tpl-system-admin, 111) grant 보충 — 누락 시 관리자조차 403(role 우회가 없다).
INSERT INTO permission_template_grants
  (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-sysadm-' || substr(md5(k.key), 1, 16), 'tpl-system-admin', k.key, 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES ('recruit.view'), ('recruit.manage')) AS k(key)
 WHERE EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-system-admin')
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = k.key
   );

-- ── 템플릿 — 클로드 디자인 핸드오프 패키지 1건 = 1행. 원본 파일은 S3(recruit-template-storage) ──
CREATE TABLE IF NOT EXISTS recruit_templates (
  template_id     text  PRIMARY KEY,
  name            text  NOT NULL,
  description     text,
  design_tree     jsonb NOT NULL,          -- 파싱·정제된 노드트리(반복그룹 마킹 포함)
  theme           jsonb NOT NULL DEFAULT '{}'::jsonb, -- {accentColor, accentOptions[], compact, cssVars{}}
  source_file_key text,                    -- 업로드 원본(html/zip) S3 키
  doc_width       int   NOT NULL DEFAULT 900,
  is_active       int   NOT NULL DEFAULT 1,
  created_at      text  NOT NULL,
  created_by      text,
  updated_at      text  NOT NULL
);

-- ── 공고 — 템플릿에서 찍어낸 인스턴스. content_tree 만 자기 데이터로 진화 ──
CREATE TABLE IF NOT EXISTS recruit_postings (
  posting_id   text  PRIMARY KEY,
  template_id  text  NOT NULL REFERENCES recruit_templates(template_id),
  title        text  NOT NULL,
  content_tree jsonb NOT NULL,
  theme        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text  NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  created_at   text  NOT NULL,
  created_by   text,
  updated_at   text  NOT NULL,
  updated_by   text,
  deleted_at   text
);
CREATE INDEX IF NOT EXISTS idx_recruit_postings_tpl ON recruit_postings(template_id);
CREATE INDEX IF NOT EXISTS idx_recruit_postings_live ON recruit_postings(status) WHERE deleted_at IS NULL;

-- ── 버전 스냅샷 — 명시 저장 시점의 콘텐츠 보존(실수 복구용) ──
CREATE TABLE IF NOT EXISTS recruit_posting_versions (
  posting_id   text  NOT NULL REFERENCES recruit_postings(posting_id) ON DELETE CASCADE,
  version      int   NOT NULL,
  content_tree jsonb NOT NULL,
  theme        jsonb NOT NULL DEFAULT '{}'::jsonb,
  saved_at     text  NOT NULL,
  saved_by     text,
  PRIMARY KEY (posting_id, version)
);
