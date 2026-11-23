-- 377: 용역 유형별 계약 열람 부여(contract_type_view_grants) — 특정 계정에게 특정 용역 유형의 계약 전체 열람을 준다.
--
-- 배경(2026-11-23 사용자 요청): 화학안전본부에서 화관법 용역은 이근형 차장이, HAPs 용역은 이원종 차장이 총괄 감독한다.
--   부서장은 전 계약을 보지만(345) 두 차장은 사원 템플릿(contract.view participant)이라 본인이 수행인력으로 등록된
--   계약만 보인다. 수행인력을 전부 등록할 때까지 기다릴 수 없어, 사람 이름을 코드에 넣지 않고 "계정 × 용역 유형"
--   단위로 열람을 넓히는 설정을 둔다. 같은 경우가 또 생기면 계정·권한 관리 화면에서 행만 추가한다.
--
-- 동작(frontend/lib/auth/rbac.ts loadUserAccess · contract-scope.ts)
--   - 열람 전용: contract.view 에만 더해진다. contract.edit·contract.delete·billing.* 는 넓히지 않는다.
--   - contract.view 를 가진 계정에게만 효력이 있다(계약 메뉴 자체가 없는 계정을 이 표로 열지 않는다).
--   - 용역 유형 = contracts.service_type(대분류 이름, 348). service_subtype 이 NULL 이면 그 대분류 전체,
--     값이 있으면 그 세분류만. 대분류·세분류 이름을 관리 화면에서 바꾸면 이 표의 이름도 함께 바뀐다
--     (lib/contracts/service-categories-server.ts cascadeRename).
--   - 회수 = revoked_at 기록(행은 남긴다). 권한 요약(로그인 토큰)과 무관해 부여·회수는 다시 로그인하지 않아도 반영된다.
--   - 이 표가 없으면(적용 전) 앱은 부여가 없는 것으로 동작한다.
-- 선행: 012(users·employee_profiles). GRANT 없음(265 default privileges). 멱등.

CREATE TABLE IF NOT EXISTS contract_type_view_grants (
  grant_id        text PRIMARY KEY,
  user_id         text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  service_type    text NOT NULL,
  service_subtype text,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  revoked_at      timestamptz,
  revoked_by      text
);

CREATE INDEX IF NOT EXISTS idx_contract_type_view_grants_user
  ON contract_type_view_grants (user_id) WHERE revoked_at IS NULL;

-- ── 최초 부여 2건 — 이근형(장외&화관법)·이원종(HAPs) ──
-- 계정 id 는 환경마다 다르므로 직원 → 연결 계정으로 찾는다. 동명이인·미연결을 피하려고 "화학안전본부 소속 활성 직원 중
-- 012 시드 id 또는 이름이 맞는 사람이 정확히 1명이고 연결 계정도 정확히 1개"일 때만 넣고, 아니면 건너뛴다(NOTICE).
-- 건너뛴 경우 계정·권한 관리 화면에서 직접 부여한다. 그 계정·대분류로 행이 한 번이라도 있었으면(회수 포함) 다시 넣지
-- 않는다 — 재실행이 관리자의 회수를 되살리지 않게 한다.
DO $$
DECLARE
  seed record;
  emp_count integer;
  emp_id text;
  user_count integer;
  target_user text;
BEGIN
  FOR seed IN
    SELECT * FROM (VALUES
      ('emp-lee-geun-hyeong', '이근형', '장외&화관법'),
      ('emp-lee-won-jong',    '이원종', 'HAPs')
    ) AS s(employee_id, emp_name, service_type)
  LOOP
    SELECT COUNT(*), MIN(ep.employee_id) INTO emp_count, emp_id
      FROM employee_profiles ep
     WHERE ep.status = 'active'
       AND ep.dept_id = 'chemical-safety'
       AND (ep.employee_id = seed.employee_id OR ep.name = seed.emp_name);
    IF emp_count <> 1 THEN
      RAISE NOTICE '377: % — 화학안전본부 활성 직원 후보 %명(1명이 아님), 건너뜀. 화면에서 부여하세요.', seed.emp_name, emp_count;
      CONTINUE;
    END IF;

    SELECT COUNT(*), MIN(u.user_id) INTO user_count, target_user
      FROM users u
     WHERE u.employee_id = emp_id;
    IF user_count <> 1 THEN
      RAISE NOTICE '377: % — 연결 계정 %개(1개가 아님), 건너뜀. 화면에서 부여하세요.', seed.emp_name, user_count;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM contract_type_view_grants g
       WHERE g.user_id = target_user AND g.service_type = seed.service_type AND g.service_subtype IS NULL
    ) THEN
      RAISE NOTICE '377: % — % 부여 이력이 이미 있어 건너뜀.', seed.emp_name, seed.service_type;
      CONTINUE;
    END IF;

    INSERT INTO contract_type_view_grants (grant_id, user_id, service_type, service_subtype, note, created_by)
    VALUES (
      'ctvg-seed-' || substr(md5(target_user || '|' || seed.service_type), 1, 16),
      target_user, seed.service_type, NULL,
      '화학안전본부 ' || seed.service_type || ' 용역 총괄 감독(2026-11-23 요청)', 'migration-377'
    );
    RAISE NOTICE '377: % — % 계약 전체 열람 부여.', seed.emp_name, seed.service_type;
  END LOOP;
END $$;

-- 확인(적용 뒤 수동):
--   SELECT g.grant_id, u.name, g.service_type, g.service_subtype, g.revoked_at
--     FROM contract_type_view_grants g JOIN users u ON u.user_id = g.user_id ORDER BY g.created_at;
--   SELECT service_type, COUNT(*) FROM contracts GROUP BY 1 ORDER BY 2 DESC;   -- 대분류 이름이 실제 값과 맞는지
