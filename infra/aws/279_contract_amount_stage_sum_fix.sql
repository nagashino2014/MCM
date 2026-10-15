-- 279: 계약금액(current_amount) = 청구·수금 단계 합 정정(2026-10-15 수주 집계 점검, 사용자 확인).
--   [단계 추가]·[수정]·[삭제]가 단계만 바꾸고 계약금액을 두어, 상세 화면(단계 합)과 대시보드 수주(current_amount)가
--   어긋났다. 코드는 같은 커밋에서 단계 변경 시 계약금액을 단계 합으로 맞추도록 고쳤고, 여기서는 이미 어긋난 4건만 바로잡는다.
--     영풍 석포제련소 동해사무소(2023-03)           10,000,000 → 19,000,000
--     한국소방산업기술원 ESG(2026-06)               20,000,000 → 18,181,818 (부가세 포함액으로 들어가 있던 건)
--     에이치디현대인프라코어 인천공장(2024-11)       10,100,000 → 12,700,000
--     씨제이제일제당 진천공장(2025-08)               19,000,000 → 26,000,000
--   점검한 4건만 대상으로 한다(그 사이 새로 어긋난 계약은 건드리지 않는다). 이미 맞으면 바꾸지 않는다 — 멱등.

UPDATE contracts c
   SET current_amount = s.total,
       updated_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  FROM (SELECT contract_id, SUM(amount) AS total
          FROM contract_payment_milestones
         GROUP BY contract_id) s
 WHERE c.contract_id = s.contract_id
   AND c.contract_id IN ('ctr_7ee03b121442a5a1', 'ctr_d92dc53f98c24645', 'ctr_fb85e8026873f11a', 'ctr_9555ea185a71d119')
   AND c.deleted_at IS NULL
   AND s.total > 0
   AND ABS(COALESCE(c.current_amount, c.contract_amount, 0) - s.total) > 1;
