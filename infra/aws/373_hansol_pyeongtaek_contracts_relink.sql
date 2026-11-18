-- 373 한솔제지 평택에코센터 계약 정정(사용자 지시 2026-11-18 "한번에 고쳐줘").
-- 엑셀 이관 오기재로 '한솔제지 평택에코센터' 계약 3건의 계약상대(1건은 대상사업장까지)가 ㈜디엔오토모티브 울산1공장
-- (facl_defbf856eae02d94)으로 들어가 있었다(스테이징 읽기 전용 조회 2026-11-18).
-- 한솔제지㈜(facm_aec9d2e21425ca, 104-86-58322)가 평택에코센터(35028-00)의 위탁운영사(운영 주체 operating_entity)이므로
-- 네 건 모두 계약상대 = 한솔제지㈜, 발주 주체 = 위탁운영사(CONSIGNED_OPERATOR), 대상사업장 = 평택에코센터로 맞춘다.
--   ctr_5d5e799cc6a857fb 변경신고(2023년 2차)  계약상대 디엔오토모티브 → 한솔제지, 대상사업장 없음 → 평택에코센터
--   ctr_949e6972909bdfb9 변경신고(2024년)      계약상대·대상사업장 디엔오토모티브 → 한솔제지·평택에코센터
--   ctr_b322b58eb2a4e686 재검토(2025년)        계약상대 디엔오토모티브 → 한솔제지, 대상사업장 없음 → 평택에코센터
--   ctr_4122b6a49dcf28a7 변경신고(2023년)      계약상대 한솔제지 그대로, 대상사업장 한솔제지(본인) → 평택에코센터
-- 계약 관리의 변경계약 입력과 같게 contracts(counterparty_facility_id·facility_id·ordering_subject_type·updated_at)와
-- contract_facilities 의 통합허가 대상사업장(integrated_permit_target) 연결을 바꾸고, 계약마다 audit_log 를 남긴다.
-- 멱등: 아직 고치지 않은 상태(계약상대가 디엔오토모티브, 또는 4122 의 대상사업장이 한솔제지 본인)인 계약만 바꾼다.
DO $$
DECLARE
  ts text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  -- 바꿀 계약은 아래 네 문장이 같은 조건(아직 고치지 않은 상태)으로 고른다. contracts 를 마지막에 바꿔 앞 문장들은 고치기 전 상태를 본다.
  INSERT INTO audit_log (actor_user_id, action, target_table, target_id, before_json, after_json, created_at)
  SELECT NULL, 'contract_counterparty_relink', 'contracts', c.contract_id,
         jsonb_build_object('counterparty_facility_id', c.counterparty_facility_id, 'facility_id', c.facility_id,
                            'ordering_subject_type', c.ordering_subject_type),
         jsonb_build_object('counterparty_facility_id', 'facm_aec9d2e21425ca', 'facility_id', '35028-00',
                            'ordering_subject_type', 'CONSIGNED_OPERATOR', 'reason', '373 한솔제지 평택에코센터 계약 정정'),
         ts
    FROM contracts c
   WHERE c.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM facilities f WHERE f.facility_id = 'facm_aec9d2e21425ca' AND f.deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM facilities f WHERE f.facility_id = '35028-00' AND f.deleted_at IS NULL)
     AND ((c.contract_id IN ('ctr_5d5e799cc6a857fb', 'ctr_949e6972909bdfb9', 'ctr_b322b58eb2a4e686') AND c.counterparty_facility_id = 'facl_defbf856eae02d94')
       OR (c.contract_id = 'ctr_4122b6a49dcf28a7' AND c.counterparty_facility_id = 'facm_aec9d2e21425ca' AND c.facility_id = 'facm_aec9d2e21425ca'));

  DELETE FROM contract_facilities cf
   USING contracts c
   WHERE cf.contract_id = c.contract_id AND cf.relation_type = 'integrated_permit_target'
     AND c.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM facilities f WHERE f.facility_id = 'facm_aec9d2e21425ca' AND f.deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM facilities f WHERE f.facility_id = '35028-00' AND f.deleted_at IS NULL)
     AND ((c.contract_id IN ('ctr_5d5e799cc6a857fb', 'ctr_949e6972909bdfb9', 'ctr_b322b58eb2a4e686') AND c.counterparty_facility_id = 'facl_defbf856eae02d94')
       OR (c.contract_id = 'ctr_4122b6a49dcf28a7' AND c.counterparty_facility_id = 'facm_aec9d2e21425ca' AND c.facility_id = 'facm_aec9d2e21425ca'));

  INSERT INTO contract_facilities (contract_id, facility_id, relation_type, created_at, updated_at)
  SELECT c.contract_id, '35028-00', 'integrated_permit_target', ts, ts
    FROM contracts c
   WHERE c.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM facilities f WHERE f.facility_id = 'facm_aec9d2e21425ca' AND f.deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM facilities f WHERE f.facility_id = '35028-00' AND f.deleted_at IS NULL)
     AND ((c.contract_id IN ('ctr_5d5e799cc6a857fb', 'ctr_949e6972909bdfb9', 'ctr_b322b58eb2a4e686') AND c.counterparty_facility_id = 'facl_defbf856eae02d94')
       OR (c.contract_id = 'ctr_4122b6a49dcf28a7' AND c.counterparty_facility_id = 'facm_aec9d2e21425ca' AND c.facility_id = 'facm_aec9d2e21425ca'))
  ON CONFLICT (contract_id, facility_id, relation_type) DO NOTHING;

  UPDATE contracts c
     SET counterparty_facility_id = 'facm_aec9d2e21425ca', facility_id = '35028-00', ordering_subject_type = 'CONSIGNED_OPERATOR', updated_at = ts
   WHERE c.deleted_at IS NULL
     AND EXISTS (SELECT 1 FROM facilities f WHERE f.facility_id = 'facm_aec9d2e21425ca' AND f.deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM facilities f WHERE f.facility_id = '35028-00' AND f.deleted_at IS NULL)
     AND ((c.contract_id IN ('ctr_5d5e799cc6a857fb', 'ctr_949e6972909bdfb9', 'ctr_b322b58eb2a4e686') AND c.counterparty_facility_id = 'facl_defbf856eae02d94')
       OR (c.contract_id = 'ctr_4122b6a49dcf28a7' AND c.counterparty_facility_id = 'facm_aec9d2e21425ca' AND c.facility_id = 'facm_aec9d2e21425ca'));
END
$$;
