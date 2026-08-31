-- 203: 초과근무 식대 사용 검증 — 경고 이력 (2026-08-27 확정)
-- 사규: 초과근무 시 저녁 식대는 평일 2시간 이상 근무 신청, 휴일은 4시간 이상 근무 신청일
-- 때만 인정한다. 지출결의서(frm-expense-report) 상신 시 서버가 식대(복리후생비) 행의
-- 사용일·결제시각(법인카드 card_transactions / 개인영수증 personal_receipts)과 그 날의
-- 초과근무 신청 시간을 대조해, 기준 미달이면 field_values._meal_check 스냅샷(결재 화면
-- 경고 배너) + 이 테이블에 이력을 남긴다. 1차는 경고, 재발(과거 이력 존재) 시 배너에
-- 반환 청구 검토 대상으로 표시한다 — 상신 차단은 하지 않는다(불지급/경고는 결재자 판단).
-- 로직: frontend/lib/approval/overtime-meal.ts (submitDoc 트랜잭션 내 호출).

CREATE TABLE IF NOT EXISTS overtime_meal_warnings (
  warning_id       text PRIMARY KEY,                -- 'omw-' + doc_id + '-' + 행번호
  employee_id      text NOT NULL REFERENCES employee_profiles(employee_id) ON DELETE CASCADE,
  doc_id           text NOT NULL,                   -- 지출결의서 문서
  used_on          date NOT NULL,                   -- 식대 사용일
  row_no           integer NOT NULL,                -- expenses 표 행 순번(1부터)
  vendor           text,                            -- 사용처(상호)
  amount           numeric,                         -- 금액
  paid_at_hm       text,                            -- 결제 시각 'HH:MM' (수기 행 등 미상은 NULL)
  is_off_day       boolean NOT NULL DEFAULT false,  -- 휴일 여부(기준 분기)
  required_minutes integer NOT NULL,                -- 인정 기준(평일 120 / 휴일 240)
  applied_minutes  integer NOT NULL,                -- 그 날 초과근무 신청 분(진행+승인 합)
  created_at       text NOT NULL DEFAULT now()::text
);

-- 재상신 멱등: 같은 문서의 이력은 상신 때마다 전량 재작성한다(lib 쪽 DELETE 후 INSERT).
CREATE INDEX IF NOT EXISTS idx_omw_doc ON overtime_meal_warnings (doc_id);
-- 재발 판정(직원별 과거 경고 조회)용
CREATE INDEX IF NOT EXISTS idx_omw_emp ON overtime_meal_warnings (employee_id, used_on);
