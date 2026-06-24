-- 용역 수행인력 현황. (수행부서/인력 지정 + 업무보고 자동 집계의 단일 진실원)
-- 027 위에 적용. 담당자는 로그인 계정(users)이 아니라 조직 인원(employee_profiles) 기준.
-- 외주(외부 협력사) 인력은 미관리(결정사항) — 본 테이블은 내부 직원만.

CREATE TABLE IF NOT EXISTS service_participants (
  participation_id   text PRIMARY KEY,
  contract_id        text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
  employee_id        text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  role_label         text NOT NULL DEFAULT '실무',   -- '관리자' | '정' | '부' | '실무' | '품질검토' …
  task_label         text,                            -- 담당업무 (자유)
  field_label        text,                            -- '대기' | '수질' | '폐기물' | '화관법' | '도면' …
  participated_from  text,                            -- 수행기간 시작 (YYYY-MM-DD)
  participated_to    text,                            -- 수행기간 종료 (NULL = 진행중)
  contribution_pct   double precision,                -- 투입률 (선택)
  source             text NOT NULL DEFAULT 'manual',  -- 'manual' | 'work_plan'
  source_ref         text,                            -- 출처 ID (work_plan_items.item_id 등)
  created_at         text NOT NULL,
  updated_at         text NOT NULL,
  UNIQUE (contract_id, employee_id, role_label)
);

CREATE INDEX IF NOT EXISTS idx_sp_contract ON service_participants(contract_id);
CREATE INDEX IF NOT EXISTS idx_sp_employee ON service_participants(employee_id);
