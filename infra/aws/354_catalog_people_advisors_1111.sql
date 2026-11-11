-- 354 회사소개서 인물 — 임원진 학력·자격 직접 입력 칸 + 외부자문위원 17명 + 임원진 자리 바꾸기(사용자 지시 2026-11-11)
--
-- 1) 칸: 임원진 카드 학력·자격을 인물 노출 관리에서 직접 고친다.
--    catalog_people_meta.edu_override·cert_override(비우면 인사 기록), catalog_extra_people.edu·cert(촉탁 임원은 인사 기록이 없다).
-- 2) 외부자문위원: 자문위원 표가 비어 있을 때만 17명을 넣는다(이름은 받은 자료대로 가운데 글자를 ○ 로 가린 상태 —
--    실명은 회사소개서 > 인물 노출 관리 > 자문위원에서 고친다).
-- 3) 임원진 자리: 권오종 부사장 자리 → 김명호 경영이사, 김명호 경영이사 자리 → 심무경 고문(촉탁, 사용자관리에 없으면 직접 입력 임원으로),
--    이홍길 울산지사장 자리 → 조옥환 부장(구획 임원진). 권오종·이홍길은 임원진에서 뺀다(게재 '빼기').
--    지금 임원진 순서(순서 번호 → 직급 서열 → 입사일·이름, 직접 입력 임원은 같은 순서 번호에서 뒤)를 10 단위 순서 번호로 굳힌 뒤 바꾼다.
--    한 번만 한다 — 심무경이 이미 있거나 권오종이 이미 '빼기'면 건너뛴다. 이름이 없거나 둘 이상이면 알림만 남기고 건너뛴다.
-- 이력 출처: 260420 보유기술인력 이력사항(한국환경안전연구원 7인).pdf — 심○경 고문·조○환 부장.

ALTER TABLE catalog_people_meta ADD COLUMN IF NOT EXISTS edu_override text;
ALTER TABLE catalog_people_meta ADD COLUMN IF NOT EXISTS cert_override text;
ALTER TABLE catalog_extra_people ADD COLUMN IF NOT EXISTS edu text;
ALTER TABLE catalog_extra_people ADD COLUMN IF NOT EXISTS cert text;

-- ── 2) 외부자문위원 17명 ──
DO $$
DECLARE
  ts text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  IF EXISTS (SELECT 1 FROM catalog_advisors) THEN
    RAISE NOTICE '354: 자문위원이 이미 있어 17명 입력을 건너뜁니다.';
    RETURN;
  END IF;
  INSERT INTO catalog_advisors (advisor_id, name, field, org, title, career, order_no, is_public, created_at, updated_at, updated_by)
  SELECT 'cad_354_' || lpad(v.n::text, 2, '0'), v.name, v.field, v.org, v.title, v.career, v.n, 1, ts, ts, NULL
    FROM (VALUES
      (1,  '이○호', '총괄',               '법무법인 율촌',               '전문위원',     '(前) 환경부 환경정책실장, 기획재정담당관 등'),
      (2,  '최○철', '법률자문',           '법무법인 광장',               '환경전문위원', '(前) 수도권매립지관리공사 환경에너지타운 본부장'),
      (3,  '홍○형', '대기',               '인하대학교 환경연구소',       '연구교수',     '(前) 국립환경과학원 기후대기연구부 부장'),
      (4,  '한○석', '대기',               '안양대학교',                  '부교수',       '(現) 한국냄새환경학회 회장'),
      (5,  '김○호', '악취, VOC, 비산배출', '한서대학교',                  '교수',         '(現) 대기오염물질심사·평가위원회 회원'),
      (6,  '문○구', '악취',               '㈜태성환경연구소',            '상무',         '(現) 수도권매립지관리공사 악취 자문위원'),
      (7,  '김○호', '비산먼지',           '환경오염피해예방협회',        '부회장',       '(現) (사)한국피해예방협회 부회장'),
      (8,  '박○규', '소음·진동',          '연세대학교 환경공학부',       '교수',         '(現) 연세대학교 환경과학기술연구소 소장'),
      (9,  '조○희', '소음·진동',          '㈜삼우에이엔씨',              '대표이사',     '(現) 사단법인 한국소음진동기술사회 감사'),
      (10, '서○범', '수질, 비점오염',     '안양대학교 환경에너지공학부', '교수',         '(前) 국립환경연구원 연구관'),
      (11, '권○상', '수질, 비점오염',     '상지대학교',                  '교수',         '(前) 국립환경과학원 환경기반 연구부장'),
      (12, '서○철', '폐기물',             '연세대학교',                  '교수',         '(現) 세계폐기물에너지기술협의회 아시아지부 부회장'),
      (13, '오○천', '폐기물',             '공주대학교',                  '교수',         '(現) 환경부 환경표준심의회 폐기물관리 전문위원'),
      (14, '김○승', '토양',               '서울대학교',                  '교수',         '(現) 국가환경표준전문위원회 토양분과위원장'),
      (15, '이○효', '토양',               '한국환경산업연구원',          '기술고문',     '(前) 한국지하수토양환경학회 회장'),
      (16, '김○록', '측정기기',           '한림대학교 환경생명공학과',   '교수',         '(現) (사)굴뚝자동측정기기협회 사무총장'),
      (17, '김○준', '환경 인허가',        '도움엔텍',                    '대표이사',     '(前) 인천시 수도권매립지 정책개선 단장, 인천서구청 환경관리과장')
    ) AS v(n, name, field, org, title, career);
  RAISE NOTICE '354: 외부자문위원 17명을 넣었습니다.';
