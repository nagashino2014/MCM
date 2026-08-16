-- 계약 등록 시 등록자를 수행부서·수행인력으로 자동 채우던 로직의 잔재 정리.
-- 신규 계약은 영업관리본부(등록 대행)가 등록하므로 등록자는 용역 수행자가 아니다.
-- 수행부서·수행인력은 해당 부서장/담당자가 지정하기 전까지 비어 있어야 한다.
-- (등록 API 의 자동 삽입은 코드에서 제거됨 — 이 스크립트는 기등록분 원복용.)
--
-- 자동 삽입분 판별: 계약 생성과 '같은 시각'에 role_label='관리자', source='manual' 로 들어간 참여자.
-- 사람이 직접 지정한 참여자는 계약 생성 이후 시각이라 대상에서 빠진다.

WITH auto_rows AS (
  SELECT sp.participation_id, sp.contract_id, ep.dept_id
    FROM service_participants sp
    JOIN contracts c ON c.contract_id = sp.contract_id
    LEFT JOIN employee_profiles ep ON ep.employee_id = sp.employee_id
   WHERE sp.role_label = '관리자'
     AND sp.source = 'manual'
     AND sp.created_at = c.created_at
),
-- 수행부서까지 비울 계약: 자동 참여자의 소속 부서가 그대로 owning_dept_id 이고,
-- 자동 삽입분 외에 수동 지정된 수행인력이 없는 계약만(수동 지정분 보호).
target_contracts AS (
  SELECT DISTINCT a.contract_id
    FROM auto_rows a
    JOIN contracts c ON c.contract_id = a.contract_id
   WHERE c.owning_dept_id IS NOT NULL
     AND c.owning_dept_id = a.dept_id
     AND NOT EXISTS (
       SELECT 1 FROM service_participants sp2
        WHERE sp2.contract_id = a.contract_id
          AND sp2.participation_id NOT IN (SELECT participation_id FROM auto_rows)
     )
),
deleted AS (
  DELETE FROM service_participants
   WHERE participation_id IN (SELECT participation_id FROM auto_rows)
  RETURNING contract_id
)
UPDATE contracts
   SET owning_dept_id = NULL,
       updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE contract_id IN (SELECT contract_id FROM target_contracts);
