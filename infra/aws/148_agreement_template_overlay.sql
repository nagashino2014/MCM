-- 148: 계약서 발주처 자체양식 — 원본 보존형(overlay) 렌더 지원.
-- 147 에서는 자체양식을 AgreementSpec 으로 "재구축"(spec)하는 경로만 뒀으나, 발주처가 자기
-- 서식을 그대로 요구하는 경우 재구축은 표 선·자간·여백이 달라져 받아들여지지 않는다.
-- 착수계(144 deliverable_templates)와 같은 이원화를 계약서에도 적용한다:
--   overlay = 업로드 HWPX 원본 + profile(문단·셀 좌표 매핑)로 값만 주입 → 서식 100% 보존
--   spec    = AgreementSpec 재구축(조문 편집 자유, 갑지는 표준 골격으로 정규화)
-- 표준 셋(kind='standard')은 코드 시드의 standard-a 경로를 쓰므로 이 컬럼과 무관하다.
-- 관례: 멱등(IF NOT EXISTS).

ALTER TABLE agreement_templates
  ADD COLUMN IF NOT EXISTS render_mode text NOT NULL DEFAULT 'spec';

-- TemplateProfile — { analyzedAt, model, docs:[{docType,title,slots:[{target,para|table/row/col,binding,label,...}]}] }
-- 착수계와 같은 구조를 쓴다(lib/deliverable/types.ts) — 주입기(template-fill.ts)를 공유하기 위함.
ALTER TABLE agreement_templates
  ADD COLUMN IF NOT EXISTS profile jsonb NOT NULL DEFAULT '{}'::jsonb;

-- overlay 템플릿은 원본 파일이 반드시 있어야 한다(주입·재분석에 매번 사용) — source_key 는 147 에 이미 있음.
CREATE INDEX IF NOT EXISTS idx_agreement_templates_mode
  ON agreement_templates(render_mode, kind);
