-- 275: 결재 승인 → 후속 할 일 자동 생성 배선(docs/todo-kanban-blueprint.md §11·§13-3, 2026-10-13 사용자 확정).
--   커넥터 todo.create_followup(frontend/lib/todo/approval-connector.ts)을 출장·교육 양식에 기본 배선한다.
--   양식 빌더(approval_form_actions)에서 끄거나 제목·기한 간격(config)을 바꿀 수 있다.
--   선행: 201(approval_form_actions), 274(todo_*). 해당 양식이 없으면 건너뛴다. 멱등.

-- 출장신청서 승인 → "출장보고서 작성 — {{출장지}}", 종료일 +1일 할 날, +3일 마감
INSERT INTO approval_form_actions
  (action_id, form_id, action_kind, trigger_on, field_map, config, active, sort_order, created_at, updated_at)
SELECT 'far-todo-trip-followup', 'frm-biz-trip-request', 'todo.create_followup', 'approved',
       '{"period": "trip_period", "subject": "destination"}'::jsonb,
       '{"title": "출장보고서 작성 — {{subject}}", "doOffsetDays": 1, "dueOffsetDays": 3, "priority": 2}'::jsonb,
       1, 100, now()::text, now()::text
 WHERE EXISTS (SELECT 1 FROM approval_forms f WHERE f.form_id = 'frm-biz-trip-request')
   AND NOT EXISTS (SELECT 1 FROM approval_form_actions a WHERE a.action_id = 'far-todo-trip-followup');

-- 교육신청서 승인 → "교육결과 보고 — {{교육명}}", 종료일 +1일 할 날, +5일 마감
INSERT INTO approval_form_actions
  (action_id, form_id, action_kind, trigger_on, field_map, config, active, sort_order, created_at, updated_at)
SELECT 'far-todo-education-followup', 'frm-education-request', 'todo.create_followup', 'approved',
       '{"period": "edu_period", "subject": "edu_name"}'::jsonb,
       '{"title": "교육결과 보고 — {{subject}}", "doOffsetDays": 1, "dueOffsetDays": 5, "priority": 2}'::jsonb,
       1, 100, now()::text, now()::text
 WHERE EXISTS (SELECT 1 FROM approval_forms f WHERE f.form_id = 'frm-education-request')
   AND NOT EXISTS (SELECT 1 FROM approval_form_actions a WHERE a.action_id = 'far-todo-education-followup');
