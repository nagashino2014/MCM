-- 325: 통합허가 대상 업종 단일 원천(permit_industries) + 관리 화면 권한.
--   (2026-11-01 사용자 요청 — 통합허가 대상 업종이 20개에서 28개로 늘어나므로, 관리자 설정의 '통합허가 업종'
--    화면 하나에서 추가·수정·사용 중지하면 사업장 마스터·계약관리·영업/마케팅·AI 분류 프롬프트에 함께 반영한다.)
-- 배경: 업종 목록이 frontend 두 목록(lib/ieps/integrated-permit-industries.ts {id,KSIC},
--   lib/ieps/integrated-permit.ts {label,keywords}), intel_settings industries.list(065), contract_industry_options(011·082),
--   backend TARGET_INDUSTRIES 로 흩어져 있었다. 앱 코드는 이 표를 읽고, 표가 없으면(적용 전) 코드의 기본 20개로 동작한다.
-- 규칙
--   industry_id : 고정 slug. 저장 데이터(intel_signals.industry·intel_projects.industry·브리핑 filters.industries 등)가 이 값을 쓴다.
--                 이름을 바꿔도 id 는 그대로 둔다.
--   label       : 화면 이름. contracts.industry_category 는 '이름(통합허가)' 로 저장되므로 이름을 바꾸면 옛 이름을 aliases 에 남긴다.
--   exact_codes / prefix_codes : KSIC 5자리 정확 일치 / 접두 일치(사업장 분류·필터·통계).
--   keywords    : 계약 업종 텍스트·사업장 업종명 대조용(입찰 서류·회사소개서·계약 다운로드 필터).
--   aliases     : 옛 이름·다른 표기(이름 → id 대응).
--   note        : AI 업종 태깅 프롬프트 힌트(선택).
--   active      : 사용 중지(soft delete). 지우지 않는 이유 — 저장 데이터의 id·이름이 계속 이름표를 찾을 수 있어야 한다.
-- 선행: 012(permissions·permission_templates·tpl-system-admin), 065(intel_settings). GRANT 없음(265 default privileges). 멱등.

CREATE TABLE IF NOT EXISTS permit_industries (
  industry_id  text PRIMARY KEY,
  label        text NOT NULL,
  exact_codes  jsonb NOT NULL DEFAULT '[]'::jsonb,
  prefix_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  keywords     jsonb NOT NULL DEFAULT '[]'::jsonb,
  aliases      jsonb NOT NULL DEFAULT '[]'::jsonb,
  note         text,
  sort_order   integer NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);

CREATE UNIQUE INDEX IF NOT EXISTS permit_industries_label_uq ON permit_industries (label);

-- ── 1) 기존 20개 시드 — 코드 기본값(lib/ieps/integrated-permit-industries.ts DEFAULT_PERMIT_INDUSTRIES)과 같다 ──
--   이미 있는 행은 건드리지 않는다(관리 화면에서 고친 값 보존).
INSERT INTO permit_industries (industry_id, label, exact_codes, prefix_codes, keywords, aliases, sort_order)
VALUES
  ('power', '발전', '[]', '["3511"]', '["발전","화력","기타 발전"]', '[]', 10),
  ('steam-heat', '증기열공급', '["35300"]', '[]', '["증기","열공급","냉온수"]', '[]', 20),
  ('waste-incineration', '폐기물처리', '["38210","38220"]', '[]', '["폐기물처리","폐기물 처리","폐기물소각","소각","지정 폐기물"]', '["폐기물소각","폐기물처리업"]', 30),
  ('steel', '철강', '[]', '["241"]', '["철강","1차 철강"]', '[]', 40),
  ('nonferrous', '비철', '[]', '["242"]', '["비철","비철금속"]', '[]', 50),
  ('organic-chem', '유기화학', '[]', '["2011","203"]', '["유기","석유화학계","기초 유기"]', '["유기"]', 60),
  ('oil-refining', '석유정제', '[]', '["192"]', '["석유정제","석유 정제품"]', '[]', 70),
  ('inorganic-chem', '무기화학', '["20131","20132"]', '["2012"]', '["무기화학","무기 화학","무기안료","금속 산화물"]', '[]', 80),
  ('fine-chem', '기타화학', '[]', '["204"]', '["기타화학","정밀화학","합성염료","농업용 약제","도료","계면활성제","화장품","접착제","화약","세제"]', '["정밀화학"]', 90),
  ('fertilizer', '비료', '[]', '["202"]', '["비료","질소화합물"]', '["비료및질소화합물"]', 100),
  ('pulp-paper', '종이·펄프', '[]', '["171","179"]', '["펄프","종이","판지"]', '["펄프종이및판지"]', 110),
  ('electronics', '전자부품', '["26221","26929"]', '["2621","2692"]', '["전자부품","회로기판","평판"]', '[]', 120),
  ('semiconductor', '반도체', '[]', '["261"]', '["반도체"]', '[]', 130),
  ('textile-dyeing', '섬유·염색', '[]', '["134"]', '["섬유","염색","마무리 가공"]', '["섬유염색및가공처리업"]', 140),
  ('slaughter-meat', '육류가공', '[]', '["101"]', '["육류가공","도축","저장처리"]', '["도축육류가공및저장처리업"]', 150),
  ('alcohol', '알콜음료', '[]', '["111"]', '["알콜","알코올","주류","음료 제조"]', '["알콜음료제조업"]', 160),
  ('plastics', '플라스틱', '[]', '["222"]', '["플라스틱"]', '["플라스틱제품제조업"]', 170),
  ('auto-parts', '자동차부품', '[]', '["303"]', '["자동차부품","자동차 부품"]', '["자동차부품제조업"]', 180),
  ('cement', '시멘트', '["23311"]', '[]', '["시멘트"]', '["시멘트 제조업"]', 190),
  ('secondary-battery', '이차전지', '["28202","28209"]', '[]', '["이차전지","2차전지","축전지","배터리"]', '["이차전지 제조업"]', 200)
