-- 201: 승인 액션 커넥터 레지스트리(FRM-P0) — 양식 승인/상신 시 실행할 연계를 DB 배선으로 관리.
-- 연계 로직 자체는 코드 커넥터(lib/approval/actions.ts ACTION_CONNECTORS)가 제공하고,
-- 이 테이블은 "어느 양식이 어느 커넥터를 어떤 필드 매핑으로 실행하는가"만 담는다(노코드 배선).
-- field_map 값은 필드 key 또는 'semantic:<concept>'(시맨틱 태그 탐색 — 양식 개조에도 연계 유지).
-- 실행은 결재 트랜잭션 커밋 후 별도 수행(실패해도 결재는 유효) — 이력은 approval_action_runs, 재실행 지원.
-- 설계: 08-26 확정(FRM-P0). 기존 하드코딩 훅 4종(연차·공문·견적·계약)은 추후 이관.

CREATE TABLE IF NOT EXISTS approval_form_actions (
  action_id text PRIMARY KEY,
  form_id text NOT NULL REFERENCES approval_forms(form_id) ON DELETE CASCADE,
  action_kind text NOT NULL,                     -- 커넥터 key(예: hr.record_resignation)
  trigger_on text NOT NULL DEFAULT 'approved',   -- approved|submitted|rejected
  field_map jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {slotKey: fieldKey | "semantic:<concept>"}
  config jsonb NOT NULL DEFAULT '{}'::jsonb,     -- 커넥터별 고정 설정(소득 구분 기본값 등)
  active integer NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approval_form_actions_form ON approval_form_actions(form_id, trigger_on, active);

CREATE TABLE IF NOT EXISTS approval_action_runs (
  run_id text PRIMARY KEY,
  action_id text NOT NULL REFERENCES approval_form_actions(action_id) ON DELETE CASCADE,
  doc_id text NOT NULL,
  status text NOT NULL,                          -- ok|failed
  detail text,                                   -- 사람이 읽는 성공 요약/실패 사유
  result jsonb,                                  -- 커넥터가 남긴 구조화 결과(생성 레코드 id 등)
  ran_at text NOT NULL
);
-- 성공 1회 멱등 — 같은 문서·액션의 ok 는 1행만(재실행은 failed 만 다시 돈다)
CREATE UNIQUE INDEX IF NOT EXISTS uq_action_runs_ok ON approval_action_runs(action_id, doc_id) WHERE status = 'ok';
CREATE INDEX IF NOT EXISTS idx_action_runs_doc ON approval_action_runs(doc_id);
