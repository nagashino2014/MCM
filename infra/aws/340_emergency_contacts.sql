-- 340: 사내 비상 연락망 표시 설정 (2026-11-05 사용자 요청, /directory '비상 연락망' 탭)
-- 이름·직급·연락처·직통번호·이메일의 원천은 직원 마스터(employee_profiles)다. 입사·퇴사·번호 변경은 인사카드만 고치면 표에 반영된다.
-- 이 표는 마스터에 없는 것만 담는다.
--   직원 행(employee_id 있음): 소속 표시(group_label)·직책(title)·표 순서(display_order)·숨김(hidden).
--   직접 입력 행(employee_id 없음): 인사카드가 없는 인원(고문·자회사 등). name·position_name·mobile_phone·direct_phone·email 을 함께 담는다.
--   겸직 줄(same_as_employee_id 있음): 한 사람을 다른 소속에도 올리는 둘째 줄. 소속·직책·순서만 담고 이름·번호는 그 직원의 인사카드를 따른다.
-- 멱등: 표와 인덱스는 IF NOT EXISTS. 권한은 기존 staffing.edit(수정)과 로그인 세션(열람)을 쓰므로 새 권한 키가 없다.

CREATE TABLE IF NOT EXISTS emergency_contact_entries (
  entry_id text PRIMARY KEY,
  employee_id text REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  same_as_employee_id text REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  group_label text,                                    -- 비면 부서명(대표이사는 '대표이사')
  title text,                                          -- 비면 주 소속 보직의 직책
  display_order integer,                               -- 비면 같은 소속의 끝, 소속이 없으면 표의 끝
  hidden smallint NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  name text,
  position_name text,
  mobile_phone text,
  direct_phone text,
  email text,
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  updated_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL,
  CHECK (employee_id IS NOT NULL OR same_as_employee_id IS NOT NULL OR name IS NOT NULL),
  CHECK (employee_id IS NULL OR same_as_employee_id IS NULL),
  CHECK (same_as_employee_id IS NULL OR group_label IS NOT NULL)
);

-- 직원 한 명당 설정 1행
CREATE UNIQUE INDEX IF NOT EXISTS uq_emergency_contact_entries_employee
  ON emergency_contact_entries(employee_id) WHERE employee_id IS NOT NULL;

-- 겸직 줄은 소속당 1행
CREATE UNIQUE INDEX IF NOT EXISTS uq_emergency_contact_entries_same_as
  ON emergency_contact_entries(same_as_employee_id, group_label) WHERE same_as_employee_id IS NOT NULL;

-- 점검(읽기 전용)
SELECT count(*) AS emergency_contact_entries FROM emergency_contact_entries;
