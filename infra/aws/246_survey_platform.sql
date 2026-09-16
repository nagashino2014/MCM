-- 246: 설문 — 사내 설문(앱 내부 응답 수집) · 외부 설문(구글 폼 링크 + QR 배포 이미지).
-- 화면: /survey/internal(사내 목록) · /survey/internal/[surveyId]/edit(빌더) · /survey/internal/[surveyId]/respond(응답)
--       /survey/internal/[surveyId]/results(집계) · /survey/external(외부 목록) · .../notice(QR 배포 이미지 편집기)
-- 모델: 설문(surveys) 1 : N 문항(survey_questions), 응답(survey_responses) 1 : N 답(survey_answers).
--   외부 설문은 앱에서 초안만 작성하고 실제 응답은 구글 폼이 받는다(google_* 컬럼에 연결 정보 보관).
--   배포 이미지(survey_notices)는 필드 기반 — 레이아웃 프리셋(phone/mail) + fields jsonb(문구·로고·QR·CI 색상).
-- 번호: 원격 전 브랜치 최대가 225 이나, 진행 중인 재무 패키지(로컬 브랜치)가 245 까지 사용해 246 부터 잡는다.
-- 멱등.

-- ── 권한키 ──
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('survey.view',   'survey', 'view',   '설문 — 설문·응답 현황·집계 열람',                     'all', 0, now()::text),
  ('survey.manage', 'survey', 'manage', '설문 — 설문 작성·배포·마감·삭제, 배포 이미지 편집',   'all', 1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

-- 시스템 관리자 템플릿(tpl-system-admin) grant 보충 — 누락 시 관리자조차 403(role 우회가 없다).
INSERT INTO permission_template_grants
  (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-sysadm-' || substr(md5(k.key), 1, 16), 'tpl-system-admin', k.key, 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES ('survey.view'), ('survey.manage')) AS k(key)
 WHERE EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-system-admin')
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = k.key
   );

-- ── 설문 ──
-- kind: internal(사내 — 앱 내부 응답) / external(외부 — 구글 폼 응답)
-- status: draft(작성 중) / open(응답 접수) / closed(마감)
CREATE TABLE IF NOT EXISTS surveys (
  survey_id       text  PRIMARY KEY,
  kind            text  NOT NULL CHECK (kind IN ('internal', 'external')),
  title           text  NOT NULL,
  description     text,                      -- 응답 화면 상단 안내문(설문 취지)
  status          text  NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  is_anonymous    int   NOT NULL DEFAULT 0,  -- 1이면 집계에서 응답자 식별 정보를 노출하지 않는다
  period_start    text,                      -- YYYY-MM-DD. 접수 기간(둘 다 비면 상시)
  period_end      text,
  -- 사내 설문 대상 — {"scope":"all"} | {"scope":"departments","departments":["경영지원팀",...]}
  audience        jsonb NOT NULL DEFAULT '{"scope":"all"}'::jsonb,
  -- 외부 설문 구글 폼 연결(2단계 자동 생성 전에는 수동 입력)
  google_form_url      text,                 -- 응답 URL(QR 대상)
  google_form_edit_url text,                 -- 편집 URL(작성자 확인용)
  google_form_id       text,
  google_script_id     text,                 -- Apps Script 프로젝트 id(자동 생성 경로에서 기록)
  google_synced_at     text,
  created_at      text  NOT NULL,
  created_by      text,
  updated_at      text  NOT NULL,
  updated_by      text,
  deleted_at      text
);
CREATE INDEX IF NOT EXISTS idx_surveys_live ON surveys(kind, status) WHERE deleted_at IS NULL;

-- ── 문항 ──
-- qtype: single(객관식 단일) / multi(복수 선택) / scale(척도) / text(단답) / longtext(서술) / section(설명 블록)
-- options: [{"value":"opt1","label":"..."}] — single/multi 전용. config: 척도 설정 등 {"min":1,"max":5,"minLabel":"","maxLabel":"","allowOther":false}
CREATE TABLE IF NOT EXISTS survey_questions (
  question_id text  PRIMARY KEY,
  survey_id   text  NOT NULL REFERENCES surveys(survey_id) ON DELETE CASCADE,
  seq         int   NOT NULL,
  qtype       text  NOT NULL CHECK (qtype IN ('single', 'multi', 'scale', 'text', 'longtext', 'section')),
  title       text  NOT NULL,
  help_text   text,
  is_required int   NOT NULL DEFAULT 0,
  options     jsonb NOT NULL DEFAULT '[]'::jsonb,
  config      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_survey_questions_survey ON survey_questions(survey_id, seq);

-- ── 응답(사내 전용) ──
-- user_id 는 익명 설문에서도 채워 넣어 중복 응답을 막되, 집계 API 가 is_anonymous 를 보고 노출을 차단한다.
CREATE TABLE IF NOT EXISTS survey_responses (
  response_id  text  PRIMARY KEY,
  survey_id    text  NOT NULL REFERENCES surveys(survey_id) ON DELETE CASCADE,
  user_id      text,
  submitted_at text  NOT NULL,
  source       text  NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'mobile'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_survey_responses_user
  ON survey_responses(survey_id, user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS survey_answers (
  response_id text  NOT NULL REFERENCES survey_responses(response_id) ON DELETE CASCADE,
  question_id text  NOT NULL REFERENCES survey_questions(question_id) ON DELETE CASCADE,
  -- 답 형태는 문항 유형에 따라 다르다: single=문자열, multi=문자열 배열, scale=숫자, text/longtext=문자열
  value       jsonb NOT NULL,
  PRIMARY KEY (response_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_survey_answers_question ON survey_answers(question_id);

-- ── QR 배포 이미지 ──
-- layout: phone(1080×1920 세로 배포용) / mail(1600×900 메일 첨부용)
-- fields: {badgeText, badgeTone, title, description, periodText, durationText, hostMain, hostSub, hostNote, qrCaption,
--          logoDataUrl, qrDataUrl, targetOrg} — 편집기 폼과 1:1
-- theme:  {bandColors:["#1EA5E0","#8CC63F","#FFD400"], accent, ink} — 로고 CI 색상 자동 검출 결과가 bandColors 로 들어온다
CREATE TABLE IF NOT EXISTS survey_notices (
  notice_id  text  PRIMARY KEY,
  survey_id  text  REFERENCES surveys(survey_id) ON DELETE CASCADE,
  name       text  NOT NULL,
  layout     text  NOT NULL DEFAULT 'phone' CHECK (layout IN ('phone', 'mail')),
  fields     jsonb NOT NULL DEFAULT '{}'::jsonb,
  theme      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at text  NOT NULL,
  created_by text,
  updated_at text  NOT NULL,
  updated_by text,
  deleted_at text
);
CREATE INDEX IF NOT EXISTS idx_survey_notices_survey ON survey_notices(survey_id) WHERE deleted_at IS NULL;
