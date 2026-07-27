-- 094: 상신 전 사전검토 정책(AX-P3) — 양식별 규칙(금액 상한·연차 잔여·초과근무·필수 첨부).
-- 기본 severity=warn(경고 후 상신 허용), 정책에서 block 승격 가능(§8-3 사용자 확정).
-- 설계: docs/e-approval-differentiation-blueprint.md §9-4.
-- ※ 유사 과거 문서 검색은 pgvector 대신 같은 양식 최근 문서(승인/반려·사유)를 LLM 에 제시하는
--   방식으로 구현(임베딩 provider 의존 회피) — doc_embeddings 테이블은 두지 않는다.

CREATE TABLE IF NOT EXISTS approval_form_policies (
  policy_id text PRIMARY KEY,
  form_id text NOT NULL REFERENCES approval_forms(form_id) ON DELETE CASCADE,
  field_key text,                    -- 대상 필드(amount_limit 등). form 전체 규칙은 NULL.
  kind text NOT NULL,                -- amount_limit|leave_balance|overtime_limit|required_field|self_approval
  config jsonb NOT NULL DEFAULT '{}'::jsonb,  -- 예: {"max":1000000} / {"message":"..."}
  severity text NOT NULL DEFAULT 'warn',      -- warn|block
  active integer NOT NULL DEFAULT 1,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approval_form_policies_form ON approval_form_policies(form_id, active);
