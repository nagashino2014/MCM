-- 353: 고정 결재선 — 기안자별 추가 결재자·참조·열람 규칙.
--
-- 배경(2026-11-11 사용자 요청):
--   양식별 고정 결재선(335)을 쓰면서 "내 결재선에 OOO를 넣어 달라"는 직원 요청이 잦다.
--   고정 결재선은 그대로 두고, 관리자가 직원(기안자)별로 결재자를 덧붙이고 참조·열람자를 정할 수 있게 한다.
--   - kind 'approve': 그 직원이 기안한 문서의 고정 결재선에 결재자를 끼운다(position: 맨 앞·마지막 결재자 앞·맨 뒤).
--     고정 결재선이 강제되지 않는 양식(자유 지정·초안)에는 넣지 않는다 — 기안자가 직접 고르면 된다.
--   - kind 'ref'·'view': 그 직원이 기안한 문서에 참조·열람자로 넣는다(모든 양식 고정 참조·열람(346)과 함께 적용,
--     같은 사람이면 이 규칙의 구분이 이긴다).
--   - form_id '*' = 모든 양식, 양식 행이 같은 사람의 '*' 행을 덮어쓴다.
--   - 기안자 본인·이미 결재선에 있는 사람·퇴사자는 건너뛴다(상신을 막지 않는다).
-- 335·346 과 같이 외래키는 두지 않는다. 새 권한 키 없음(approval.manage). 시드 없음. 멱등.

CREATE TABLE IF NOT EXISTS approval_line_user_rules (
  rule_id         text PRIMARY KEY,
  drafter_user_id text NOT NULL,
  form_id         text NOT NULL DEFAULT '*',
  kind            text NOT NULL CHECK (kind IN ('approve', 'ref', 'view')),
  target_user_id  text NOT NULL,
  position        text CHECK (position IS NULL OR position IN ('first', 'before_last', 'last')),
  note            text,
  updated_by      text,
  updated_at      text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_line_user_rules
  ON approval_line_user_rules(drafter_user_id, form_id, target_user_id);
CREATE INDEX IF NOT EXISTS idx_approval_line_user_rules_drafter
  ON approval_line_user_rules(drafter_user_id);
