-- 201: 휴일 근무 휴게 공제 폐지에 따른 재산정 트리거.
-- 정책 변경(2026-08-27 확정): 휴일(토·일·공휴일)은 소정근로가 없어 재실 전체가 초과근무
-- 대상이므로 휴게(break_minutes) 공제 없이 전액 인정한다(근로기준법 취지). 평일 점심
-- 휴게(60분) 공제는 유지 — 없애면 정시 근무(재실 9h)만으로 주 45h 가 되어 전원이 매주
-- 5h 연장으로 잡히는 왜곡이 생긴다. 로직: lib/adt/overtime.ts computeDaily(isOffDay).
--
-- 공휴일 판정은 앱(lib/hr/holidays)에서만 가능하므로 여기서는 스테이징 전체를
-- 미처리로 되돌려 다음 인제스트(시간별 이벤트 수집 또는 rate(1 hour) 배치)가
-- 새 규칙으로 일별·주별을 재산정하게 한다(전 단계 멱등이라 안전).
UPDATE adt_attendance_raw SET processed = false WHERE processed = true;
