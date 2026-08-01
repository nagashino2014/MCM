-- 120: 자연어 리포팅(NLQ) 권한키 — AX-P5 §9-6 / 시맨틱 위저드 §8-2 확정 반영.
-- reports.nlq: 데이터 분석 보드의 자연어 질문 기능. **기본 미부여** — 관리자가 RBAC 관리 화면에서
-- 임원/부서장/직원에게 선별 부여한다(admin 은 가드 fallback 으로 항상 가능). 직급별 데이터
-- 스코프는 후속 유보. 멱등.

INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('reports.nlq', 'reports', 'nlq', '데이터 분석 자연어 질문(LLM 비용 발생)', 'all', 0, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;
