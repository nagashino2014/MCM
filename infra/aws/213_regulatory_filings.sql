-- 213: 대외 신고 대기열(regulatory filings) — 통합환경허가시스템(IEPS)·엔지니어링종합정보시스템(ETIS) 신고 관리.
--  기술인력 변경신고(선임·해임·등급변경), 대행 실적 보고(체결·변경·이행), 엔지니어링 기술자 변경신고(입/퇴사·경력추가·종료)를
--  MCM 데이터(직원·인사이벤트·계약·참여인력)에서 파생해 대기열로 만들고, 사이트 양식 순서대로 정리한 값을 스냅샷으로 보관한다.
--  제출 자체는 각 사이트에서 사람이 한다(문자인증·공동인증서). 멱등.

-- ① 계약 — 대행 실적 보고 양식의 미보유 항목 2종
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS award_rate double precision,   -- (변경)낙찰률 (%)
  ADD COLUMN IF NOT EXISTS preconsult_notified_at text;   -- 사전협의 통보일자 (YYYY-MM-DD)

-- ② 직원 — 엔지니어링협회 회원번호(ETIS 기술자 선택 키)
ALTER TABLE employee_profiles
  ADD COLUMN IF NOT EXISTS etis_member_no text;

-- ③ 신고 대기열
CREATE TABLE IF NOT EXISTS regulatory_filings (
  filing_id      text PRIMARY KEY,
  filing_kind    text NOT NULL CHECK (filing_kind IN ('ieps_staff', 'ieps_agency', 'etis_career')),
  -- ieps_staff: appoint|dismiss|grade_change / ieps_agency: conclude|amend|complete / etis_career: join|leave|career_add|career_end
  trigger_kind   text NOT NULL,
  dedup_key      text NOT NULL UNIQUE,
  source         text NOT NULL DEFAULT 'derived' CHECK (source IN ('derived', 'event')),  -- derived=동기화로 재계산, event=저장 시점 기록
  employee_id    text REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  contract_id    text REFERENCES contracts(contract_id) ON DELETE CASCADE,
  title          text NOT NULL,          -- 목록 표시용(예: 강소현 — 해임)
  subtitle       text,                   -- 보조(계약명·사업장 등)
  occurred_on    text NOT NULL,          -- 사유 발생일 (YYYY-MM-DD)
  due_on         text,                   -- 신고 기한 (발생일 + 설정 일수)
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'skipped')),
  payload_json   jsonb NOT NULL,         -- { site, screen, fields:[{label,value}] } 사이트 양식 순서
  submitted_at   text,
  submitted_by   text REFERENCES users(user_id) ON DELETE SET NULL,
  receipt_no     text,                   -- 접수번호(선택)
  note           text,
  created_at     text NOT NULL,
  updated_at     text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_regulatory_filings_status ON regulatory_filings(status, due_on);
CREATE INDEX IF NOT EXISTS idx_regulatory_filings_employee ON regulatory_filings(employee_id);
CREATE INDEX IF NOT EXISTS idx_regulatory_filings_contract ON regulatory_filings(contract_id);

-- ④ 설정(KV, intel_settings 형태) — 기준일(이전 발생분은 대기열 제외)·종류별 기한 일수·알림 수신자
CREATE TABLE IF NOT EXISTS regulatory_filing_settings (
  setting_key  text PRIMARY KEY,
  setting_json jsonb NOT NULL,
  updated_at   text NOT NULL,
  updated_by   text
);
INSERT INTO regulatory_filing_settings (setting_key, setting_json, updated_at)
VALUES ('config', jsonb_build_object('cutoffOn', to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')), now()::text)
ON CONFLICT (setting_key) DO NOTHING;

-- ⑤ 권한
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('filing.view',   'filing', 'view',   '대외 신고 대기열 — 열람',               'all', 0, now()::text),
  ('filing.manage', 'filing', 'manage', '대외 신고 대기열 — 제출·제외 처리·설정', 'all', 0, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported,
  is_dangerous = EXCLUDED.is_dangerous;

-- 시스템 관리자 템플릿 grant 보충 — 누락 시 관리자조차 403
INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-sysadm-' || substr(md5(k.key), 1, 16), 'tpl-system-admin', k.key, 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES ('filing.view'), ('filing.manage')) AS k(key)
 WHERE EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-system-admin')
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = k.key
   );
