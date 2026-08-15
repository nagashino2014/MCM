-- 169: 매년 반복되는 사내 휴무일 (2026-08-15)
--
-- 배경: 창립기념일처럼 **매년 같은 월일**에 돌아오는 휴무일을 168의 날짜 단위 지정으로 관리하면
--       해가 바뀔 때마다 다시 찍어야 한다. 월·일만 등록해 두고 조회 시점의 연도로 전개한다.
-- 우선순위: 같은 날짜에 168(특정일 지정)이 있으면 그쪽이 이긴다(더 구체적인 지정).
CREATE TABLE IF NOT EXISTS company_annual_holidays (
  month      smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
  day        smallint NOT NULL CHECK (day BETWEEN 1 AND 31),
  name       text NOT NULL,
  reason     text NOT NULL,              -- substitute | foundation | collective_leave
  note       text,
  created_by text,
  created_at text NOT NULL DEFAULT now()::text,
  updated_at text NOT NULL DEFAULT now()::text,
  PRIMARY KEY (month, day)
);