END $$;

-- ── 3) 임원진 자리 바꾸기 ──
DO $$
DECLARE
  ts text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  manager_rank int := COALESCE((SELECT MAX(rank_order) FROM positions WHERE position_name = '부장'), 70);
  id_kwon text; id_kim text; id_lee text; id_cho text; id_sim text;
  o_kwon int; o_kim int; o_lee int;
  sim_bio text := '44년 · 前 대구지방환경청장·낙동강유역환경청장(환경부 고위공무원), 한국순환자원유통지원센터 상임이사·이사장, 국립공원공단 상임감사, (사)한국환경기술인협회 회장';
  cho_bio text := '통합환경1본부장 · 강릉안인화력 1·2호기, 삼척화력 1·2호기 등 통합환경허가 취득 용역 연구';
  n int;
BEGIN
  IF EXISTS (SELECT 1 FROM catalog_extra_people WHERE name = '심무경') THEN
    RAISE NOTICE '354: 심무경 고문이 이미 직접 입력 임원에 있어 임원진 자리 바꾸기를 건너뜁니다.';
    RETURN;
  END IF;

  -- 이름 → 재직자(동명이인이면 건너뜀)
  SELECT COUNT(*) INTO n FROM employee_profiles WHERE COALESCE(status, 'active') = 'active' AND name IN ('권오종', '김명호', '이홍길', '조옥환')
    GROUP BY name HAVING COUNT(*) > 1 LIMIT 1;
  IF n IS NOT NULL THEN
    RAISE NOTICE '354: 권오종·김명호·이홍길·조옥환 중 같은 이름의 재직자가 둘 이상이라 임원진 자리 바꾸기를 건너뜁니다.';
    RETURN;
  END IF;
  SELECT employee_id INTO id_kwon FROM employee_profiles WHERE COALESCE(status, 'active') = 'active' AND name = '권오종';
  SELECT employee_id INTO id_kim  FROM employee_profiles WHERE COALESCE(status, 'active') = 'active' AND name = '김명호';
  SELECT employee_id INTO id_lee  FROM employee_profiles WHERE COALESCE(status, 'active') = 'active' AND name = '이홍길';
  SELECT employee_id INTO id_cho  FROM employee_profiles WHERE COALESCE(status, 'active') = 'active' AND name = '조옥환';
  SELECT employee_id INTO id_sim  FROM employee_profiles WHERE COALESCE(status, 'active') = 'active' AND name = '심무경' LIMIT 1;
  IF id_kwon IS NULL OR id_kim IS NULL OR id_lee IS NULL OR id_cho IS NULL THEN
    RAISE NOTICE '354: 재직자 중 권오종(%)·김명호(%)·이홍길(%)·조옥환(%)을 모두 찾지 못해 임원진 자리 바꾸기를 건너뜁니다.', id_kwon, id_kim, id_lee, id_cho;
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM catalog_people_meta WHERE employee_id = id_kwon AND display_override = 'never') THEN
    RAISE NOTICE '354: 권오종이 이미 임원진에서 빠져 있어 자리 바꾸기를 건너뜁니다.';
    RETURN;
  END IF;

  -- 지금 임원진 순서(소개서 렌더러 data.ts leaderItems 와 같은 규칙)를 10 단위 순서 번호로 굳힌다
  CREATE TEMP TABLE _354_lead ON COMMIT DROP AS
  WITH emp AS (
    SELECT e.employee_id AS id, 'e'::text AS kind, p.position_name, COALESCE(p.rank_order, 0) AS rnk, m.order_no,
           row_number() OVER (ORDER BY m.order_no ASC NULLS LAST, p.rank_order DESC NULLS LAST, e.hired_at ASC NULLS LAST, e.name ASC) AS seq
      FROM employee_profiles e
      LEFT JOIN positions p ON p.position_id = e.position_id
      LEFT JOIN catalog_people_meta m ON m.employee_id = e.employee_id
     WHERE COALESCE(e.status, 'active') = 'active'
       AND COALESCE(m.section_override, CASE WHEN p.rank_order > manager_rank THEN 'exec' ELSE 'staff' END) = 'exec'
       AND COALESCE(m.display_override, 'auto') <> 'never'
  ), ceo AS (
    SELECT id FROM emp WHERE position_name = '대표이사' ORDER BY seq LIMIT 1
  ), ext AS (
    SELECT x.person_id AS id, 'x'::text AS kind, NULL::text AS position_name, 0 AS rnk, x.order_no,
           100000 + row_number() OVER (ORDER BY x.order_no ASC NULLS LAST, x.name ASC) AS seq
      FROM catalog_extra_people x WHERE x.is_public = 1
  ), allp AS (
    SELECT emp.id, emp.kind, CASE WHEN emp.id = (SELECT id FROM ceo) THEN -1 ELSE COALESCE(emp.order_no, 1000) END AS ord, emp.rnk, emp.seq FROM emp
    UNION ALL
    SELECT ext.id, ext.kind, COALESCE(ext.order_no, 1000), ext.rnk, ext.seq FROM ext
  )
  SELECT id, kind, 10 * row_number() OVER (ORDER BY ord, rnk DESC, seq) AS new_order FROM allp;

  SELECT new_order INTO o_kwon FROM _354_lead WHERE kind = 'e' AND id = id_kwon;
  SELECT new_order INTO o_kim  FROM _354_lead WHERE kind = 'e' AND id = id_kim;
  SELECT new_order INTO o_lee  FROM _354_lead WHERE kind = 'e' AND id = id_lee;
  IF o_kwon IS NULL OR o_kim IS NULL OR o_lee IS NULL THEN
    RAISE NOTICE '354: 권오종(%)·김명호(%)·이홍길(%) 중 지금 임원진에 없는 사람이 있어 자리 바꾸기를 건너뜁니다.', o_kwon, o_kim, o_lee;
    RETURN;
  END IF;

  INSERT INTO catalog_people_meta (employee_id, order_no, updated_at)
  SELECT id, new_order, ts FROM _354_lead WHERE kind = 'e'
  ON CONFLICT (employee_id) DO UPDATE SET order_no = EXCLUDED.order_no, updated_at = EXCLUDED.updated_at;
  UPDATE catalog_extra_people x SET order_no = l.new_order, updated_at = ts FROM _354_lead l WHERE l.kind = 'x' AND l.id = x.person_id;

  -- 김명호 → 권오종 자리, 조옥환 → 이홍길 자리(구획 임원진·항상 싣기), 권오종·이홍길 빼기
  UPDATE catalog_people_meta SET order_no = o_kwon, updated_at = ts WHERE employee_id = id_kim;
  INSERT INTO catalog_people_meta (employee_id, order_no, section_override, display_override, bio_short, edu_override, cert_override, updated_at)
  VALUES (id_cho, o_lee, 'exec', 'always', cho_bio, '안양대학교 환경공학 학사', '대기관리기술사, 수질환경기사, 폐기물처리기사, 소음진동기사', ts)
  ON CONFLICT (employee_id) DO UPDATE SET
    order_no = EXCLUDED.order_no, section_override = 'exec', display_override = 'always',
    bio_short = COALESCE(NULLIF(catalog_people_meta.bio_short, ''), EXCLUDED.bio_short),
    edu_override = COALESCE(NULLIF(catalog_people_meta.edu_override, ''), EXCLUDED.edu_override),
    cert_override = COALESCE(NULLIF(catalog_people_meta.cert_override, ''), EXCLUDED.cert_override),
    updated_at = EXCLUDED.updated_at;
  UPDATE catalog_people_meta SET display_override = 'never', updated_at = ts WHERE employee_id IN (id_kwon, id_lee);

  -- 심무경 고문 → 김명호 자리. 사용자관리 재직자면 그 사람을 임원진에, 아니면 직접 입력 임원(촉탁)으로
  IF id_sim IS NOT NULL THEN
    INSERT INTO catalog_people_meta (employee_id, order_no, section_override, display_override, role_label, bio_short, edu_override, cert_override, updated_at)
    VALUES (id_sim, o_kim, 'exec', 'always', '고문', sim_bio, '강원대학교 환경공학 박사', '수질환경기사, 행정사', ts)
    ON CONFLICT (employee_id) DO UPDATE SET
      order_no = EXCLUDED.order_no, section_override = 'exec', display_override = 'always',
      role_label = COALESCE(NULLIF(catalog_people_meta.role_label, ''), EXCLUDED.role_label),
      bio_short = COALESCE(NULLIF(catalog_people_meta.bio_short, ''), EXCLUDED.bio_short),
      edu_override = COALESCE(NULLIF(catalog_people_meta.edu_override, ''), EXCLUDED.edu_override),
      cert_override = COALESCE(NULLIF(catalog_people_meta.cert_override, ''), EXCLUDED.cert_override),
      updated_at = EXCLUDED.updated_at;
  ELSE
    INSERT INTO catalog_extra_people (person_id, name, role_label, employment_type, bio_short, career, edu, cert, order_no, is_public, count_in_total, created_at, updated_at)
    VALUES ('cxp_354_simmugyeong', '심무경', '고문', '촉탁', sim_bio, NULL, '강원대학교 환경공학 박사', '수질환경기사, 행정사', o_kim, 1, 1, ts, ts)
    ON CONFLICT (person_id) DO NOTHING;
  END IF;
  RAISE NOTICE '354: 임원진 자리를 바꿨습니다(김명호 %, 심무경 %, 조옥환 %; 권오종·이홍길 빼기).', o_kwon, o_kim, o_lee;
END $$;
