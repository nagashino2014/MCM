-- 부서별 고정 업무추진계획 양식 매핑. (PR-1 보완)
-- 보고 양식은 부서에 따라 고정되며, 작성 화면에서 임의 변경할 수 없다.
-- 부서를 선택하면 해당 부서의 지정 양식이 자동 선택된다.
-- 027 위에 적용.

ALTER TABLE departments
  ADD COLUMN IF NOT EXISTS default_work_plan_template_id text
    REFERENCES work_plan_templates(template_id) ON DELETE SET NULL;

-- 통합환경1·2본부, 울산지사 → 사업장×용역 매트릭스
UPDATE departments SET default_work_plan_template_id = 'tpl-service-matrix'
  WHERE dept_id IN ('integrated-env-1', 'integrated-env-2', 'ulsan-branch');

-- 화학안전본부 → 화학안전 매트릭스
UPDATE departments SET default_work_plan_template_id = 'tpl-chemsafe-matrix'
  WHERE dept_id = 'chemical-safety';

-- 탄소중립미래연구소, 영업관리본부 → 자유 서술 (영업·관리 구조화 양식은 후속 PR에서 도입)
UPDATE departments SET default_work_plan_template_id = 'tpl-category-bullets'
  WHERE dept_id IN ('carbon-neutral-lab', 'sales-management');

-- 총괄(도면관리 작업단위 포함) → 작업 단위 양식
UPDATE departments SET default_work_plan_template_id = 'tpl-task-matrix'
  WHERE dept_id = 'exec';
