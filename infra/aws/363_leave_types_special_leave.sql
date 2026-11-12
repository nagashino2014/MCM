-- 363: 휴가신청 휴가 종류에 특별휴가 2종(장기근속휴가·초과근무 대체휴가) 추가(2026-11-12 직원 개선 요청 18).
-- 특별휴가 잔여는 연차 대장과 분리된 special_leave_ledger(133·134)에 있다. 이 두 항목은
-- 연차를 차감하지 않고(deduct NULL) 승인 시 원장에 use 를 적재해 잔여를 줄인다.
-- 원장 kind 와의 연결은 코드(lib/approval/leave-types.ts SPECIAL_LEAVE_TYPE_KINDS)가 key 로 한다 —
-- special_longevity → longevity, special_overtime_comp → overtime_comp. key 를 바꾸면 연결이 끊긴다.
-- 기안 화면은 본인 잔여가 있을 때만 이 선택지를 보이고, 서버는 잔여를 넘는 상신을 거부한다.
-- 스키마 변경 없음(데이터 행만). 관례: 멱등 — 관리자가 라벨·순서를 고쳤으면 재적용이 덮지 않는다.

INSERT INTO leave_types (key, label, group_name, days, deduct, sort_order, active, created_at, updated_at)
SELECT v.key, v.label, '특별휴가', NULL, NULL,
       COALESCE((SELECT max(sort_order) FROM leave_types), 0) + v.ord, 1, now()::text, now()::text
  FROM (VALUES ('special_longevity', '장기근속휴가', 1),
               ('special_overtime_comp', '초과근무 대체휴가', 2)) AS v(key, label, ord)
ON CONFLICT (key) DO NOTHING;
