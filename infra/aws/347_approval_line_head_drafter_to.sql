-- 347: 고정 결재선 — 부서장이 기안하면 대표이사까지 올리는 템플릿 옵션.
--
-- 배경(2026-11-09 사용자 확정, 안 B):
--   휴가처럼 부서장 단계만 있는 양식은 부서장이 기안하면 본인 단계가 빠지고 다음 칸(임원)만 남아
--   총괄본부장 단독 결재로 끝났다. 사용자는 부서장 기안은 대표이사까지 올라가야 한다고 결정했다.
--   일반 직원·연구소 직원(임원 취급 부서장) 결재선은 그대로 둔다.
--   → 템플릿에 head_drafter_to(부서장 기안 시 사다리를 이 역할까지 채움)를 두고 아래 6종에 'ceo' 를 넣는다.
--     부서장 기안: 정득종(임원) → 이유억(대표이사). 일반 직원: 종전 그대로.
-- 열을 처음 만들 때만 6종 값을 넣는다 — 운영자가 관리 화면에서 끈 값은 재실행해도 보존한다. 멱등.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'approval_line_templates' AND column_name = 'head_drafter_to'
  ) THEN
    ALTER TABLE approval_line_templates
      ADD COLUMN head_drafter_to text CHECK (head_drafter_to IS NULL OR head_drafter_to IN ('exec', 'ceo'));
    UPDATE approval_line_templates
       SET head_drafter_to = 'ceo', updated_by = 'migration-347', updated_at = now()::text
     WHERE form_id IN (
       'frm-biz-trip-request',   -- 국내 출장 신청
       'frm-overtime-request',   -- 초과/휴일근무 신청
       'frm-biz-trip-report',    -- 출장보고서
       'frm-leave-request',      -- 휴가신청서
       'frm-education-request',  -- 교육훈련 신청
       'frm-education-report'    -- 교육훈련 보고
     );
  END IF;
END $$;
