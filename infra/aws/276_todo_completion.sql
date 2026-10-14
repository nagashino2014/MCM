-- 276: To-do 완료 처리 보완 — 완료 조건·완료 메모·검토 경유 시각·보드 기본 완료 조건(2026-10-14 사용자 지적 3건).
--   사용자 지적: 완료 목록을 볼 메뉴가 없음 / 실수 완료 복구 필요 / 완료 조건(필수 입력) 설정 필요.
--   - todo_items.complete_rules   : jsonb {subtasks: bool(하위 작업 모두 완료), note: bool(완료 메모 필수), review: bool(검토 단계 경유)}
--                                   완료(status→done) 시 lib/todo/completion.ts 가 검사하고 미충족이면 409(code complete_rules).
--   - todo_items.completion_note  : 완료 메모(규칙 note 가 켜져 있으면 필수, 아니어도 입력 가능)
--   - todo_items.reviewed_at      : status 가 review 로 바뀐 시각(ISO) — 규칙 review 의 근거. 되돌리기(reopen)에도 보존한다.
--   - todo_boards.default_complete_rules : 보드 기본 완료 조건 — 프로젝트·부서 보드에서 만든 할 일은 생성 시 복사(입력에 completeRules 가 있으면 우선).
--   선행: 274(todo_*). GRANT 없음(265 default privileges). 멱등.

ALTER TABLE todo_items ADD COLUMN IF NOT EXISTS complete_rules  jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE todo_items ADD COLUMN IF NOT EXISTS completion_note text;
ALTER TABLE todo_items ADD COLUMN IF NOT EXISTS reviewed_at     text;

ALTER TABLE todo_boards ADD COLUMN IF NOT EXISTS default_complete_rules jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 완료 목록(completed_at 내림차순)·보관함 조회용.
CREATE INDEX IF NOT EXISTS idx_todo_items_completed ON todo_items(completed_at DESC) WHERE status = 'done';
