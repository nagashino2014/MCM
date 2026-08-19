-- 195: 개인카드 영수증 사용일시(paid_at) 표기 정규화 — 목록 기간 필터 복구
-- 배경(2026-08-19 원인 분석): paid_at 은 text 이고 조회가 문자열 비교라 "26-08-16"·"8/16" 같은
--   표기는 기간 필터 밖으로 떨어진다. 저장은 됐는데 지출결의서·출장보고서의 "개인카드 영수증
--   불러오기"에 영영 뜨지 않는 건이 그렇게 생겼다.
-- 앞으로는 저장·수정 라우트가 normalizePaidAt(receipt-parser.ts)으로 막고, 이미 들어간 값은 여기서 정리한다.
-- 규칙: 4자리 연도 우선, 2자리 연도는 2000년대로. 해석 불가·범위 이탈이면 NULL(날짜 미상)로 둔다 —
--   목록은 paid_at 이 비어도 촬영일(created_at) 기준으로 보여 주므로 사라지지 않는다(receipts.ts BASIS_DATE).

DO $$
DECLARE
  r      record;
  m      text[];
  y      int;
  mo     int;
  d      int;
  hh     int;
  mi     int;
  norm   text;
  fixed  int := 0;
  nulled int := 0;
BEGIN
  IF to_regclass('public.personal_receipts') IS NULL THEN
    RAISE NOTICE '195: personal_receipts 없음 — 스킵';
    RETURN;
  END IF;

  -- ISO 형태여도 실재하지 않는 날짜("2026-02-30")가 섞여 있을 수 있어 전 행을 검증한다(멱등).
  FOR r IN
    SELECT receipt_id, paid_at FROM personal_receipts WHERE paid_at IS NOT NULL
  LOOP
    norm := NULL;
    m := regexp_match(
           regexp_replace(
             regexp_replace(r.paid_at, '\s*년\s*|\s*월\s*', '-', 'g'),
             '\s*일\s*', ' ', 'g'),
           '([0-9]{4}|[0-9]{2})[-./]([0-9]{1,2})[-./]([0-9]{1,2})([ T]+([0-9]{1,2}):([0-9]{2}))?');
    IF m IS NOT NULL THEN
      BEGIN
        y  := m[1]::int;
        IF length(m[1]) = 2 THEN y := 2000 + y; END IF;
        mo := m[2]::int;
        d  := m[3]::int;
        IF mo BETWEEN 1 AND 12 AND d BETWEEN 1 AND 31 THEN
          norm := to_char(make_date(y, mo, d), 'YYYY-MM-DD');
          IF m[5] IS NOT NULL THEN
            hh := m[5]::int;
            mi := m[6]::int;
            IF hh BETWEEN 0 AND 23 AND mi BETWEEN 0 AND 59 THEN
              norm := norm || ' ' || lpad(m[5], 2, '0') || ':' || m[6];
            END IF;
          END IF;
        END IF;
      EXCEPTION WHEN others THEN
        norm := NULL; -- 2월 31일 같은 실재하지 않는 날짜 — 날짜 미상으로 둔다
      END;
    END IF;

    CONTINUE WHEN norm IS NOT DISTINCT FROM r.paid_at;

    UPDATE personal_receipts SET paid_at = norm, updated_at = to_char(now() + interval '9 hours', 'YYYY-MM-DD HH24:MI:SS')
     WHERE receipt_id = r.receipt_id;

    IF norm IS NULL THEN nulled := nulled + 1; ELSE fixed := fixed + 1; END IF;
  END LOOP;

  RAISE NOTICE '195: paid_at 정규화 % 건, 날짜 미상 처리 % 건', fixed, nulled;
END $$;
