-- 372 지워진 계약상대 사업장을 가리키는 살아 있는 계약을 살아 있는 사업장으로 다시 잇는다(사용자 지시 2026-11-18).
-- 원인: 사업장 삭제(app/api/facilities/[id]) 가 계약 참조를 검사하지 않아, 같은 이름의 중복 사업장을 지우면서
--       그 사업장을 계약상대로 쓰던 계약 20건이 지워진 사업장을 가리키게 됐다(2026-06-09·10, 11-12 삭제).
--       증상: 변경계약 입력의 '대상사업장 본인' 자동 매칭 실패(씨제이제일제당 진천공장), 계약상대 사업자번호가 지워진 레코드 값.
-- 매핑(스테이징 읽기 전용 조회 2026-11-18 확인, 지운 레코드 → 사업장 마스터에 살아 있는 레코드):
--   facl_7e9fb0e3834f5ca1 엘에스전선㈜(번호 없음, 9건)          → facl_317857c3da8742dc 엘에스전선㈜ 138-81-47634
--   facl_fd60c07a661c9cd7 엘에스전선㈜(번호 없음, 6건)          → facl_317857c3da8742dc
--   facl_c734c6007d0f2281 씨제이제일제당㈜ 진천공장 301-85-32590(4건) → 69226-01 씨제이제일제당㈜ 진천공장 142-85-26432
--   facl_b3584a89c1c053f0 홍원제지㈜ 202-81-10990(1건)          → 20511-00 홍원제지(주) 125-85-04073
--   ⚠ CJ·홍원제지는 지운 레코드와 마스터의 사업자번호가 다르다 — 이후 계산서 등은 마스터 번호를 쓴다. 번호가 틀리면 사업장 화면에서 고친다.
-- 계약 관리의 '계약상대 변경'과 같게 counterparty_facility_id·updated_at 만 바꾸고, 계약마다 audit_log 를 남긴다.
-- 지운 레코드의 다른 연결(사업자등록증·intel·보강 후보·품질 항목)은 건드리지 않는다.
-- 멱등: 지운 레코드를 가리키는 계약이 없으면 아무것도 하지 않는다. 대상이 지워져 있으면 그 줄은 건너뛴다.
DO $$
DECLARE
  ts text := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
BEGIN
  INSERT INTO audit_log (actor_user_id, action, target_table, target_id, before_json, after_json, created_at)
  SELECT NULL, 'contract_counterparty_relink', 'contracts', c.contract_id,
         jsonb_build_object('counterparty_facility_id', m.old_id),
         jsonb_build_object('counterparty_facility_id', m.new_id, 'reason', '372 지워진 계약상대 사업장 재연결'),
         ts
  FROM contracts c
  JOIN (VALUES
    ('facl_7e9fb0e3834f5ca1', 'facl_317857c3da8742dc'),
    ('facl_fd60c07a661c9cd7', 'facl_317857c3da8742dc'),
    ('facl_c734c6007d0f2281', '69226-01'),
    ('facl_b3584a89c1c053f0', '20511-00')
  ) AS m(old_id, new_id) ON m.old_id = c.counterparty_facility_id
  JOIN facilities newf ON newf.facility_id = m.new_id AND newf.deleted_at IS NULL
  JOIN facilities oldf ON oldf.facility_id = m.old_id AND oldf.deleted_at IS NOT NULL;

  UPDATE contracts c
     SET counterparty_facility_id = m.new_id, updated_at = ts
    FROM (VALUES
      ('facl_7e9fb0e3834f5ca1', 'facl_317857c3da8742dc'),
      ('facl_fd60c07a661c9cd7', 'facl_317857c3da8742dc'),
      ('facl_c734c6007d0f2281', '69226-01'),
      ('facl_b3584a89c1c053f0', '20511-00')
    ) AS m(old_id, new_id), facilities newf, facilities oldf
   WHERE m.old_id = c.counterparty_facility_id
     AND newf.facility_id = m.new_id AND newf.deleted_at IS NULL
     AND oldf.facility_id = m.old_id AND oldf.deleted_at IS NOT NULL;
END
$$;
