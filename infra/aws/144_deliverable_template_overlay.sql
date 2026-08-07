-- 144: 발주처 자체양식(D4) — 원본 보존형 렌더 지원.
-- 142 를 만들 때는 자체양식도 DeliverableSpec 으로 "재구축"할 계획이었으나, HWPX 좌표 렌더러
-- (lib/deliverable/hwpx-pdf.ts)를 갖추면서 전제가 바뀌었다. HWPX 로 받은 양식은 재구축하면
-- 서식이 깨지므로 **원본을 그대로 두고 값만 주입**하는 편이 낫다(제출처가 서식 차이에 엄격).
-- 스캔 PDF 처럼 원본 구조가 없는 입력만 spec 재구축 경로를 탄다.
--   overlay = 원본 HWPX + profile(문단·셀 좌표 매핑)로 값 주입
--   spec    = DeliverableSpec[] 재구축(기존 spec 컬럼)
-- 관례: 멱등(IF NOT EXISTS), text 타임스탬프.

ALTER TABLE deliverable_templates
  ADD COLUMN IF NOT EXISTS render_mode text NOT NULL DEFAULT 'spec';

-- TemplateProfile — { analyzedAt, model, docs:[{docType,title,paraFrom,paraTo,slots:[...]}] }
-- slots 는 원본의 어느 자리에 어떤 바인딩이 들어가는지의 매핑이다(lib/deliverable/types.ts).
ALTER TABLE deliverable_templates
  ADD COLUMN IF NOT EXISTS profile jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 원본 파일은 재분석·주입에 매번 쓰이므로 overlay 템플릿에는 source_key 가 반드시 있어야 한다.
CREATE INDEX IF NOT EXISTS idx_deliverable_templates_mode
  ON deliverable_templates(render_mode, kind);
