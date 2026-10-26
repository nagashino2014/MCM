-- 313: 회사소개서 일러스트 라이브러리 — 보유 스톡(Adobe Stock 등) 인포그래픽 일러스트를 모듈로 올려 스튜디오에서 넣고 글을 고친다.
--   (docs/company-catalog-blueprint.md §4-5, 2026-10-26)
-- 선행: 309(catalog_assets). 멱등.
--   파일(정리한 SVG·미리보기 PNG)은 catalog_assets(kind = 'illustration')와 계약 문서 저장소 catalog/illustrations/{asset_id}/ 에 둔다.
--   이 표는 그 자산의 일러스트 정보 — 판정 유형·항목 수·품질·글자 자리(slots)·색 팔레트(palette)·라이선스·소개서 자리 적합도.
--   관리 화면에서 언제든 더하고(일괄·한 건) 지운다. 쪽·버전·발행본이 쓰는 일러스트는 지우지 않고 status = 'archived'(라이브러리에서만 숨김).

-- catalog_assets.kind 에 'illustration' 추가(309 의 이름 없는 CHECK 는 catalog_assets_kind_check)
ALTER TABLE catalog_assets DROP CONSTRAINT IF EXISTS catalog_assets_kind_check;
ALTER TABLE catalog_assets ADD CONSTRAINT catalog_assets_kind_check
  CHECK (kind IN ('photo', 'logo', 'certificate', 'map', 'illustration'));

CREATE TABLE IF NOT EXISTS catalog_illustrations (
  asset_id      text  PRIMARY KEY REFERENCES catalog_assets(asset_id),
  source_key    text  NOT NULL,               -- 매처 영역 id(as-123/ab01/r2) 또는 'upload:' + 파일 이름 — 같은 키를 다시 올리면 새 판으로 교체
  title         text  NOT NULL,
  info_type     text  NOT NULL,               -- 인포그래픽 16유형 키(process·cycle·hub …) — 기본 인포그래픽과의 관계
  alt_types     jsonb NOT NULL DEFAULT '[]'::jsonb,
  item_count    int   NOT NULL,               -- 그림에 고정된 항목 수(이 수가 맞는 인포그래픽 자리만 후보)
  has_center    int   NOT NULL DEFAULT 0,
  has_loop      int   NOT NULL DEFAULT 0,
  quality       int,                          -- 1~5 시각 판정
  note          text,
  view_w        double precision NOT NULL,
  view_h        double precision NOT NULL,
  slots         jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{id, role, item, x, y, w, h, lines, fs, lh, align}] (그림 대비 비율)
  palette       jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{v, hex, use, l, group?, shade?, neutral?}] — SVG 의 var(--il-{v})
  license       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {provider, stockId, license, url, file, purchasedAt, note}
  fits          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{item, page, title, score, fit}] 매처의 소개서 자리 적합도
  thumb_key     text,                          -- 미리보기 PNG 저장 키
  svg_bytes     int,
  status        text  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by    text,
  created_at    text  NOT NULL,
  updated_by    text,
  updated_at    text  NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_catalog_illustrations_active ON catalog_illustrations(status, info_type, item_count);
CREATE INDEX IF NOT EXISTS idx_catalog_illustrations_source ON catalog_illustrations(source_key);
