-- 084: 전자결재 코어(E-P1) — 양식(필드 스키마)·문서(구조화 값)·결재선·문서함 기반.
-- 설계: docs/e-approval-blueprint.md (v2 확정). 다우오피스 구조 차용 + 필드 완전 DB화.
-- 관례: text 타임스탬프, integer boolean, 멱등(IF NOT EXISTS / ON CONFLICT).

-- 1) 양식 폴더 트리
CREATE TABLE IF NOT EXISTS approval_form_folders (
  folder_id text PRIMARY KEY,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

-- 2) 양식 — fields jsonb 가 필드 스키마의 원본.
--    필드 정의: {key,label,type,required?,options?[],row,span?,placeholder?,content?,
--                minRows?,sumColumn?,tableColumns?[{key,label,type,options?}]}
--    type: text|multitext|number|currency|select|radio|checkbox|date|time|period|
--          user_select|dept_select|table|static (editor·contract_select 는 예약)
CREATE TABLE IF NOT EXISTS approval_forms (
  form_id text PRIMARY KEY,
  folder_id text REFERENCES approval_form_folders(folder_id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  doc_no_rule text,                 -- 문서번호 약칭(예: '출장신청' → 출장신청-2026-0001)
  retention_years integer,
  org_folder text,                  -- 완료 문서의 전사 문서함 이름
  dept_folder text,                 -- 완료 문서의 부서 문서함 이름
  auto_line jsonb,                  -- 자동 결재선 [{stepType,assigneeUserId?,byRole?}]
  mobile_allowed integer NOT NULL DEFAULT 1,
  use_yn integer NOT NULL DEFAULT 1,
  version integer NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  created_by text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

-- 2-1) 양식 버전 스냅샷 — 문서는 제출 당시 버전의 fields 로 렌더한다.
CREATE TABLE IF NOT EXISTS approval_form_versions (
  form_id text NOT NULL REFERENCES approval_forms(form_id) ON DELETE CASCADE,
  version integer NOT NULL,
  fields jsonb NOT NULL,
  saved_by text,
  saved_at text NOT NULL,
  PRIMARY KEY (form_id, version)
);

-- 3) 결재 문서 — field_values 가 구조화 데이터 원본(★다우 대비 핵심 개선).
CREATE TABLE IF NOT EXISTS approval_docs (
  doc_id text PRIMARY KEY,
  doc_no text,                      -- 상신 시 채번(임시저장은 NULL)
  form_id text NOT NULL REFERENCES approval_forms(form_id),
  form_version integer NOT NULL DEFAULT 1,
  title text NOT NULL,
  urgent integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',  -- draft|in_progress|approved|rejected|canceled
  drafter_user_id text,
  drafter_employee_id text,
  drafter_name text,                -- 제출 시점 스냅샷(자동 항목)
  drafter_position text,
  dept_id text,
  dept_name text,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at text,
  completed_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approval_docs_form ON approval_docs(form_id, status);
CREATE INDEX IF NOT EXISTS idx_approval_docs_drafter ON approval_docs(drafter_user_id, status);
CREATE INDEX IF NOT EXISTS idx_approval_docs_values ON approval_docs USING gin(field_values);

-- 4) 결재선 단계 — 합의(agree, 순차/병렬)·승인(approve). 병렬 합의는 동일 step_order 복수 행.
CREATE TABLE IF NOT EXISTS approval_steps (
  step_id text PRIMARY KEY,
  doc_id text NOT NULL REFERENCES approval_docs(doc_id) ON DELETE CASCADE,
  step_order integer NOT NULL,
  step_type text NOT NULL DEFAULT 'approve', -- agree|approve (전결 arbitrary 는 기능만: exclusive)
  mode text NOT NULL DEFAULT 'seq',          -- seq|parallel
  assignee_user_id text NOT NULL,
  assignee_name text,
  assignee_position text,
  status text NOT NULL DEFAULT 'waiting',    -- waiting|pending|approved|rejected|skipped
  acted_at text,
  comment text,
  delegated_from text,                       -- 대결 시 원 결재자 user_id
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approval_steps_doc ON approval_steps(doc_id, step_order);
CREATE INDEX IF NOT EXISTS idx_approval_steps_assignee ON approval_steps(assignee_user_id, status);

-- 5) 참조/열람
CREATE TABLE IF NOT EXISTS approval_watchers (
  watcher_id text PRIMARY KEY,
  doc_id text NOT NULL REFERENCES approval_docs(doc_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  kind text NOT NULL DEFAULT 'ref',          -- ref(참조)|view(열람)
  read_at text,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approval_watchers_user ON approval_watchers(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_approval_watchers_doc ON approval_watchers(doc_id);

-- 6) 개인 결재선 프리셋(나의 결재선)
CREATE TABLE IF NOT EXISTS approval_line_presets (
  preset_id text PRIMARY KEY,
  owner_user_id text NOT NULL,
  name text NOT NULL,
  line jsonb NOT NULL,                       -- [{stepType,mode,assigneeUserId}]
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approval_line_presets_owner ON approval_line_presets(owner_user_id);

-- 7) 대결자 지정 — 결재자가 승인된 휴가 기간 중이면 대결자에게 자동 라우팅(§8-4)
CREATE TABLE IF NOT EXISTS approval_delegates (
  user_id text PRIMARY KEY,
  delegate_user_id text NOT NULL,
  enabled integer NOT NULL DEFAULT 1,
  updated_at text NOT NULL
);

-- 8) 문서번호 채번(양식별·연도별) — 공문 {연도}-대외-{NNNNN} 규칙도 이 채번기로 통합 예정
CREATE TABLE IF NOT EXISTS doc_no_sequences (
  rule_key text NOT NULL,
  year text NOT NULL,
  last_seq integer NOT NULL DEFAULT 0,
  PRIMARY KEY (rule_key, year)
);

-- 9) 연차 대장(§8-5) — 부여/사용/조정 엔트리 누적. 휴가신청 승인 시 use 자동 적재.
CREATE TABLE IF NOT EXISTS annual_leave_ledger (
  entry_id text PRIMARY KEY,
  employee_id text NOT NULL,
  year text NOT NULL,
  entry_type text NOT NULL,                  -- grant|use|adjust
  days double precision NOT NULL,
  doc_id text,                               -- 사용 엔트리의 승인 문서 연결
  note text,
  created_by text,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_annual_leave_emp ON annual_leave_ledger(employee_id, year);

-- 10) 권한 카탈로그
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('approval.view',   'approval', 'view',   '전자결재 문서 열람·기안',      'self,self_dept,all', 0, now()::text),
  ('approval.act',    'approval', 'act',    '결재 처리(승인·반려)',          'self',               0, now()::text),
  ('approval.manage', 'approval', 'manage', '전자결재 양식·운영 관리',       'all',                1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported,
  is_dangerous = EXCLUDED.is_dangerous;

-- 11) 폴더·양식 5종 시드(E-P0 실측 — 블루프린트 §7-1). 사용자가 빌더에서 수정할 원안이므로
--     재적용 시 덮어쓰지 않는다(ON CONFLICT DO NOTHING).
INSERT INTO approval_form_folders (folder_id, name, sort_order, created_at, updated_at)
VALUES
  ('fld-hr',      '인사',   1, now()::text, now()::text),
  ('fld-biz',     '업무',   2, now()::text, now()::text),
  ('fld-finance', '회계',   3, now()::text, now()::text)
