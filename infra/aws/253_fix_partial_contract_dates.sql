-- 253: 채우다 만 계약 날짜 정리 — 계약 화면의 날짜 입력이 진행 중 값("2", "2026091")을 그대로 저장해
--  started_at 에 잘린 값이 쌓였다(2026-09-16 기준 61건). 읽는 쪽(대행 실적 보고·완료 현황)은 형식이
--  어긋나면 값을 버리므로 조용히 비어 보인다. 잘린 값은 원본을 남기고 비운다. 멱등.
--  ※ 종료일의 "용역 완료시 까지" 같은 문구는 의도된 값이라 건드리지 않는다(숫자로만 된 값만 대상).

CREATE TABLE IF NOT EXISTS contract_date_repairs (
  repair_id   text PRIMARY KEY,
  contract_id text NOT NULL,
  column_name text NOT NULL,
  old_value   text NOT NULL,
  repaired_at text NOT NULL
);

-- 원본 보존 — 같은 계약·컬럼·값은 한 번만 기록한다(재실행 안전).
INSERT INTO contract_date_repairs (repair_id, contract_id, column_name, old_value, repaired_at)
SELECT 'cdr-' || substr(md5(c.contract_id || ':' || col.name || ':' || col.value), 1, 24),
       c.contract_id, col.name, col.value, now()::text
  FROM contracts c
  CROSS JOIN LATERAL (VALUES
      ('started_at', c.started_at),
      ('ended_at', c.ended_at),
      ('contract_date', c.contract_date),
      ('permit_issued_at', c.permit_issued_at)
  ) AS col(name, value)
 WHERE col.value IS NOT NULL
   AND col.value <> ''
   AND col.value ~ '^\d{1,7}$'          -- 채우다 만 숫자만(8자리 완성·ISO·문구는 제외)
ON CONFLICT (repair_id) DO NOTHING;

UPDATE contracts SET started_at = NULL
 WHERE started_at IS NOT NULL AND started_at ~ '^\d{1,7}$';
UPDATE contracts SET ended_at = NULL
 WHERE ended_at IS NOT NULL AND ended_at ~ '^\d{1,7}$';
UPDATE contracts SET contract_date = NULL
 WHERE contract_date IS NOT NULL AND contract_date ~ '^\d{1,7}$';
UPDATE contracts SET permit_issued_at = NULL
 WHERE permit_issued_at IS NOT NULL AND permit_issued_at ~ '^\d{1,7}$';
