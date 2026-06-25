-- 045_employee_hr_events.sql
-- 인사 이력(승진/부서이동/퇴사) 기록 테이블. 사용자 등록·수정 화면의 '인사관리' 탭에서 사용.
-- 첨부 문서(인사발령/전보발령/퇴직원/퇴직정산)는 별도 테이블 없이 employee_documents
--   (target_table='employee_hr_events', target_id=event_id, document_type=문서명) 로 연결한다.
-- 멱등(IF NOT EXISTS). 012 의 employee_* 컨벤션(text PK, text timestamp, ON DELETE CASCADE) 을 따른다.

CREATE TABLE IF NOT EXISTS employee_hr_events (
  event_id text PRIMARY KEY,
  employee_id text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('promotion','transfer','resignation')),
  event_date text NOT NULL,
  position_id text REFERENCES positions(position_id) ON DELETE SET NULL,  -- 승진 직급
  position_name text,                                                     -- 라벨 스냅샷
  from_dept_id text REFERENCES departments(dept_id) ON DELETE SET NULL,   -- 부서이동 전 소속
  to_dept_id text REFERENCES departments(dept_id) ON DELETE SET NULL,     -- 부서이동 후 소속
  from_dept_name text,
  to_dept_name text,
  note text,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_emp_hr_events_emp ON employee_hr_events(employee_id, event_date);
