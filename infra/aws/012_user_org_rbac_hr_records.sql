-- User organization, RBAC templates, and HR records.
-- Applies on top of 001_initial_schema.sql.

CREATE TABLE IF NOT EXISTS departments (
  dept_id text PRIMARY KEY,
  dept_name text NOT NULL,
  dept_kind text NOT NULL DEFAULT 'division',
  parent_dept_id text REFERENCES departments(dept_id) ON DELETE SET NULL,
  display_order integer NOT NULL DEFAULT 100,
  accent_color text,
  is_active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_departments_parent
  ON departments(parent_dept_id);
CREATE INDEX IF NOT EXISTS idx_departments_order
  ON departments(display_order);

CREATE TABLE IF NOT EXISTS positions (
  position_id text PRIMARY KEY,
  position_name text NOT NULL UNIQUE,
  rank_order integer NOT NULL,
  is_active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS department_positions (
  dept_id text NOT NULL REFERENCES departments(dept_id) ON DELETE CASCADE,
  position_id text NOT NULL REFERENCES positions(position_id) ON DELETE CASCADE,
  display_order integer NOT NULL DEFAULT 100,
  PRIMARY KEY (dept_id, position_id)
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS dept_id text REFERENCES departments(dept_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS position_id text REFERENCES positions(position_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS employee_id text,
  ADD COLUMN IF NOT EXISTS hired_at text,
  ADD COLUMN IF NOT EXISTS company_phone text;

CREATE INDEX IF NOT EXISTS idx_users_dept
  ON users(dept_id);
CREATE INDEX IF NOT EXISTS idx_users_position
  ON users(position_id);
CREATE INDEX IF NOT EXISTS idx_users_employee
  ON users(employee_id);

CREATE TABLE IF NOT EXISTS permissions (
  permission_key text PRIMARY KEY,
  module text NOT NULL,
  action text NOT NULL,
  description text NOT NULL,
  scopes_supported text NOT NULL DEFAULT 'self,self_dept,specific_dept,all',
  is_dangerous integer NOT NULL DEFAULT 0,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS permission_templates (
  template_id text PRIMARY KEY,
  template_name text NOT NULL,
  description text,
  is_system integer NOT NULL DEFAULT 0,
  is_active integer NOT NULL DEFAULT 1,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_permission_templates_active
  ON permission_templates(is_active);

CREATE TABLE IF NOT EXISTS permission_template_grants (
  grant_id text PRIMARY KEY,
  template_id text NOT NULL REFERENCES permission_templates(template_id) ON DELETE CASCADE,
  permission_key text NOT NULL REFERENCES permissions(permission_key) ON DELETE CASCADE,
  scope_kind text NOT NULL CHECK (scope_kind IN ('self', 'self_dept', 'specific_dept', 'all')),
  scope_dept_id text REFERENCES departments(dept_id) ON DELETE SET NULL,
  effect text NOT NULL DEFAULT 'allow' CHECK (effect IN ('allow', 'deny')),
  conditions_json jsonb,
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_permission_template_grants_template
  ON permission_template_grants(template_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_permission_template_grants_unique
  ON permission_template_grants(template_id, permission_key, scope_kind, COALESCE(scope_dept_id, '__null__'));

CREATE TABLE IF NOT EXISTS user_permission_assignments (
  assignment_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  template_id text NOT NULL REFERENCES permission_templates(template_id) ON DELETE CASCADE,
  scope_override_kind text CHECK (scope_override_kind IN ('self', 'self_dept', 'specific_dept', 'all')),
  scope_override_dept_id text REFERENCES departments(dept_id) ON DELETE SET NULL,
  effective_from text NOT NULL,
  effective_to text,
  reason text,
  assigned_by text REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_at text NOT NULL,
  revoked_at text,
  revoked_by text REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_permission_assignments_user
  ON user_permission_assignments(user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_user_permission_assignments_template
  ON user_permission_assignments(template_id);

CREATE TABLE IF NOT EXISTS position_default_templates (
  position_id text NOT NULL REFERENCES positions(position_id) ON DELETE CASCADE,
  template_id text NOT NULL REFERENCES permission_templates(template_id) ON DELETE CASCADE,
  scope_kind_default text CHECK (scope_kind_default IN ('self', 'self_dept', 'specific_dept', 'all')),
  scope_dept_default text REFERENCES departments(dept_id) ON DELETE SET NULL,
  PRIMARY KEY (position_id, template_id)
);

CREATE TABLE IF NOT EXISTS employee_profiles (
  employee_id text PRIMARY KEY,
  user_id text REFERENCES users(user_id) ON DELETE SET NULL,
  employee_no text,
  name text NOT NULL,
  dept_id text REFERENCES departments(dept_id) ON DELETE SET NULL,
  position_id text REFERENCES positions(position_id) ON DELETE SET NULL,
  hired_at text,
  job_duties text,
  address text,
  resident_registration_encrypted text,
  resident_registration_masked text,
  birth_date text,
  gender text CHECK (gender IN ('male', 'female')),
  nationality_kind text NOT NULL DEFAULT 'domestic' CHECK (nationality_kind IN ('domestic', 'foreign')),
  mobile_phone text,
  email text,
  company_phone text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  memo text,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employee_profiles_user
  ON employee_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_dept
  ON employee_profiles(dept_id);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_position
  ON employee_profiles(position_id);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_status
  ON employee_profiles(status);

CREATE TABLE IF NOT EXISTS employee_educations (
  education_id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  degree_level text NOT NULL CHECK (degree_level IN ('bachelor', 'master', 'doctor')),
  school_name text NOT NULL,
  major text,
  degree_name text,
  admission_date text,
  graduation_date text,
  display_order integer NOT NULL DEFAULT 100,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employee_educations_employee
  ON employee_educations(employee_id);

CREATE TABLE IF NOT EXISTS employee_certifications (
  certification_id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  certification_name text NOT NULL,
  passed_at text,
  issued_at text,
  certification_no text,
  display_order integer NOT NULL DEFAULT 100,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employee_certifications_employee
  ON employee_certifications(employee_id);

CREATE TABLE IF NOT EXISTS employee_careers (
  career_id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  worked_from text,
  worked_to text,
  company_name text,
  final_position text,
  responsibilities text,
  display_order integer NOT NULL DEFAULT 100,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employee_careers_employee
  ON employee_careers(employee_id);

CREATE TABLE IF NOT EXISTS employee_housing_supports (
  housing_id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  lease_started_at text,
  lease_ended_at text,
  monthly_rent double precision,
  deposit_amount double precision,
  address text,
  landlord_name text,
  memo text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employee_housing_supports_employee
  ON employee_housing_supports(employee_id);

CREATE TABLE IF NOT EXISTS employee_documents (
  document_id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  target_table text NOT NULL,
  target_id text,
  document_type text NOT NULL,
  display_name text NOT NULL,
  original_filename text,
  content_type text,
  byte_size bigint,
  sha256 text,
  storage_provider text NOT NULL DEFAULT 's3',
  storage_bucket text,
  storage_key text NOT NULL,
  public_path text,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_employee
  ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_target
  ON employee_documents(target_table, target_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_type
  ON employee_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_employee_documents_sha256
  ON employee_documents(sha256);

INSERT INTO positions (position_id, position_name, rank_order, is_active, created_at, updated_at)
VALUES
  ('ceo', '대표이사', 100, 1, now()::text, now()::text),
  ('executive-director', '전무', 95, 1, now()::text, now()::text),
  ('senior-managing-director', '상무', 90, 1, now()::text, now()::text),
  ('general-director', '총괄본부장', 86, 1, now()::text, now()::text),
  ('director', '이사', 84, 1, now()::text, now()::text),
  ('lab-director', '연구소장', 82, 1, now()::text, now()::text),
  ('ulsan-branch-head', '울산지사장', 80, 1, now()::text, now()::text),
  ('general-manager', '부장', 70, 1, now()::text, now()::text),
  ('advisor', '전문위원', 65, 1, now()::text, now()::text),
  ('deputy-general-manager', '차장', 60, 1, now()::text, now()::text),
  ('manager', '과장', 50, 1, now()::text, now()::text),
  ('assistant-manager', '대리', 40, 1, now()::text, now()::text),
  ('staff', '사원', 30, 1, now()::text, now()::text),
  ('senior-researcher', '선임연구원', 45, 1, now()::text, now()::text),
  ('associate-researcher', '주임연구원', 35, 1, now()::text, now()::text)
ON CONFLICT (position_id) DO UPDATE SET
  position_name = EXCLUDED.position_name,
  rank_order = EXCLUDED.rank_order,
  is_active = EXCLUDED.is_active,
  updated_at = now()::text;

INSERT INTO departments (dept_id, dept_name, dept_kind, parent_dept_id, display_order, accent_color, is_active, created_at, updated_at)
VALUES
  ('exec', '총괄', 'executive', NULL, 10, '#FF8585', 1, now()::text, now()::text),
  ('sales-management', '영업관리본부', 'division', NULL, 20, '#60A5FA', 1, now()::text, now()::text),
  ('integrated-env-1', '통합환경1본부', 'division', NULL, 30, '#FB923C', 1, now()::text, now()::text),
  ('integrated-env-2', '통합환경2본부', 'division', NULL, 40, '#FB923C', 1, now()::text, now()::text),
  ('chemical-safety', '화학안전본부', 'division', NULL, 50, '#FACC15', 1, now()::text, now()::text),
  ('carbon-neutral-lab', '탄소중립미래연구소', 'lab', NULL, 60, '#A9D08E', 1, now()::text, now()::text),
  ('ulsan-branch', '울산지사', 'branch', NULL, 70, '#93C5FD', 1, now()::text, now()::text)
ON CONFLICT (dept_id) DO UPDATE SET
  dept_name = EXCLUDED.dept_name,
  dept_kind = EXCLUDED.dept_kind,
  parent_dept_id = EXCLUDED.parent_dept_id,
  display_order = EXCLUDED.display_order,
  accent_color = EXCLUDED.accent_color,
  is_active = EXCLUDED.is_active,
  updated_at = now()::text;

INSERT INTO department_positions (dept_id, position_id, display_order)
SELECT d.dept_id, p.position_id, p.rank_order
FROM departments d
CROSS JOIN positions p
WHERE d.dept_id <> 'carbon-neutral-lab'
ON CONFLICT (dept_id, position_id) DO NOTHING;

INSERT INTO department_positions (dept_id, position_id, display_order)
VALUES
  ('carbon-neutral-lab', 'lab-director', 82),
  ('carbon-neutral-lab', 'senior-researcher', 45),
  ('carbon-neutral-lab', 'associate-researcher', 35),
  ('carbon-neutral-lab', 'staff', 30)
ON CONFLICT (dept_id, position_id) DO NOTHING;

INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('rbac.template.manage', 'rbac', 'template.manage', '권한 템플릿 생성·수정·비활성화', 'all', 1, now()::text),
  ('rbac.assignment.manage', 'rbac', 'assignment.manage', '사용자 권한 템플릿 적용·취소', 'all,specific_dept,self_dept', 1, now()::text),
  ('staffing.view', 'staffing', 'view', '인사 정보 조회', 'self,self_dept,specific_dept,all', 0, now()::text),
  ('staffing.edit', 'staffing', 'edit', '인사 정보 등록·수정', 'self_dept,specific_dept,all', 1, now()::text),
  ('staffing.documents.manage', 'staffing', 'documents.manage', '인사 증빙 서류 업로드·삭제', 'self_dept,specific_dept,all', 1, now()::text),
  ('contract.view', 'contract', 'view', '계약 정보 조회', 'self_dept,specific_dept,all', 0, now()::text),
  ('contract.edit', 'contract', 'edit', '계약 정보 등록·수정', 'self_dept,specific_dept,all', 1, now()::text),
  ('data.review', 'data', 'review', '수집 데이터 검수', 'all', 0, now()::text),
  ('audit.read', 'audit', 'read', '감사 로그 조회', 'all', 1, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported,
  is_dangerous = EXCLUDED.is_dangerous;

INSERT INTO permission_templates (template_id, template_name, description, is_system, is_active, created_by, created_at, updated_at)
VALUES
  ('tpl-admin-rbac', '시스템 관리자', '권한 템플릿과 전사 인사 정보를 관리합니다.', 1, 1, NULL, now()::text, now()::text),
  ('tpl-dept-lead', '부서장', '본인 소속 부서의 인사·계약 정보를 조회하고 일부 수정합니다.', 1, 1, NULL, now()::text, now()::text),
  ('tpl-staff-basic', '일반 직원', '본인 정보와 기본 업무 정보를 조회합니다.', 1, 1, NULL, now()::text, now()::text)
ON CONFLICT (template_id) DO UPDATE SET
  template_name = EXCLUDED.template_name,
  description = EXCLUDED.description,
  is_system = EXCLUDED.is_system,
  is_active = EXCLUDED.is_active,
  updated_at = now()::text;

INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, scope_dept_id, effect, conditions_json, created_at)
VALUES
  ('grant-admin-rbac-template', 'tpl-admin-rbac', 'rbac.template.manage', 'all', NULL, 'allow', NULL, now()::text),
  ('grant-admin-rbac-assignment', 'tpl-admin-rbac', 'rbac.assignment.manage', 'all', NULL, 'allow', NULL, now()::text),
  ('grant-admin-staffing-view', 'tpl-admin-rbac', 'staffing.view', 'all', NULL, 'allow', NULL, now()::text),
  ('grant-admin-staffing-edit', 'tpl-admin-rbac', 'staffing.edit', 'all', NULL, 'allow', NULL, now()::text),
  ('grant-admin-docs', 'tpl-admin-rbac', 'staffing.documents.manage', 'all', NULL, 'allow', NULL, now()::text),
  ('grant-lead-staffing-view', 'tpl-dept-lead', 'staffing.view', 'self_dept', NULL, 'allow', NULL, now()::text),
  ('grant-lead-contract-view', 'tpl-dept-lead', 'contract.view', 'self_dept', NULL, 'allow', NULL, now()::text),
  ('grant-staff-self-view', 'tpl-staff-basic', 'staffing.view', 'self', NULL, 'allow', NULL, now()::text)
ON CONFLICT (grant_id) DO UPDATE SET
  template_id = EXCLUDED.template_id,
  permission_key = EXCLUDED.permission_key,
  scope_kind = EXCLUDED.scope_kind,
  scope_dept_id = EXCLUDED.scope_dept_id,
  effect = EXCLUDED.effect,
  conditions_json = EXCLUDED.conditions_json;

INSERT INTO employee_profiles (employee_id, name, dept_id, position_id, status, created_at, updated_at)
VALUES
  ('emp-lee-woo-eok', '이우억', 'exec', 'ceo', 'active', now()::text, now()::text),
  ('emp-shin-yong-sik', '신용식', 'exec', 'senior-managing-director', 'active', now()::text, now()::text),
  ('emp-jeong-dong-jong', '정동종', 'exec', 'general-director', 'active', now()::text, now()::text),
  ('emp-lee-ju-yeon', '이주연', 'exec', 'advisor', 'active', now()::text, now()::text),
  ('emp-kwon-oh-jong', '권오종', 'sales-management', 'senior-managing-director', 'active', now()::text, now()::text),
  ('emp-lee-jae-young', '이재영', 'sales-management', 'general-manager', 'active', now()::text, now()::text),
  ('emp-lee-do-hee', '이도희', 'sales-management', 'assistant-manager', 'active', now()::text, now()::text),
  ('emp-jo-ok-hwan', '조옥환', 'integrated-env-1', 'general-manager', 'active', now()::text, now()::text),
  ('emp-lee-seung-han', '이승한', 'integrated-env-1', 'manager', 'active', now()::text, now()::text),
  ('emp-jeong-hye-rin', '정혜린', 'integrated-env-1', 'manager', 'active', now()::text, now()::text),
  ('emp-kang-so-hyeon', '강소현', 'integrated-env-1', 'manager', 'active', now()::text, now()::text),
  ('emp-an-hyo-jun', '안효준', 'integrated-env-1', 'assistant-manager', 'active', now()::text, now()::text),
  ('emp-kim-do-won', '김도원', 'integrated-env-1', 'assistant-manager', 'active', now()::text, now()::text),
  ('emp-shin-jae-hwan', '신재환', 'integrated-env-1', 'staff', 'active', now()::text, now()::text),
  ('emp-kim-tae-geon', '김태건', 'integrated-env-1', 'staff', 'active', now()::text, now()::text),
  ('emp-han-do-gyeong', '한도경', 'integrated-env-2', 'general-manager', 'active', now()::text, now()::text),
  ('emp-han-sang-sun', '한상순', 'integrated-env-2', 'deputy-general-manager', 'active', now()::text, now()::text),
  ('emp-bae-min-jeong', '배민정', 'integrated-env-2', 'manager', 'active', now()::text, now()::text),
  ('emp-choi-jun-bok', '최준복', 'integrated-env-2', 'assistant-manager', 'active', now()::text, now()::text),
  ('emp-lee-yun-jae', '이윤재', 'integrated-env-2', 'assistant-manager', 'active', now()::text, now()::text),
  ('emp-jeong-da-jeong', '정다정', 'integrated-env-2', 'assistant-manager', 'active', now()::text, now()::text),
  ('emp-lee-seon-yong', '이선용', 'integrated-env-2', 'assistant-manager', 'active', now()::text, now()::text),
  ('emp-choi-tae-hyeon', '최태현', 'integrated-env-2', 'manager', 'active', now()::text, now()::text),
  ('emp-lee-won-jong', '이원종', 'chemical-safety', 'deputy-general-manager', 'active', now()::text, now()::text),
  ('emp-lee-geun-hyeong', '이근형', 'chemical-safety', 'manager', 'active', now()::text, now()::text),
  ('emp-lee-tae-ha', '이태하', 'chemical-safety', 'assistant-manager', 'active', now()::text, now()::text),
  ('emp-choi-hyeon-woo', '최현우', 'chemical-safety', 'staff', 'active', now()::text, now()::text),
  ('emp-kim-do-eun', '김도은', 'carbon-neutral-lab', 'associate-researcher', 'active', now()::text, now()::text),
  ('emp-lee-ye-seul', '이예슬', 'carbon-neutral-lab', 'associate-researcher', 'active', now()::text, now()::text),
  ('emp-lee-jong-gil', '이종길', 'ulsan-branch', 'ulsan-branch-head', 'active', now()::text, now()::text),
  ('emp-kim-min-ji', '김민지', 'ulsan-branch', 'assistant-manager', 'active', now()::text, now()::text),
  ('emp-kim-seong-eun', '김성은', 'ulsan-branch', 'staff', 'active', now()::text, now()::text)
ON CONFLICT (employee_id) DO UPDATE SET
  name = EXCLUDED.name,
  dept_id = EXCLUDED.dept_id,
  position_id = EXCLUDED.position_id,
  status = EXCLUDED.status,
  updated_at = now()::text;