ON CONFLICT (folder_id) DO NOTHING;

INSERT INTO approval_forms
  (form_id, folder_id, name, description, fields, doc_no_rule, retention_years, org_folder, dept_folder, sort_order, created_at, updated_at)
VALUES
  ('frm-biz-trip-request', 'fld-biz', '국내 출장 신청', '국내 출장 신청서(다우 양식 이관)',
   '[
     {"key":"trip_period","label":"출장기간","type":"period","required":true,"row":1,"span":1},
     {"key":"trip_class","label":"출장분류","type":"select","options":["일반(당일 복귀)","숙박 출장","교육/세미나","기타"],"row":1,"span":1},
     {"key":"destination","label":"출장지","type":"text","required":true,"row":1,"span":1},
     {"key":"transport","label":"교통편(복수 이용 시 모두 선택)","type":"checkbox","options":["법인차량","KTX","고속버스","대중교통(버스, 지하철)","택시","렌터카","항공기","자차"],"row":2,"span":3},
     {"key":"car_name","label":"이용차량(법인 차량 이용 시)","type":"select","options":["카니발(예시)","스타렉스(예시)"],"row":3,"span":1},
     {"key":"car_time","label":"이용시간","type":"radio","options":["종일","오전","오후"],"row":3,"span":1},
     {"key":"depart_time","label":"출장 출발 시각","type":"time","row":3,"span":1},
     {"key":"contract_class","label":"계약 구분","type":"checkbox","options":["통합환경허가","장외&화관법","HAPs","Etc."],"row":4,"span":2},
     {"key":"contract_name","label":"계약명","type":"text","row":4,"span":1},
     {"key":"companions","label":"동행자","type":"text","row":5,"span":3},
     {"key":"purpose","label":"출장목적(상세 기술)","type":"multitext","required":true,"row":6,"span":3},
     {"key":"notice","label":"안내","type":"static","content":"※ 출장 경비 지급 기준은 한국환경안전연구원 사규 [별표 1. 지출증빙 및 지급 기준] 을 준용한다.","row":7,"span":3}
   ]'::jsonb,
   '출장신청', 3, '출장 문서', '출장 문서', 1, now()::text, now()::text),

  ('frm-biz-trip-report', 'fld-biz', '출장보고서', '출장 결과 보고(전 본부 공통 — 일정 반복 행)',
   '[
     {"key":"trip_period","label":"출장일자","type":"period","required":true,"row":1,"span":2},
     {"key":"service_class","label":"용역분류","type":"checkbox","options":["통합","화관법","HAPs","기타"],"row":1,"span":1},
     {"key":"schedules","label":"일정","type":"table","row":2,"span":3,"minRows":2,"tableColumns":[
       {"key":"date","label":"일자","type":"date"},
       {"key":"time","label":"시각","type":"text"},
       {"key":"place","label":"방문지","type":"text"},
       {"key":"companions","label":"동행자","type":"text"}
     ]},
     {"key":"visit_purpose","label":"방문목적","type":"text","row":3,"span":3},
     {"key":"receiver","label":"접견인","type":"text","row":4,"span":3},
     {"key":"detail","label":"출장내용(상세 기술)","type":"multitext","required":true,"row":5,"span":3}
   ]'::jsonb,
   '출장보고', 3, '출장 문서', '출장 문서', 2, now()::text, now()::text),

  ('frm-overtime-request', 'fld-hr', '초과/휴일근무 신청', '초과·휴일근무 사전 신청',
   '[
     {"key":"project_name","label":"담당 프로젝트(용역명)","type":"text","required":true,"row":1,"span":3},
     {"key":"company_name","label":"업체명","type":"text","required":true,"row":2,"span":2},
     {"key":"service_class","label":"용역분류","type":"select","options":["통합환경허가","장외&화관법","HAPs","기타"],"row":2,"span":1},
     {"key":"work_period","label":"일시","type":"period","required":true,"row":3,"span":2},
     {"key":"work_time","label":"시간","type":"text","placeholder":"예: 18:30 ~ 21:30","row":3,"span":1},
     {"key":"used_hours","label":"기사용시간","type":"number","row":4,"span":1},
     {"key":"apply_hours","label":"신청시간","type":"number","row":4,"span":1},
     {"key":"remain_hours","label":"잔여시간","type":"number","row":4,"span":1},
     {"key":"reason","label":"사유(구체적으로 기술할 것)","type":"multitext","required":true,"row":5,"span":3}
   ]'::jsonb,
   '초과근무', 3, '근태 문서', '근태 문서', 1, now()::text, now()::text),

  ('frm-expense-report', 'fld-finance', '지출 결의서(법인카드)', '법인카드 사용 내역 결의 — 내역 반복 행+합계 자동',
   '[
     {"key":"expenses","label":"사용 내역","type":"table","row":1,"span":3,"minRows":3,"sumColumn":"amount","tableColumns":[
       {"key":"used_on","label":"사용일","type":"date"},
       {"key":"vendor","label":"사용처(전표상 상호)","type":"text"},
       {"key":"category","label":"지출 항목 구분","type":"select","options":["식대","교통비","유류비","소모품비","접대비","교육비","기타"]},
       {"key":"detail","label":"사용내역(상세하게 기재)","type":"text"},
       {"key":"amount","label":"사용금액","type":"currency"},
       {"key":"note","label":"비고","type":"text"}
     ]}
   ]'::jsonb,
   '지출결의', 5, '회계 문서', '회계 문서', 1, now()::text, now()::text),

  ('frm-leave-request', 'fld-hr', '휴가신청서', '휴가 신청 — 승인 시 연차 대장 자동 차감(E-P3)',
   '[
     {"key":"leave_type","label":"휴가 종류","type":"select","required":true,"options":["연차","반차(오전)","반차(오후)","경조휴가","예비군/민방위","병가","기타"],"row":1,"span":3},
     {"key":"leave_period","label":"휴가 기간","type":"period","required":true,"row":2,"span":2},
     {"key":"use_days","label":"사용일수(일)","type":"number","row":2,"span":1},
     {"key":"reason","label":"휴가 사유","type":"multitext","required":true,"row":3,"span":3},
     {"key":"notice","label":"안내","type":"static","content":"[당일 반차 신청시] 시작일만 오전/오후 체크\n[예비군/민방위 신청시] 통지서 스캔하여 파일 첨부\n[경조휴가 신청시] 증빙서류 스캔하여 파일 첨부 (예: 청첩장 등본 등)","row":4,"span":3}
   ]'::jsonb,
   '휴가신청', 3, '근태 문서', '근태 문서', 2, now()::text, now()::text)
ON CONFLICT (form_id) DO NOTHING;

-- 시드 양식의 v1 스냅샷
INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, 1, fields, NULL, now()::text FROM approval_forms
WHERE form_id IN ('frm-biz-trip-request','frm-biz-trip-report','frm-overtime-request','frm-expense-report','frm-leave-request')
ON CONFLICT (form_id, version) DO NOTHING;
