-- 133: 특별휴가 원장 — 장기근속휴가·초과근무 대체휴가의 부여/사용/조정 이력.
-- 연차 대장(annual_leave_ledger)과 분리한다: 연차 잔여 산식이 grant/adjust 전체 합이라
-- 특별휴가 부여를 같은 원장에 넣으면 연차 부여분에 합산돼 잔여가 오염된다.
-- 홈 '내 연차·초과근무' 카드가 본인 잔여(kind별 Σgrant+adjust−Σuse)를 표시한다.
-- 관례: 멱등.

CREATE TABLE IF NOT EXISTS special_leave_ledger (
  entry_id text PRIMARY KEY,
  employee_id text NOT NULL,
  kind text NOT NULL,                 -- 'longevity'(장기근속휴가) | 'overtime_comp'(초과근무 대체휴가)
  entry_type text NOT NULL,           -- grant | use | adjust
  days numeric NOT NULL,              -- 부여/사용 일수(use 도 양수로 기록)
  effective_on text,                  -- 부여/사용일 YYYY-MM-DD
  expires_on text,                    -- 소멸일(부여분에만, 없으면 무기한)
  doc_id text,                        -- 결재 문서 연동 시(선택)
  note text,
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_special_leave_emp ON special_leave_ledger(employee_id, kind);
