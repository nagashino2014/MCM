-- 036_work_task_owning_dept_backfill.sql
-- Task 의 owning_dept_id 백필: 미지정(NULL) Task 를 작성자(created_by) 소속 부서로 채운다.
-- 부서장 감독/머지가 owning_dept_id 로 Task 를 집계하므로, 기존 Task 가 누락되지 않도록 한다.
-- 멱등: 이미 부서가 지정된 Task 는 건드리지 않는다.

UPDATE work_tasks t
   SET owning_dept_id = e.dept_id,
       updated_at = to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM employee_profiles e
 WHERE t.created_by = e.user_id
   AND t.owning_dept_id IS NULL
   AND e.dept_id IS NOT NULL;
