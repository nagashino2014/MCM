-- 088: 연차사용촉진제도(LP) — 1·2차 고지 양식 템플릿 + 고지 문서.
-- 근로기준법 연차사용촉진: 잔여 연차 있는 직원에게 7/1 1차 고지 → 직원 사용계획 회신 →
-- 미제출자에게 2차(회사 지정일) 고지. 수신 문서함(메인 홈)·클릭 전자서명.
-- 설계: docs/leave-promotion-blueprint.md. 관례: 멱등.

-- 고지 양식 문구 템플릿(1·2차) — 웹 편집. body 는 문단 배열, 치환 토큰 사용.
CREATE TABLE IF NOT EXISTS leave_notice_templates (
  round integer PRIMARY KEY,          -- 1 | 2
  title text NOT NULL,
  body jsonb NOT NULL DEFAULT '[]'::jsonb,   -- ["문단1", "문단2", ...] (치환 토큰 포함)
  updated_at text NOT NULL
);

-- 치환 토큰: {name}{granted}{used}{remaining}{deadline}{noticeDate}{planTotal}
INSERT INTO leave_notice_templates (round, title, body, updated_at) VALUES
  (1, '연차휴가 사용 촉구(1차)',
   '[
     "귀하는 {noticeDate} 기준 2026년 발생연차 {granted}일 중 {used}일을 사용하셨습니다.",
     "2026년 12월 31일까지 잔여 연차 {remaining}일의 사용을 촉구합니다. 연차휴가 사용시기를 지정하여 회신을 부탁드립니다.",
     "정해진 기한까지 연차 사용을 하지 않으면 귀하는 연차를 사용한 것으로 처리되며, 추후 미사용 연차에 대한 회사의 보상의무가 소멸됨을 안내해드립니다. (사용예정일은 자유롭게 작성하시면 되며, 사용시기가 달라져도 무방합니다.)",
     "본 제도의 취지에 맞게 연차사용을 활성화하여 충분한 휴식을 취하시길 바라겠습니다. 감사합니다.",
     "▸ 연차휴가 사용예정일 기재요망 (총 {planTotal}일)"
   ]'::jsonb, now()::text),
  (2, '연차휴가 사용 촉구(2차)',
   '[
     "귀하는 1차 연차사용촉진 고지에 대하여 사용시기를 지정하여 회신하지 않으셨습니다.",
     "이에 회사는 근로기준법에 따라 귀하의 미사용 연차 {remaining}일에 대하여 아래와 같이 사용시기를 지정하여 통보합니다.",
     "지정된 일자에 연차를 사용하지 않을 경우, 해당 연차는 사용한 것으로 처리되며 미사용 연차에 대한 회사의 보상의무가 소멸됨을 다시 한 번 안내해드립니다.",
     "▸ 회사 지정 사용일자"
   ]'::jsonb, now()::text)
ON CONFLICT (round) DO NOTHING;

-- 고지 문서 — 연도·차수·직원별 1건.
CREATE TABLE IF NOT EXISTS leave_notices (
  notice_id text PRIMARY KEY,
  year text NOT NULL,
  round integer NOT NULL,            -- 1 | 2
  employee_id text NOT NULL,
  granted double precision NOT NULL DEFAULT 0,   -- 발송 시점 스냅샷
  used double precision NOT NULL DEFAULT 0,
  remaining double precision NOT NULL DEFAULT 0,
  notice_date text NOT NULL,         -- 고지일(YYYY-MM-DD)
  deadline text,                     -- 사용 기한(보통 연말)
  status text NOT NULL DEFAULT 'sent',  -- sent(발송) | submitted(직원 회신) | assigned(2차 회사지정 확정)
  plan jsonb,                        -- 직원 사용예정일 배열 ["YYYY-MM-DD", ...] (1차 회신)
  assigned jsonb,                    -- 2차 회사 지정일 배열
  signature text,                    -- 클릭 전자서명(성명·사번·시각 요약)
  submitted_at text,
  sent_by text,
  sent_at text NOT NULL,
  created_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_notices_uniq ON leave_notices(year, round, employee_id);
CREATE INDEX IF NOT EXISTS idx_leave_notices_emp ON leave_notices(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_notices_year ON leave_notices(year, round);
