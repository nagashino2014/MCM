-- 성과급 명세 lines 에 계약명 스냅샷 — 계약 미매칭 내역(엑셀 집계 행 등)도 명세서에 표시하고,
-- 향후 계약명 변경에도 산정 당시 명칭을 보존한다(스냅샷 철학).
ALTER TABLE bonus_statement_lines
  ADD COLUMN IF NOT EXISTS contract_title text;