ON CONFLICT (industry_id) DO NOTHING;

-- ── 2) 수집 설정(intel_settings collect.industries.list)에서 사용자가 더한 업종 이관 ──
--   그동안 신규 편입 업종은 수집 설정 화면에서 추가했다(id = 이름, KSIC 없음). 같은 id·이름이 없을 때만 넣고,
--   KSIC 코드는 관리 화면에서 채운다. 기본 20개의 프롬프트 힌트(note)는 비어 있을 때만 옮긴다.
DO $$
BEGIN
  IF to_regclass('public.intel_settings') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO permit_industries (industry_id, label, note, sort_order)
  SELECT item->>'id', item->>'label', NULLIF(item->>'note', ''),
         1000 + ord::int
    FROM intel_settings s,
         jsonb_array_elements(
           CASE WHEN jsonb_typeof(s.setting_json->'industries'->'list') = 'array'
                THEN s.setting_json->'industries'->'list' ELSE '[]'::jsonb END
         ) WITH ORDINALITY AS t(item, ord)
   WHERE s.setting_key = 'collect'
     AND COALESCE(item->>'id', '') <> ''
     AND COALESCE(item->>'label', '') <> ''
     AND NOT EXISTS (SELECT 1 FROM permit_industries p WHERE p.industry_id = item->>'id' OR p.label = item->>'label')
  ON CONFLICT DO NOTHING;

  UPDATE permit_industries p
     SET note = src.note
    FROM (
      SELECT item->>'id' AS industry_id, NULLIF(item->>'note', '') AS note
        FROM intel_settings s,
             jsonb_array_elements(
               CASE WHEN jsonb_typeof(s.setting_json->'industries'->'list') = 'array'
                    THEN s.setting_json->'industries'->'list' ELSE '[]'::jsonb END
             ) AS t(item)
       WHERE s.setting_key = 'collect'
    ) src
   WHERE p.industry_id = src.industry_id
     AND p.note IS NULL
     AND src.note IS NOT NULL;
END $$;

-- ── 3) 관리 화면 권한(/admin/permit-industries) — 시스템 관리자에게만. 목록 읽기는 로그인 사용자 전원 ──
INSERT INTO permissions (permission_key, module, action, description, scopes_supported, is_dangerous, created_at)
VALUES
  ('master.permit_industry.manage', 'master', 'permit_industry_manage', '통합허가 대상 업종 추가·수정·사용 중지(/admin/permit-industries)', 'all', 0, now()::text)
ON CONFLICT (permission_key) DO UPDATE SET
  module = EXCLUDED.module, action = EXCLUDED.action, description = EXCLUDED.description,
  scopes_supported = EXCLUDED.scopes_supported, is_dangerous = EXCLUDED.is_dangerous;

INSERT INTO permission_template_grants (grant_id, template_id, permission_key, scope_kind, effect, created_at)
SELECT 'grant-sysadm-' || substr(md5('master.permit_industry.manage'), 1, 16),
       'tpl-system-admin', 'master.permit_industry.manage', 'all', 'allow',
       to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 WHERE EXISTS (SELECT 1 FROM permission_templates WHERE template_id = 'tpl-system-admin')
   AND NOT EXISTS (
     SELECT 1 FROM permission_template_grants g
      WHERE g.template_id = 'tpl-system-admin' AND g.permission_key = 'master.permit_industry.manage'
   );
