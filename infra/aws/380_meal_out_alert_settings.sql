-- 380: 식사 외출 반복 경고 설정 (2026-11-26 사용자 요청)
-- 식대 결제 후 사무실 복귀까지(식사 외출 대조, lib/approval/meal-return.ts) 기준 시간 이상 걸린 날이
-- 최근 기간 안에 정해진 횟수 이상 반복되면, 그 직원이 초과근무 신청서를 쓸 때 양식 위에 경고를 띄운다.
-- 몇 분 이상·며칠 동안·몇 회 이상일 때 띄울지는 관리자가 근태·초과근무 관리 > 식사 외출 대조 탭에서 정한다.
-- 단일 행 'default'. 기본값: 사용 · 60분 이상 · 최근 30일 · 3회 이상.
-- ADT·intel 배치가 쓰는 표(adt_*, attendance_*, intel_*)와 분리한 새 표다 — 배치 스키마 영향 없음.

CREATE TABLE IF NOT EXISTS meal_out_alert_settings (
  id               text PRIMARY KEY DEFAULT 'default',
  enabled          boolean NOT NULL DEFAULT true,
  long_out_minutes integer NOT NULL DEFAULT 60,   -- 결제 후 복귀가 이 분 이상이면 '긴 외출'
  lookback_days    integer NOT NULL DEFAULT 30,   -- 최근 며칠을 볼지(신청서 작성일 기준)
  repeat_count     integer NOT NULL DEFAULT 3,    -- 긴 외출 날이 이 횟수 이상이면 경고
  updated_by       text,
  updated_at       text NOT NULL DEFAULT now()::text,
  CONSTRAINT meal_out_alert_settings_single CHECK (id = 'default'),
  CONSTRAINT meal_out_alert_settings_range CHECK (
    long_out_minutes BETWEEN 10 AND 600 AND lookback_days BETWEEN 7 AND 365 AND repeat_count BETWEEN 1 AND 50
  )
);

INSERT INTO meal_out_alert_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- GRANT 없음(265 default privileges). 멱등.
