-- 356 회사소개서 기술인력 명단 넣기/빼기(사용자 지시 2026-11-12)
-- catalog_people_meta.tech_override: NULL 자동 · 1 명단에 넣기 · 0 기술인력 빼기. 구획(임원진·기술인력)과 별개.
--   자동 = 대행업 기술인력 등급(고급인력·일반인력) 보유자를 기술인력 인원(staff.technical)에 세고,
--          그중 기술인력 구획인 사람만 명단(C15)에 싣는다. 임원 구획 등급 보유자(정득종 총괄본부장·신총식 부사장)는 임원진 쪽에 남는다.
-- 명단에 넣기: 한도경 부장·조옥환 부장·이홍길 울산지사장(임원 구획이어도 명단), 이재영 부장(SW 개발 총괄, 등급 없음 — 대표이사 의견).
--   재직자 중 같은 이름이 하나일 때만, 이미 정한 값이 있으면 건너뛴다. 구획·게재(임원진 카드)는 건드리지 않는다.
ALTER TABLE catalog_people_meta ADD COLUMN IF NOT EXISTS tech_override int;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'catalog_people_meta_tech_override_check') THEN
    ALTER TABLE catalog_people_meta ADD CONSTRAINT catalog_people_meta_tech_override_check CHECK (tech_override IN (0, 1));
  END IF;
END $$;

DO $$
DECLARE
  ts text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  nm text;
  n int;
  id_p text;
BEGIN
  FOREACH nm IN ARRAY ARRAY['한도경', '조옥환', '이홍길', '이재영'] LOOP
    SELECT COUNT(*) INTO n FROM employee_profiles WHERE COALESCE(status, 'active') = 'active' AND name = nm;
    IF n <> 1 THEN
      RAISE NOTICE '356: 재직자 %이(가) %명이라 기술인력 명단 넣기를 건너뜁니다(인물 노출 관리 등급 칸에서 직접 고르세요).', nm, n;
      CONTINUE;
    END IF;
    SELECT employee_id INTO id_p FROM employee_profiles WHERE COALESCE(status, 'active') = 'active' AND name = nm;
    INSERT INTO catalog_people_meta (employee_id, tech_override, updated_at)
    VALUES (id_p, 1, ts)
    ON CONFLICT (employee_id) DO UPDATE SET tech_override = 1, updated_at = EXCLUDED.updated_at
      WHERE catalog_people_meta.tech_override IS NULL;
  END LOOP;
END $$;
