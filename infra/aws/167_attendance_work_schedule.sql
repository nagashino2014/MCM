-- 167: 직원별 출근시각(근무 유형) + 초과근무 대조 예외 승인 (2026-08-15)
--
-- 배경(사용자 확정):
--  ① 초과근무 산정의 시작 시각은 **개인별 소정근로 종료 시각**이다. 본사·울산 대부분 08:00 출근이라
--     17:00 부터 초과근무가 시작되지만 예외(정시 09:00, 10:00, 육아기 단축)가 있어 인원별 설정이 필요하다.
--     예) 이승한 4/27 — 재실 17:00~21:00, 신청 3h → 소정 종료 17:00 기준이면 3h 전량이 인정된다.
--  ② 지문 미태그 등으로 근태와 신청이 어긋난 건은 관리자가 확인 후 **예외 승인**할 수 있어야 한다.
--     (2026-09 앱 정식 전환 이후로는 미태그 건을 예외 없이 미근무 처리할 예정 — 그 전 과도기 보정용)

-- 직원별 근무 유형. 미설정 직원은 조기출근(08:00~17:00)으로 간주한다(사내 다수).
CREATE TABLE IF NOT EXISTS attendance_work_schedules (
  employee_id   text PRIMARY KEY REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  schedule_kind text NOT NULL,            -- early | normal | late10 | late10_care
  start_hhmm    text NOT NULL,            -- 출근시각 '0800'
  end_hhmm      text NOT NULL,            -- 소정근로 종료 '1700' (= 초과근무 시작)
  note          text,
  updated_by    text,
  updated_at    text NOT NULL DEFAULT now()::text
);

-- 초과근무 신청 × 근태 대조의 예외 승인/반려. 신청 1건(approval_docs.id) 단위.
CREATE TABLE IF NOT EXISTS overtime_match_overrides (
  doc_id      text PRIMARY KEY,
  employee_id text,
  work_date   date,
  mode        text NOT NULL,              -- approve = 신청 시간 전량 인정 · reject = 전량 불인정
  reason      text,
  approved_by text,
  approved_at text NOT NULL DEFAULT now()::text
);
CREATE INDEX IF NOT EXISTS idx_overtime_match_overrides_emp ON overtime_match_overrides(employee_id, work_date);
