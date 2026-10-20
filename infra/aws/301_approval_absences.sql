-- 301: 전자결재 부재 설정(대결·건너뛰기) + 단계 처리 유형·생략 사유 + 전결 권한 표 — DA-0.
--
-- 배경(2026-10-20 사용자 요청·결정, docs/e-approval-delegation-blueprint.md §9 D-1~D-5 확정):
--   결재자가 해외여행 등으로 결재할 수 없을 때 미리 부재 기간·방식을 지정해 두면
--   중간 단계는 대결자가 대신 결재하거나(delegate) 다음 결재자로 넘어간다(skip).
--   - 최종 결재자(최대 step_order) 단계에는 부재를 적용하지 않는다 — 본인 결재로만 결재라인 종료(D-2).
--   - 승인된 휴가신청서 + 기존 approval_delegates(휴가 시 기본 대결자)도 계속 인정(D-1).
--   - [전결] 버튼은 approval_final_rules 의 양식별 지정 인원·부서장에게만(D-3). 표만 만들고 행은 넣지 않는다.
-- 이 마이그레이션은 표·열만 추가한다. 라우팅 동작 변경은 앱(DA-1)에서. 새 권한 키 없음. 멱등.

-- 1) 부재 설정 — 한 사람이 여러 기간을 등록할 수 있고, 겹치면 최근 등록분(created_at)이 우선.
CREATE TABLE IF NOT EXISTS approval_absences (
  absence_id       text PRIMARY KEY,
  user_id          text NOT NULL,                       -- 부재 결재자
  start_date       text NOT NULL,                       -- YYYY-MM-DD (KST)
  end_date         text NOT NULL,                       -- YYYY-MM-DD (KST, 포함)
  mode             text NOT NULL CHECK (mode IN ('delegate', 'skip')),
  delegate_user_id text,                                -- mode=delegate 일 때 필수
  reason           text,                                -- 해외출장·휴가·교육·기타 등 자유 입력
  allow_self_act   integer NOT NULL DEFAULT 1,          -- 부재 중에도 원결재자 본인 처리 허용(D-4)
  created_by       text NOT NULL,                       -- 본인 또는 관리자 대리 등록
  created_at       text NOT NULL,
  updated_at       text NOT NULL,
  canceled_at      text,
  CONSTRAINT approval_absences_period_chk CHECK (
    start_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND end_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND start_date <= end_date
  ),
  CONSTRAINT approval_absences_delegate_chk CHECK (
    (mode = 'delegate' AND delegate_user_id IS NOT NULL AND delegate_user_id <> user_id)
    OR (mode = 'skip' AND delegate_user_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_approval_absences_user
  ON approval_absences(user_id, start_date, end_date) WHERE canceled_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_approval_absences_start
  ON approval_absences(start_date) WHERE canceled_at IS NULL;

-- 2) 단계 처리 유형·생략 사유·근거 부재.
--    act_type: normal(본인) | proxy(대결) | final(전결). NULL = 301 이전 처리분(=normal 취급).
--    skip_reason: rejected(반려로 나머지 생략) | absence(부재 건너뛰기) | final(전결로 상위 생략).
ALTER TABLE approval_steps ADD COLUMN IF NOT EXISTS act_type text
  CHECK (act_type IS NULL OR act_type IN ('normal', 'proxy', 'final'));
ALTER TABLE approval_steps ADD COLUMN IF NOT EXISTS skip_reason text
  CHECK (skip_reason IS NULL OR skip_reason IN ('rejected', 'absence', 'final'));
ALTER TABLE approval_steps ADD COLUMN IF NOT EXISTS absence_id text;

-- 기존 skipped 단계는 반려 경로(actOnDoc)에서만 생겼다 → 사유 rejected 로 백필(재실행 시 0행).
UPDATE approval_steps SET skip_reason = 'rejected'
 WHERE status = 'skipped' AND skip_reason IS NULL;

-- 3) 전결 권한(양식별). 행이 없으면 아무도 전결할 수 없다. 관리 화면은 DA-3.
CREATE TABLE IF NOT EXISTS approval_final_rules (
  rule_id     text PRIMARY KEY,
  form_id     text NOT NULL,                            -- '*' = 전 양식
  user_id     text,                                     -- 특정 사람(예: 본부장)
  dept_head   integer NOT NULL DEFAULT 0,               -- 1 = 기안 부서의 부서장에게 전결 허용
  max_amount  numeric,                                  -- (DA-4) 금액 상한, NULL = 제한 없음
  created_at  text NOT NULL,
  CONSTRAINT approval_final_rules_target_chk CHECK (user_id IS NOT NULL OR dept_head = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_final_rules
  ON approval_final_rules(form_id, COALESCE(user_id, ''), dept_head);

-- 4) 알림 이벤트 채널 설정 시드 — 발송 코드는 DA-2. 운영자가 바꾼 값은 보존(DO NOTHING).
INSERT INTO approval_notify_settings (event, email_enabled, alimtalk_enabled, remind_after_hours, updated_at) VALUES
  ('absence_skipped', 1, 0, NULL, now()::text),
  ('proxy_done',      1, 0, NULL, now()::text),
  ('final_absent',    1, 0, NULL, now()::text),
  ('final_approved',  1, 1, NULL, now()::text)
ON CONFLICT (event) DO NOTHING;
