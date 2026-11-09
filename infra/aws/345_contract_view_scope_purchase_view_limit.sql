-- 345: 매출 계약 열람 범위 확대(부서장 전 계약) + 매입 계약 관리를 대표이사·관리자 전용으로 축소
--
-- 배경(2026-11-09 사용자 지시): 화학안전본부장을 겸직하는 부장이 화관법 용역을 몇 건밖에 못 봤다.
--   부서장(tpl-dept-lead)의 contract.view 가 self_dept(012) 라 수행부서(owning_dept_id)도 없고 부서원이
--   수행인력으로 등록되지도 않은 계약은 목록에서 빠졌다. 부서장·임원·대표이사·관리자는 전 계약을 보고,
--   사원(tpl-staff-basic participant)만 본인 수행 용역으로 남긴다. 임원(026)·대표이사(298)·관리자는 이미 all.
--   계약 등록·수정(contract.edit, 043 self_dept)은 지시 범위 밖이라 그대로 둔다.
--
-- 매입 계약 관리(331)는 대표이사(tpl-ceo)·관리자(tpl-system-admin)만 본다. 331 이 준 인사/회계(tpl-hr) view·edit,
--   임원(tpl-exec) view, 영업관리(tpl-sales) view·edit 를 회수한다. 화면을 못 보는 템플릿에 쓰기 키만 남기지
--   않도록 purchase.* 전체를 두 템플릿 밖에서 지운다(검수용 tpl-view-all 이 213 재실행으로 받았어도 함께 회수).
--
-- ⚠ 사용자별 배정의 scope_override_kind 는 템플릿 grant 범위를 덮는다(rbac.ts loadUserAccess). 부서장 배정에
--   self_dept 등 덮어쓰기가 있으면 이 변경이 그 사람에게는 효과가 없다 — 적용 뒤 확인 쿼리 참고.
-- 권한 목록은 로그인 토큰에 담기므로 메뉴 노출 변화는 다시 로그인해야 보인다. 멱등.

-- 1) 부서장 매출 계약 열람 = 전사
UPDATE permission_template_grants
   SET scope_kind = 'all', scope_dept_id = NULL
 WHERE template_id = 'tpl-dept-lead'
   AND permission_key = 'contract.view'
   AND scope_kind <> 'all';

-- 2) 매입 계약 = 대표이사·관리자만
DELETE FROM permission_template_grants
 WHERE permission_key IN ('purchase.view', 'purchase.edit', 'purchase.delete')
   AND template_id NOT IN ('tpl-system-admin', 'tpl-ceo');

-- 확인(적용 뒤 수동):
--   SELECT template_id, permission_key, scope_kind FROM permission_template_grants
--    WHERE permission_key IN ('contract.view') OR permission_key LIKE 'purchase.%' ORDER BY 2, 1;
--   SELECT a.user_id, a.scope_override_kind FROM user_permission_assignments a
--    WHERE a.template_id = 'tpl-dept-lead' AND a.revoked_at IS NULL AND a.scope_override_kind IS NOT NULL;
