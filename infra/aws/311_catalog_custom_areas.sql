-- 311: 회사소개서 새 사업 분야(P6 LLM 편집) — 계약 관리 5분류 + 응용소프트웨어 밖에서 소개서에만 더하는 분야의 쪽 구성.
--   (docs/company-catalog-blueprint.md §7-2 6, 2026-10-24 P6)
-- 선행: 309(catalog_business_areas). 멱등. 기존 6개 분야 행(permit·chem·haps·esg·other·software)은 바꾸지 않는다(content NULL = 코드 기본 문안).
--   새 분야 행: area_id = 'x' + 6자, name = 소개서 표기명, color_slot = 'area-n'(빈 슬롯, 없으면 첫 관련 분류의 색),
--   content = { icon, lead, services[], processTitle, process[{label, desc}], kpis[지표 id], featured[계약 id], heroCaption, casesAside,
--               relatedCategories[계약 관리 분류], source ai|rule|mixed, draft } — 숫자는 지표 id·계약 id 로만(lib/catalog/custom-area-types.ts).
--   삭제 대신 is_active = 0(스튜디오 편집층·발행본 재현을 위해 행을 남긴다).

ALTER TABLE catalog_business_areas ADD COLUMN IF NOT EXISTS content    jsonb;
ALTER TABLE catalog_business_areas ADD COLUMN IF NOT EXISTS created_by text;
ALTER TABLE catalog_business_areas ADD COLUMN IF NOT EXISTS updated_by text;
