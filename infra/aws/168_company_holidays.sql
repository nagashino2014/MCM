-- 168: 사내 휴무일 지정 (2026-08-15)
--
-- 배경: 법정공휴일·명절은 외부 소스(lib/home/holidays.ts)로 판정되지만, **대체휴일·창립기념일·전체연차 사용**처럼
--       회사가 정하는 휴무일은 어디에도 기록이 없었다. 초과근무 산정은 "휴일이면 소정근로가 없어 재실 전체가
--       초과근무 대상"으로 갈리므로, 휴무일을 명확히 규정하지 않으면 산정 오류가 난다(마이그 167 참조).
-- 쓰임: ①초과근무 대조(lib/payroll/overtime.ts loadOffDays) ②홈·일정 캘린더 붉은 표시 + 휴무일명.
CREATE TABLE IF NOT EXISTS company_holidays (
  holiday_date date PRIMARY KEY,
  name         text NOT NULL,               -- 휴무일명(캘린더 표시) 예: '창립기념일'
  reason       text NOT NULL,               -- substitute | foundation | collective_leave
  note         text,
  created_by   text,
  created_at   text NOT NULL DEFAULT now()::text,
  updated_at   text NOT NULL DEFAULT now()::text
);
CREATE INDEX IF NOT EXISTS idx_company_holidays_date ON company_holidays(holiday_date);
