-- 091: 근태 관리대상 아닌 ADT 사번(퇴사자·비직원 출입자) 무시 목록.
-- ADT 컨트롤러에는 퇴사자·협력사 등 직원이 아닌 출입 등록자도 존재한다. 이들은 직원 매핑 대상이 아니므로
-- 미매칭 목록·주별 리포트·KPI 에서 영구 제외하되, 일별 원본(attendance_daily)은 보관해 별도 조회는 가능하게 한다.
-- 화면: /approval/attendance 미매칭 매핑 탭에서 "관리대상 아님" 지정. 관례: 멱등.
-- 설계: docs/ADT_attendance_integration_handoff.md §7-5.

CREATE TABLE IF NOT EXISTS attendance_ignored_emp (
  adt_emp_no text PRIMARY KEY,          -- ADT 사원번호(e_idno)
  label      text,                      -- 수신 시점 성명 스냅샷(식별 편의)
  reason     text,                       -- 사유(퇴사·비직원 등, 자유 기재)
  created_by text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
