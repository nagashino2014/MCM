-- 374 포스코 광양제철소 자율환경관리 계약 정정(사용자 지시 2026-11-18).
-- '포스코 광양제철소 환통법 자율환경관리 이행을 위한 컨설팅'(ctr_ee489172bcc22287, 2023-07-12)의 계약상대가
-- ㈜포스코ESM(facl_be52cc37177bf6e8, 513-81-68029 — 포스코그룹 밖, 2019 포스코케미칼 합병)으로 들어가 있었다(스테이징 읽기 전용 조회 2026-11-18).
-- 계약상대 = ㈜포스코(facm_061df9ec94c434, 301-87-02315, 포스코그룹 대표·본사), 대상사업장 = ㈜포스코 광양제철소(84690-01),
-- 발주 주체 = 소속 법인·모회사(PARENT_CORP)로 맞춘다.
-- 계약 관리의 변경계약 입력과 같게 contracts(counterparty_facility_id·facility_id·ordering_subject_type·updated_at)와
-- contract_facilities 의 통합허가 대상사업장(integrated_permit_target) 연결을 바꾸고 audit_log 를 남긴다.
-- 멱등: 계약상대가 아직 ㈜포스코ESM 일 때만 바꾼다. ㈜포스코·광양제철소가 살아 있을 때만.
DO $$
DECLARE
  ts text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  -- 네 문장이 같은 조건(아직 고치지 않은 상태)으로 고른다. contracts 를 마지막에 바꿔 앞 문장들은 고치기 전 상태를 본다.
  INSERT INTO audit_log (actor_user_id, action, target_table, target_id, before_json, after_json, created_at)
  SELECT NULL, 'contract_counterparty_relink', 'contracts', c.contract_id,
         jsonb_build_object('counterparty_facility_id', c.counterparty_facility_id, 'facility_id', c.facility_id,
                            'ordering_subject_type', c.ordering_subject_type),
         jsonb_build_object('counterparty_facility_id', 'facm_061df9ec94c434', 'facility_id', '84690-01',
                            'ordering_subject_type', 'PARENT_CORP', 'reason', '374 포스코 광양제철소 계약 정정'),
         ts
    FROM contracts c
   WHERE c.contract_id = 'ctr_ee489172bcc22287' AND c.deleted_at IS NULL
     AND c.counterparty_facility_id = 'facl_be52cc37177bf6e8'
     AND EXISTS (SELECT 1 FROM facilities f WHERE f.facility_id = 'facm_061df9ec94c434' AND f.deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM facilities f WHERE f.facility_id = '84690-01' AND f.deleted_at IS NULL);

  DELETE FROM contract_facilities cf
   USING contracts c
   WHERE cf.contract_id = c.contract_id AND cf.relation_type = 'integrated_permit_target'
     AND c.contract_id = 'ctr_ee489172bcc22287' AND c.deleted_at IS NULL
     AND c.counterparty_facility_id = 'facl_be52cc37177bf6e8'
     AND EXISTS (SELECT 1 FROM facilities f WHERE f.facility_id = 'facm_061df9ec94c434' AND f.deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM facilities f WHERE f.facility_id = '84690-01' AND f.deleted_at IS NULL);

  INSERT INTO contract_facilities (contract_id, facility_id, relation_type, created_at, updated_at)
  SELECT c.contract_id, '84690-01', 'integrated_permit_target', ts, ts
    FROM contracts c
   WHERE c.contract_id = 'ctr_ee489172bcc22287' AND c.deleted_at IS NULL
     AND c.counterparty_facility_id = 'facl_be52cc37177bf6e8'
     AND EXISTS (SELECT 1 FROM facilities f WHERE f.facility_id = 'facm_061df9ec94c434' AND f.deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM facilities f WHERE f.facility_id = '84690-01' AND f.deleted_at IS NULL)
  ON CONFLICT (contract_id, facility_id, relation_type) DO NOTHING;

  UPDATE contracts c
     SET counterparty_facility_id = 'facm_061df9ec94c434', facility_id = '84690-01', ordering_subject_type = 'PARENT_CORP', updated_at = ts
   WHERE c.contract_id = 'ctr_ee489172bcc22287' AND c.deleted_at IS NULL
     AND c.counterparty_facility_id = 'facl_be52cc37177bf6e8'
     AND EXISTS (SELECT 1 FROM facilities f WHERE f.facility_id = 'facm_061df9ec94c434' AND f.deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM facilities f WHERE f.facility_id = '84690-01' AND f.deleted_at IS NULL);
END
$$;
