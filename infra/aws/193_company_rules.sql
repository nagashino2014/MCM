-- 193: 사규(취업규칙) 규정집 — 상시 열람 + 개정 신구비교 + 불이익 변경 시 전자동의(RB).
-- 화면: /rules(열람) · /rules/admin(임포트·검수·개정) · /rules/consents(동의 수집)
-- 설계: docs/company-rules-blueprint.md
-- 근거: 사규 부칙 제3조(= 근로기준법 §94) — 변경 시 과반수 의견청취, 불이익 변경 시 과반수 동의.
--   따라서 동의는 "서명 수 세기"가 아니라 **발송 시점 재적(headcount_snapshot) 대비 과반** 추적이다.
-- 모델 출처: 판(版) 불변 = labor_contract_templates(156), 대상자 행 선생성 = leave_notices(088).
-- 멱등.

-- ── 권한키 ──
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('rules.view',   'rules', 'view',   '사규 — 규정집 열람(전 임직원)',                    'all', 0, now()::text),
  ('rules.manage', 'rules', 'manage', '사규 — 원문 임포트·개정안 작성·동의 수집·판 발행', 'all', 1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

-- 시스템 관리자 템플릿(tpl-system-admin, 111) grant 보충 — 111 주석의 필수 절차:
-- "새 권한 키를 추가하면 이 템플릿에도 넣어야 한다". 누락 시 관리자조차 403(role 우회가 없다).
INSERT INTO permission_template_grants
  (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-sysadm-' || substr(md5(k.key), 1, 16), 'tpl-system-admin', k.key, 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES ('rules.view'), ('rules.manage')) AS k(key)
 WHERE EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-system-admin')
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = k.key
   );

-- ── 규정 단위 — 사규 본체 외에 별도 규정(육아기 단축제도 등)도 같은 틀에 담는다 ──
CREATE TABLE IF NOT EXISTS rule_documents (
  doc_id     text PRIMARY KEY,           -- 'work-rules' | 'childcare-shortened' …
  title      text NOT NULL,
  category   text,                        -- '취업규칙' | '관리규정' …
  sort_order int  NOT NULL DEFAULT 100,
  is_active  int  NOT NULL DEFAULT 1,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

INSERT INTO rule_documents (doc_id, title, category, sort_order, is_active, created_at, updated_at)
VALUES ('work-rules', '한국환경안전연구원 사규', '취업규칙', 10, 1, now()::text, now()::text)
ON CONFLICT (doc_id) DO NOTHING;

-- ── 판(版) — 발행 후 body 불변. 개정은 항상 새 행 ──
CREATE TABLE IF NOT EXISTS rule_versions (
  version_id      text PRIMARY KEY,
  doc_id          text NOT NULL REFERENCES rule_documents(doc_id) ON DELETE CASCADE,
  version         int  NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'in_consent', 'published', 'superseded')),
  effective_date  text,                   -- 시행일 YYYY-MM-DD
  body            jsonb NOT NULL,         -- 조문 IR — docs/company-rules-blueprint.md §3
  revision_note   text,
  source_file_key text,                   -- 원본 hwpx/pdf 저장키(contract-document-storage)
  pdf_file_key    text,                   -- 발행본 PDF
  import_warnings jsonb,                  -- 임포트 검수 경고 스냅(원문 결함 이력 보존)
  published_at    text,
  published_by    text,
  created_at      text NOT NULL,
  created_by      text
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rule_versions_uniq ON rule_versions(doc_id, version);
CREATE INDEX IF NOT EXISTS idx_rule_versions_doc ON rule_versions(doc_id, status);

-- ── 개정 라운드 — from → to 판 전환 절차 ──
CREATE TABLE IF NOT EXISTS rule_amendments (
  amendment_id       text PRIMARY KEY,
  doc_id             text NOT NULL REFERENCES rule_documents(doc_id) ON DELETE CASCADE,
  from_version_id    text REFERENCES rule_versions(version_id) ON DELETE SET NULL,
  to_version_id      text NOT NULL REFERENCES rule_versions(version_id) ON DELETE CASCADE,
  consent_required   int  NOT NULL DEFAULT 0,   -- 불이익 변경 여부(조항 플래그 OR)
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'announced', 'collecting', 'confirmed', 'cancelled')),
  briefing_note      jsonb,                     -- 설명회·공고 기록 {board_post_id, held_at, method}
  approval_doc_id    text,                      -- (선택) 대표이사 결재 게이트 — labor_contract_rounds 관례
  headcount_snapshot int,                       -- 발송 시점 재적 = 과반수 분모(수집 중 입퇴사로 흔들리지 않게 고정)
  created_at         text NOT NULL,
  created_by         text,
  confirmed_at       text
);
CREATE INDEX IF NOT EXISTS idx_rule_amendments_doc ON rule_amendments(doc_id, status);

-- ── 조문 단위 변경 명세 = 신구조문대비표의 행 ──
CREATE TABLE IF NOT EXISTS rule_amendment_changes (
  change_id    text PRIMARY KEY,
  amendment_id text NOT NULL REFERENCES rule_amendments(amendment_id) ON DELETE CASCADE,
  article_key  text NOT NULL,             -- 'art-33' | 'appendix-3' | 'addendum-3'
  change_type  text NOT NULL CHECK (change_type IN ('added', 'amended', 'removed')),
  old_text     jsonb,                     -- 조문 IR 스냅(비교 화면·대비표의 근거)
  new_text     jsonb,
  disadvantage int  NOT NULL DEFAULT 0,   -- 조항별 불이익 플래그
  reason       text,
  sort_order   int  NOT NULL DEFAULT 100
);
CREATE INDEX IF NOT EXISTS idx_rule_changes_amd ON rule_amendment_changes(amendment_id, sort_order);

-- ── 대상자별 동의 행 — 발송 시 선생성(leave_notices 방식) ──
-- 서명은 서버가 만든 '성명(사번) · ISO시각' 텍스트다(lib/payroll/sign.ts 관례. 이미지·IP 미보관).
CREATE TABLE IF NOT EXISTS rule_consents (
  consent_id      text PRIMARY KEY,
  amendment_id    text NOT NULL REFERENCES rule_amendments(amendment_id) ON DELETE CASCADE,
  employee_id     text NOT NULL,
  user_id         text,
  status          text NOT NULL DEFAULT 'sent'
                  CHECK (status IN ('sent', 'agreed', 'disagreed', 'exempt')),
  signature       text,
  consent_version text,                   -- 동의 고지문 판(overtime-consent CONSENT_VERSION 관례)
  opinion         text,                   -- 부동의 사유·의견 — 의견청취(§94 본문) 증빙 겸용
  sent_at         text NOT NULL,
  sent_by         text,
  submitted_at    text
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rule_consents_uniq ON rule_consents(amendment_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_rule_consents_emp ON rule_consents(employee_id, status);

-- ── 열람 확인 — board_post_reads 방식(읽은 사람만 행 생성) ──
CREATE TABLE IF NOT EXISTS rule_reads (
  version_id text NOT NULL REFERENCES rule_versions(version_id) ON DELETE CASCADE,
  user_id    text NOT NULL,
  read_at    text NOT NULL,
  PRIMARY KEY (version_id, user_id)
);
