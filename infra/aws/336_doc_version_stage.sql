-- 336: 계약서·견적서 초안/최종안 버전 관리 — 2026-11-03 사용자 요청
-- 초안은 결재 없이 발주처(사업장)에 보내 검토받고, 최종안만 고정 결재선(부서장→임원→대표이사)을 거친다.
-- 버전마다 결재 문서(approval_docs) 1건이며 단계 표지는 field_values.doc_stage('draft'|'final', 없으면 초안),
-- 초안 송부 잠금은 field_values.draft_sent_at 이 원본이다. 대장은 이를 미러하고 송부 이력을 누적한다
-- (공문 194 send_history 관례: [{sentAt, messageId, stage, version, to(메일 주소 배열), cc, attachments, mode}]).
-- 기존 계약서·견적서는 모두 초안으로 본다(사용자 확정) — 단계 기본값 'draft', 백필은 송부 이력만.
-- 관례: text 타임스탬프, 멱등(IF NOT EXISTS / 빈 배열만 백필).

-- 1) 계약서 대장 — 버전 묶음(견적 269 와 같은 구조) + 단계 + 송부 이력
ALTER TABLE contract_agreements ADD COLUMN IF NOT EXISTS root_doc_id text;          -- 원본(v1) approval_docs.doc_id
ALTER TABLE contract_agreements ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE contract_agreements ADD COLUMN IF NOT EXISTS doc_stage text NOT NULL DEFAULT 'draft'; -- draft | final
ALTER TABLE contract_agreements ADD COLUMN IF NOT EXISTS send_history jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE contract_agreements SET root_doc_id = doc_id WHERE root_doc_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_contract_agreements_root ON contract_agreements(root_doc_id, version);

-- 기존 발송분(sent_to 최근 1회)을 1차 송부로 등재
UPDATE contract_agreements
   SET send_history = jsonb_build_array(
         jsonb_strip_nulls(jsonb_build_object(
           'sentAt', sent_at,
           'messageId', sent_message_id,
           'stage', 'draft',
           'version', 1,
           'to', (SELECT jsonb_agg(r->>'email')
                    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(sent_to->'recipients') = 'array'
                                                   THEN sent_to->'recipients' ELSE '[]'::jsonb END) r
                   WHERE COALESCE(r->>'email', '') LIKE '%@%')
         ))
       )
 WHERE send_status = 'sent'
   AND sent_at IS NOT NULL
   AND send_history = '[]'::jsonb;

-- 2) 견적 대장 — 단계 + 송부 이력(버전 묶음은 269 에 이미 있다)
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS doc_stage text NOT NULL DEFAULT 'draft'; -- draft | final
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS send_history jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE quotations
   SET send_history = jsonb_build_array(
         jsonb_strip_nulls(jsonb_build_object(
           'sentAt', sent_at,
           'messageId', sent_message_id,
           'stage', 'draft',
           'version', version,
           'to', (SELECT jsonb_agg(DISTINCT r->>'email')
                    FROM jsonb_array_elements(
                           (CASE WHEN jsonb_typeof(cc_refs) = 'array' THEN cc_refs ELSE '[]'::jsonb END) ||
                           (CASE WHEN jsonb_typeof(recipients) = 'array' THEN recipients ELSE '[]'::jsonb END)) r
                   WHERE COALESCE(r->>'email', '') LIKE '%@%')
         ))
       )
 WHERE send_status = 'sent'
   AND sent_at IS NOT NULL
   AND send_history = '[]'::jsonb;

-- 3) 계약서 결재 양식 이름 — 결재는 이제 최종안만 올라온다(초안 검토는 결재 없이 송부)
UPDATE approval_forms
   SET name = '계약서(최종안)',
       description = '용역 계약서 최종안 결재 — 전용 작성 화면(/contracts/agreements) 사용. 초안은 결재 없이 발주처에 송부하고, 최종안만 결재 후 발송한다.',
       updated_at = now()::text
 WHERE form_id = 'frm-agreement'
   AND name = '계약서(초안 검토)';
