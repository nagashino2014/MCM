-- 150: 영업 담당자 풀(sales_assignees).
-- 배경: 담당자 선택 조직도·영업 목록 담당 필터는 지금까지 lib/sales/org-tree.ts 의
--       하드코딩 규칙(직급 rank >= 60 = 차장 이상, 특정 인원 제외)만으로 인원을 골랐다.
--       규칙에 걸리지 않는 인원(대리·사원 등)도 영업 담당이 될 수 있어야 하므로,
--       프로젝트 담당자 설정 모달의 '영업 담당 추가'로 등록한 인원을 여기에 누적한다.
-- 최종 풀 = (직급 규칙 통과 인원) ∪ (이 테이블에 등록된 인원).
-- 관례: text 타임스탬프, 멱등(IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS sales_assignees (
  employee_id text PRIMARY KEY REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  created_by  text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at  text NOT NULL
);

-- 이미 프로젝트 담당자로 지정되어 있는 인원은 풀에 있어야 자연스럽다(기존 데이터 백필).
INSERT INTO sales_assignees (employee_id, created_by, created_at)
SELECT DISTINCT m.employee_id, NULL, now()::text
  FROM sales_project_members m
  JOIN employee_profiles e ON e.employee_id = m.employee_id
 WHERE m.employee_id IS NOT NULL
ON CONFLICT (employee_id) DO NOTHING;
