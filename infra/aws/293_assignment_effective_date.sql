-- 293: user_permission_assignments.effective_from/effective_to 를 날짜 10자리(YYYY-MM-DD)로 정규화 — F-01 데이터 정리.
--
-- 배경(2026-10-19 스테이징 실계정 점검, F-01): 계정 발급(lib/auth/account-provisioning.ts)이 effective_from 에
--   ISO 타임스탬프('2026-10-19T04:35:54.025Z')를 넣고, loadUserAccess(lib/auth/rbac.ts)는 오늘 날짜 10자리('2026-10-19')와
--   문자열 비교(`a.effective_from <= $2`)한다. 'YYYY-MM-DDT…' > 'YYYY-MM-DD' 라 **발급 당일에는 grant 0개** → 신규 직원이
--   첫날 전 메뉴 403(다음날부터 정상). 코드는 저장을 날짜 10자리로, 비교를 left(…,10) 으로 양쪽 정규화했고,
--   이 마이그는 기존 행(과거 날짜라 판정 영향은 없음)을 같은 형식으로 맞춘다. 멱등.

UPDATE user_permission_assignments
   SET effective_from = left(effective_from, 10)
 WHERE effective_from IS NOT NULL AND length(effective_from) > 10;

UPDATE user_permission_assignments
   SET effective_to = left(effective_to, 10)
 WHERE effective_to IS NOT NULL AND length(effective_to) > 10;

-- 점검(읽기 전용): 길이 10 이 아닌 값 — 0행이어야 한다
--   SELECT assignment_id, effective_from, effective_to FROM user_permission_assignments
--    WHERE (effective_from IS NOT NULL AND length(effective_from) <> 10)
--       OR (effective_to IS NOT NULL AND length(effective_to) <> 10);
