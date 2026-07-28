-- 107_dept_display_order.sql
-- 부서 표시 순서 조정 — 조직도·주소록에서 실무 본부를 앞에, 영업관리본부를 뒤에 둔다.
-- 총괄 → 통합환경1·2본부 → 화학안전본부 → 탄소중립미래연구소 → 울산지사 → 영업관리본부.
-- 멱등(지정 부서의 display_order 를 고정값으로 세팅).

UPDATE departments SET display_order = 10 WHERE dept_id = 'exec';
UPDATE departments SET display_order = 20 WHERE dept_id = 'integrated-env-1';
UPDATE departments SET display_order = 30 WHERE dept_id = 'integrated-env-2';
UPDATE departments SET display_order = 40 WHERE dept_id = 'chemical-safety';
UPDATE departments SET display_order = 50 WHERE dept_id = 'carbon-neutral-lab';
UPDATE departments SET display_order = 60 WHERE dept_id = 'ulsan-branch';
UPDATE departments SET display_order = 70 WHERE dept_id = 'sales-management';
