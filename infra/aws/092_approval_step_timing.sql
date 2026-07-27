-- 092: 전자결재 단계 체류시간(AX-P1) — activated_at(pending 전환 시각) 추가.
-- 단계 체류시간 = acted_at − activated_at, 병목 대시보드·리마인드 판정에 사용.
-- 설계: docs/e-approval-differentiation-blueprint.md §9-2.

ALTER TABLE approval_steps ADD COLUMN IF NOT EXISTS activated_at text;

-- 백필: 이미 활성/처리된 단계는 문서 상신일을 근사 활성화 시각으로.
UPDATE approval_steps s
   SET activated_at = d.submitted_at
  FROM approval_docs d
 WHERE s.doc_id = d.doc_id
   AND s.activated_at IS NULL
   AND s.status IN ('pending', 'approved', 'rejected')
   AND d.submitted_at IS NOT NULL;
