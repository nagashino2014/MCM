-- 047_sales_projects.sql
-- 영업·마케팅 P1: 영업 프로젝트(영업건) + 관계자 + 활동 로그(타임라인) + 활동 첨부.
-- 001(facilities/contracts)·012(employee_profiles/departments) 위에 적용. 멱등.
-- 설계: memory/sales-marketing-blueprint.md, 블루프린트 v1.0 P1.
-- 활동의 "만난 사람"은 facility_contact_people 을 단일 마스터로 참조(연락처 통합 결정).

-- 영업 프로젝트 = 영업건. 동일 사업장에 시기·건별 1:N. won 시 contracts 로 연결.
CREATE TABLE IF NOT EXISTS sales_projects (
  project_id        text PRIMARY KEY,
  facility_id       text NOT NULL REFERENCES facilities(facility_id) ON DELETE CASCADE,
  title             text NOT NULL,
  stage             text NOT NULL DEFAULT 'lead'
                      CHECK (stage IN ('lead','contact','proposal','bidding','won','lost','hold')),
  owner_employee_id text REFERENCES employee_profiles(employee_id) ON DELETE SET NULL,
  owner_dept_id     text REFERENCES departments(dept_id) ON DELETE SET NULL,  -- self_dept/specific_dept scope 평가용
  contract_id       text REFERENCES contracts(contract_id) ON DELETE SET NULL, -- 수주 전환 링크
  expected_amount   double precision,
  priority          text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at         text,
  closed_at         text,
  memo              text,
  created_by        text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at        text NOT NULL,
  updated_at        text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_projects_facility ON sales_projects(facility_id);
CREATE INDEX IF NOT EXISTS idx_sales_projects_stage    ON sales_projects(stage);
CREATE INDEX IF NOT EXISTS idx_sales_projects_owner    ON sales_projects(owner_employee_id);
CREATE INDEX IF NOT EXISTS idx_sales_projects_dept     ON sales_projects(owner_dept_id);
CREATE INDEX IF NOT EXISTS idx_sales_projects_contract ON sales_projects(contract_id);

-- 영업 관계자(담당·임원·부서장). 로그인 계정이 아니라 조직 인원 기준(029 일관).
CREATE TABLE IF NOT EXISTS sales_project_members (
  id          bigserial PRIMARY KEY,
  project_id  text NOT NULL REFERENCES sales_projects(project_id) ON DELETE CASCADE,
  employee_id text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  role_label  text NOT NULL DEFAULT '담당',   -- '담당' | '임원' | '부서장' | '지원'
  created_at  text NOT NULL,
  UNIQUE (project_id, employee_id, role_label)
);

CREATE INDEX IF NOT EXISTS idx_sales_project_members_project  ON sales_project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_sales_project_members_employee ON sales_project_members(employee_id);

-- 영업 활동 = 타임라인 단위. 예정(planned)/완료(done)를 한 모델로 다룬다.
CREATE TABLE IF NOT EXISTS sales_activities (
  activity_id   text PRIMARY KEY,
  project_id    text NOT NULL REFERENCES sales_projects(project_id) ON DELETE CASCADE,
  activity_type text NOT NULL
                  CHECK (activity_type IN
                    ('telemarketing','call','visit','meeting','email','quote','bid','contract_signed','other')),
  status        text NOT NULL DEFAULT 'done' CHECK (status IN ('planned','done','canceled')),
  scheduled_at  text,                       -- 예정 일시(캘린더 바)
  occurred_at   text,                       -- 완료 일시(타임라인 노드)
  place         text,                       -- 어디서
  summary       text,                       -- 무슨 얘기
  quote_amount  double precision,           -- 견적가
  bid_amount    double precision,           -- 입찰가
  author_employee_id text REFERENCES employee_profiles(employee_id) ON DELETE SET NULL,  -- 기록자
  created_by    text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at    text NOT NULL,
  updated_at    text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_activities_project  ON sales_activities(project_id);
CREATE INDEX IF NOT EXISTS idx_sales_activities_type     ON sales_activities(activity_type);
CREATE INDEX IF NOT EXISTS idx_sales_activities_status   ON sales_activities(status);
CREATE INDEX IF NOT EXISTS idx_sales_activities_occurred ON sales_activities(occurred_at);

-- 활동의 "만난 사람" N:M. facility_contact_people(연락처 단일 마스터)를 참조.
-- 해당 테이블 PK 는 bigserial(id) 이므로 person_id 는 bigint. 사람 삭제 시 행 정리는 앱에서 처리.
CREATE TABLE IF NOT EXISTS sales_activity_contacts (
  activity_id text NOT NULL REFERENCES sales_activities(activity_id) ON DELETE CASCADE,
  person_id   bigint NOT NULL,
  PRIMARY KEY (activity_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_sales_activity_contacts_person ON sales_activity_contacts(person_id);

-- 활동 첨부(견적서·입찰서·명함 사진 등). S3 storage_* 패턴(016/employee_documents 동일).
CREATE TABLE IF NOT EXISTS sales_activity_attachments (
  attachment_id     text PRIMARY KEY,
  activity_id       text NOT NULL REFERENCES sales_activities(activity_id) ON DELETE CASCADE,
  display_name      text NOT NULL,
  original_filename text,
  content_type      text,
  byte_size         bigint,
  sha256            text,
  storage_provider  text NOT NULL DEFAULT 's3',
  storage_bucket    text,
  storage_key       text NOT NULL,
  public_path       text,
  created_by        text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at        text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_activity_attachments_activity ON sales_activity_attachments(activity_id);
