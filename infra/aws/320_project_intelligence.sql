-- RAG 영업 발굴 F02~F07. 공개 투자프로젝트와 내부 영업건의 식별자를 분리한다.
BEGIN;
CREATE TABLE IF NOT EXISTS intel_facility_candidates (
  candidate_id text PRIMARY KEY, company_name text NOT NULL, site_address text, industry text,
  business_registration_no text, evidence jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_review','linked_existing','registered','hold','rejected')),
  reason text, review_at date, facility_id text REFERENCES facilities(facility_id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0), candidate_key text UNIQUE,
  owning_dept_id text REFERENCES departments(dept_id) ON DELETE SET NULL,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS intel_projects (
  project_id text PRIMARY KEY, title text NOT NULL, company_name text,
  facility_id text REFERENCES facilities(facility_id) ON DELETE RESTRICT,
  candidate_id text REFERENCES intel_facility_candidates(candidate_id) ON DELETE RESTRICT,
  industry text, region text, stage text NOT NULL DEFAULT 'unknown'
    CHECK(stage IN ('unknown','mou','announced','approved','permitting','construction','operating','delayed','suspended','canceled')),
  amount numeric CHECK(amount >= 0), currency text NOT NULL DEFAULT 'KRW', amount_scope text NOT NULL DEFAULT 'unknown',
  public_summary text, expected_start_at date, expected_end_at date,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0), state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','merged','archived')),
  merged_into_id text REFERENCES intel_projects(project_id) ON DELETE RESTRICT,
  ingestion_key text UNIQUE, owning_dept_id text REFERENCES departments(dept_id) ON DELETE SET NULL,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(expected_start_at IS NULL OR expected_end_at IS NULL OR expected_start_at <= expected_end_at),
  CHECK((state = 'merged') = (merged_into_id IS NOT NULL)), CHECK(merged_into_id IS NULL OR merged_into_id <> project_id)
);
CREATE INDEX IF NOT EXISTS ix_intel_projects_filter ON intel_projects(state, industry, region, updated_at);
ALTER TABLE intel_projects ADD COLUMN IF NOT EXISTS source_checked_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS ix_intel_projects_facility ON intel_projects(facility_id);
CREATE TABLE IF NOT EXISTS intel_project_signals (
  project_id text NOT NULL REFERENCES intel_projects(project_id) ON DELETE RESTRICT,
  signal_id text NOT NULL REFERENCES intel_signals(signal_id) ON DELETE RESTRICT,
  reason text NOT NULL, reviewed boolean NOT NULL DEFAULT false,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(project_id, signal_id)
);
CREATE INDEX IF NOT EXISTS ix_intel_project_signals_signal ON intel_project_signals(signal_id);
CREATE TABLE IF NOT EXISTS intel_project_events (
  event_id text PRIMARY KEY, project_id text NOT NULL REFERENCES intel_projects(project_id) ON DELETE RESTRICT,
  event_type text NOT NULL, version integer NOT NULL CHECK(version > 0), title text NOT NULL,
  occurred_at date, discovered_at timestamptz NOT NULL DEFAULT now(),
  before_json jsonb NOT NULL DEFAULT '{}', after_json jsonb NOT NULL DEFAULT '{}',
  evidence_signal_ids text[] NOT NULL DEFAULT '{}', revision_ids text[] NOT NULL DEFAULT '{}',
  mode text NOT NULL DEFAULT 'live' CHECK(mode IN ('live','initial_backfill','replay')),
  confirmed boolean NOT NULL DEFAULT false, corrects_event_id text REFERENCES intel_project_events(event_id),
  event_key text NOT NULL, created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  UNIQUE(project_id, event_key), UNIQUE(project_id, version)
);
CREATE INDEX IF NOT EXISTS ix_intel_project_events_discovered ON intel_project_events(discovered_at, event_id);
CREATE TABLE IF NOT EXISTS intel_service_assessments (
  assessment_id text PRIMARY KEY, project_id text NOT NULL REFERENCES intel_projects(project_id) ON DELETE RESTRICT,
  project_version integer NOT NULL, service_code text NOT NULL CHECK(service_code IN ('integrated_permit','chem','haps','esg','etc')),
  basis text NOT NULL DEFAULT 'public' CHECK(basis = 'public'), assessment jsonb NOT NULL,
  rule_version text NOT NULL, assessed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, project_version, service_code, rule_version)
);
CREATE TABLE IF NOT EXISTS intel_priority_assessments (
  assessment_id text PRIMARY KEY, project_id text NOT NULL REFERENCES intel_projects(project_id) ON DELETE RESTRICT,
  project_version integer NOT NULL, basis text NOT NULL DEFAULT 'public' CHECK(basis = 'public'),
  assessment jsonb NOT NULL, rule_version text NOT NULL, as_of date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(project_id, project_version, rule_version, as_of)
);
CREATE TABLE IF NOT EXISTS intel_business_links (
  link_id text PRIMARY KEY, project_id text NOT NULL REFERENCES intel_projects(project_id) ON DELETE RESTRICT,
  sales_project_id text REFERENCES sales_projects(project_id) ON DELETE RESTRICT,
  contract_id text REFERENCES contracts(contract_id) ON DELETE RESTRICT,
  service_code text, scope_key text, created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(num_nonnulls(sales_project_id, contract_id) = 1),
  UNIQUE(project_id, sales_project_id), UNIQUE(project_id, contract_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_intel_business_links_scope ON intel_business_links(project_id, service_code, scope_key)
  WHERE sales_project_id IS NOT NULL AND scope_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS intel_action_suggestions (
  action_id text PRIMARY KEY, project_id text NOT NULL REFERENCES intel_projects(project_id) ON DELETE RESTRICT,
  title text NOT NULL, activity_type text NOT NULL CHECK(activity_type IN ('telemarketing','email','visit','site_briefing','quote','proposal_meeting','bid')),
  assignee_employee_id text REFERENCES employee_profiles(employee_id) ON DELETE SET NULL,
  scheduled_at text, ended_at text, status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','hold','rejected','accepted')),
  reason text, evidence_signal_ids text[] NOT NULL DEFAULT '{}',
  sales_project_id text REFERENCES sales_projects(project_id) ON DELETE RESTRICT,
  sales_activity_id text UNIQUE REFERENCES sales_activities(activity_id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1, created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((status = 'accepted') = (sales_activity_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS intel_operation_keys (
  operation_scope text NOT NULL, request_key text NOT NULL, actor_user_id text NOT NULL REFERENCES users(user_id),
  request_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(operation_scope, request_key)
);
-- 개인의 영업 검토 판단은 공용 점수·보고서에 반영하지 않는다.
CREATE TABLE IF NOT EXISTS intel_manual_priorities (
  project_id text NOT NULL REFERENCES intel_projects(project_id) ON DELETE RESTRICT,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  priority text NOT NULL CHECK(priority IN ('high','normal','low')),
  reason text NOT NULL CHECK(length(trim(reason))>0), actor_name text NOT NULL,
  project_version integer NOT NULL CHECK(project_version>0), rule_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(project_id,user_id)
);
-- 이미 영업건으로 전환된 과거 신호는 새로운 영업건을 만들지 않고 기존 연결을 복원한다.
INSERT INTO intel_projects(project_id,title,company_name,facility_id,industry,public_summary,ingestion_key,created_at,updated_at)
SELECT 'ip_legacy_' || md5(s.signal_id), COALESCE(s.report_name,s.company_name,'기존 영업 신호'), s.company_name,
  s.facility_id,s.industry,s.summary,'signal:' || s.signal_id,now(),now()
FROM intel_signals s JOIN sales_projects p ON p.project_id=s.linked_project_id
ON CONFLICT(ingestion_key) DO NOTHING;
INSERT INTO intel_project_signals(project_id,signal_id,reason,reviewed)
SELECT p.project_id,s.signal_id,'기존 영업 전환 연결 복원',true FROM intel_signals s JOIN intel_projects p ON p.ingestion_key='signal:'||s.signal_id
WHERE s.linked_project_id IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO intel_business_links(link_id,project_id,sales_project_id)
SELECT 'ibl_legacy_'||md5(s.signal_id),p.project_id,s.linked_project_id FROM intel_signals s
JOIN intel_projects p ON p.ingestion_key='signal:'||s.signal_id JOIN sales_projects sp ON sp.project_id=s.linked_project_id
ON CONFLICT DO NOTHING;
COMMIT;
