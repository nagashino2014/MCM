-- 139 보완 — 등록자 자동 배정 잔재 1건 정정.
-- '세광 비산배출시설 연간점검 보고서 작성 등 용역(2026년)' 은 자동 삽입 참여자가 이미 없어
-- 139 의 대상 조건(참여자 소속 = 수행부서)에 걸리지 않았으나, 수행인력 0명인 채로
-- 등록자 부서(영업관리본부)만 남아 있어 함께 비운다.

UPDATE contracts c
   SET owning_dept_id = NULL,
       updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE c.contract_title = '세광 비산배출시설 연간점검 보고서 작성 등 용역(2026년)'
   AND c.deleted_at IS NULL
   AND c.owning_dept_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM service_participants sp WHERE sp.contract_id = c.contract_id);
