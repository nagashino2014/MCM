-- 318: 사업장 담당자 추가·수정 권한(contact.edit)을 전 직원에게 부여 (2026-10-30 사용자 결정)
-- 배경: 출장·영업에서 만나는 외부 담당자 정보는 그 사람을 만난 직원이 직접 등록하는 것이 가장 효율적이고,
--   직급·부서 변동도 담당 직원이 먼저 알고 바로 고칠 수 있다. 삭제는 부여하지 않는다 — 주소록 담당자 삭제
--   (DELETE /api/directory/contacts)와 사업장 상세의 일괄 저장(PUT /api/facilities/[id]/contacts, 담당자 제거 포함)은
--   계속 facility.edit 이 필요하다. 추가·수정은 개별 API(POST·PATCH /api/directory/contacts)로만 하며 감사 로그를 남긴다.
-- 대상: 전 직원 기본 템플릿(tpl-staff-basic)과, 그 템플릿 없이 쓰일 수 있는 부서장·임원·전체 열람 템플릿.
--   (tpl-sales·tpl-sales-staff·tpl-system-admin·tpl-ceo 는 이미 보유)
-- 멱등: 같은 템플릿에 contact.edit 이 이미 있으면 건너뛴다. 존재하지 않는 템플릿은 JOIN 으로 걸러진다.

INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, scope_dept_id, effect, conditions_json, created_at)
SELECT 'grant-' || t.short || '-contact-edit', t.template_id, 'contact.edit', 'all', NULL, 'allow', NULL,
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (VALUES ('tpl-staff-basic', 'staff'), ('tpl-dept-lead', 'lead'), ('tpl-exec', 'exec'), ('tpl-view-all', 'viewall'))
       AS t(template_id, short)
  JOIN permission_templates pt ON pt.template_id = t.template_id
  JOIN permissions p ON p.permission_key = 'contact.edit'
 WHERE NOT EXISTS (
         SELECT 1 FROM permission_template_grants g
          WHERE g.template_id = t.template_id AND g.permission_key = 'contact.edit'
       )
ON CONFLICT (grant_id) DO NOTHING;

-- 점검(읽기 전용) — 템플릿별 contact.edit 보유 여부
SELECT pt.template_id,
       EXISTS (SELECT 1 FROM permission_template_grants g
                WHERE g.template_id = pt.template_id AND g.permission_key = 'contact.edit') AS has_contact_edit
  FROM permission_templates pt
 WHERE pt.template_id IN ('tpl-staff-basic', 'tpl-dept-lead', 'tpl-exec', 'tpl-view-all')
 ORDER BY pt.template_id;
