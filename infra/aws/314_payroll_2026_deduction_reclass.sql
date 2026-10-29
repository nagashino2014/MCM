-- 314_payroll_2026_deduction_reclass.sql
-- 2026년 2~4월 급여대장 공제 라인 재분류(2026-10-29 사용자 확인).
-- 세무사 대장의 공제 열 구성이 달마다 달라 생긴 적재 오류다:
--   · 기본형(25.09~26.01, 26.05~): … 정산-지방소득세 | 공제_선지급분 | 공제_학자금상환
--   · 연말정산형(26.02~04): 연말정산 3열 추가 … 정산-지방소득세 | 그외공제 — 선지급분·학자금 열이 없다.
--   → 2월은 두 금액이 그외공제(misc-ded)에 합산, 3·4월은 정산-고용보험·정산-근로소득세 열에 기입됐다.
-- 선지급분(급여일 전에 먼저 이체한 상여·성과급·주거비지원)은 advance-ded 로 옮겨 연간 '급여일 외 지급'에 잡히게 하고,
-- 학자금 상환은 student-loan 으로 옮겨 정산-근로소득세(원천징수 소득세 합산)에서 뺀다.
-- 공제 항목끼리의 이동이라 지급합계·공제합계·차인지급액·전표(총액 기준)는 변하지 않는다.
-- 대상은 파이프라인(scripts/payroll_import)이 부여한 행 ID(대장-r행순번)로 지정한다 — 저장소에 성명을 남기지 않는다.
-- 멱등: 원래 라인(행 ID·항목·금액 일치)이 있을 때만 옮기고, 옮긴 뒤 재실행하면 0건.

DO $$
DECLARE
  r record;
  src_line text;
  hits integer;
  moved integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- 2월: 그외공제 = 선지급분 + 학자금
      ('pled-202602-salary-r001', 'misc-ded',      12865470::float8, 'advance-ded',  12500000::float8, 'student-loan', 365470::float8),
      ('pled-202602-salary-r010', 'misc-ded',       1000000::float8, 'advance-ded',   1000000::float8, NULL,           NULL::float8),
      -- 3·4월: 정산-고용보험 열 = 선지급분
      ('pled-202603-salary-r003', 'settle-ei',     12000000::float8, 'advance-ded',  12000000::float8, NULL,           NULL::float8),
      ('pled-202603-salary-r010', 'settle-ei',       500000::float8, 'advance-ded',    500000::float8, NULL,           NULL::float8),
      ('pled-202603-salary-r014', 'settle-ei',       500000::float8, 'advance-ded',    500000::float8, NULL,           NULL::float8),
      ('pled-202604-salary-r010', 'settle-ei',       500000::float8, 'advance-ded',    500000::float8, NULL,           NULL::float8),
      -- 3·4월: 정산-근로소득세 열 = 학자금 상환
      ('pled-202603-salary-r001', 'settle-income',   365470::float8, 'student-loan',   365470::float8, NULL,           NULL::float8),
      ('pled-202604-salary-r001', 'settle-income',   365470::float8, 'student-loan',   365470::float8, NULL,           NULL::float8)
    ) AS v(entry_id, from_item, from_amount, to_item, to_amount, split_item, split_amount)
  LOOP
    SELECT count(*), min(l.line_id) INTO hits, src_line
      FROM payroll_entry_lines l
      JOIN payroll_entries e ON e.entry_id = l.entry_id
      JOIN payroll_ledgers g ON g.ledger_id = e.ledger_id
     WHERE l.entry_id = r.entry_id AND g.source = 'excel'
       AND l.item_id = r.from_item AND l.amount = r.from_amount;
    IF hits <> 1 THEN
      RAISE NOTICE '314 건너뜀: % % %원 — 일치 라인 %건', r.entry_id, r.from_item, r.from_amount, hits;
      CONTINUE;
    END IF;
    -- 같은 직원 행에 대상 항목 라인이 이미 있으면 합치지 않고 멈춘다(대장 상세는 항목당 1라인 전제)
    IF EXISTS (SELECT 1 FROM payroll_entry_lines
                WHERE entry_id = r.entry_id AND item_id IN (r.to_item, COALESCE(r.split_item, r.to_item))) THEN
      RAISE NOTICE '314 건너뜀: % — 대상 항목 라인이 이미 있음', r.entry_id;
      CONTINUE;
    END IF;
    UPDATE payroll_entry_lines SET item_id = r.to_item, amount = r.to_amount WHERE line_id = src_line;
    IF r.split_item IS NOT NULL THEN
      INSERT INTO payroll_entry_lines (line_id, entry_id, item_id, amount)
      VALUES (r.entry_id || '-' || r.split_item, r.entry_id, r.split_item, r.split_amount);
    END IF;
    moved := moved + 1;
  END LOOP;
  RAISE NOTICE '314: 공제 라인 %건 재분류', moved;
END $$;
