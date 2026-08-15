-- 165: 근로계약 임금구성 키 표기 정규화 (2026-08-15)
-- 스캔 계약서 추출(PL-P2) 결과에 '기본금'·'자격수당' 등 이형 표기가 섞여
-- 통상임금 합산(payroll_item_defs.name 기준)에서 누락돼 통상시급이 0이 되는 문제를 고친다.
--   실측: 191건 중 13건이 '기본금' → 해당 직원(한도경·이태하·정다정·이원종 등)의 초과근무수당 산정 불가.
-- 항목 사전의 정규 명칭으로 통일한다: 기본금→기본급, 자격수당→자격증수당(사전 alias 와 동일 기준).
UPDATE labor_contracts
   SET wage_components = (wage_components - '기본금')
                         || jsonb_build_object('기본급',
                              COALESCE((wage_components->>'기본급')::numeric, 0)
                              + (wage_components->>'기본금')::numeric),
       updated_at = now()::text
 WHERE status <> 'void' AND wage_components ? '기본금';

UPDATE labor_contracts
   SET wage_components = (wage_components - '자격수당')
                         || jsonb_build_object('자격증수당',
                              COALESCE((wage_components->>'자격증수당')::numeric, 0)
                              + (wage_components->>'자격수당')::numeric),
       updated_at = now()::text
 WHERE status <> 'void' AND wage_components ? '자격수당';

-- '209시간분' 은 근로시간 표기가 임금 항목으로 잘못 들어간 것 — 통상임금 합산 왜곡을 막기 위해 제거.
UPDATE labor_contracts
   SET wage_components = wage_components - '209시간분',
       updated_at = now()::text
 WHERE status <> 'void' AND wage_components ? '209시간분';
