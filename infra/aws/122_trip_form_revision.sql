-- 122: 출장신청서(frm-biz-trip-request) 개정 — 일정(캘린더) 메뉴 지원.
--   1) contract_class: 라벨 '계약 구분'→'용역분류', 옵션을 [통합허가,화관법,HAPs,ESG탄소중립,기타]로
--      (일정 스케줄명 규칙 "[출장지]:[용역분류]"의 원천. 기존 문서의 옛 옵션 값은 조회 시
--       lib/approval/trip.ts::normalizeContractClass 로 매핑 — 데이터는 손대지 않는다)
--   2) car_name: select 하드코딩(카니발/스타렉스 예시 더미) → asset_select(assetKind=vehicle)
--      선택지는 자산 마스터(reservable_assets, 121)의 활성 차량에서 동적 로드된다.
-- 멱등 가드: 원안 시드 상태(label='계약 구분')일 때만 교체 — 관리자가 빌더로 이미 손댄
-- 양식은 덮지 않는다(그 경우 빌더에서 직접 반영). 재적용 시 UPDATE 0행 + 스냅샷 conflict no-op.

UPDATE approval_forms
   SET fields = '[
     {"key":"trip_period","label":"출장기간","type":"period","required":true,"row":1,"span":1},
     {"key":"trip_class","label":"출장분류","type":"select","options":["일반(당일 복귀)","숙박 출장","교육/세미나","기타"],"row":1,"span":1},
     {"key":"destination","label":"출장지","type":"text","required":true,"row":1,"span":1},
     {"key":"transport","label":"교통편(복수 이용 시 모두 선택)","type":"checkbox","options":["법인차량","KTX","고속버스","대중교통(버스, 지하철)","택시","렌터카","항공기","자차"],"row":2,"span":3},
     {"key":"car_name","label":"이용차량(법인 차량 이용 시)","type":"asset_select","assetKind":"vehicle","row":3,"span":1},
     {"key":"car_time","label":"이용시간","type":"radio","options":["종일","오전","오후"],"row":3,"span":1},
     {"key":"depart_time","label":"출장 출발 시각","type":"time","row":3,"span":1},
     {"key":"contract_class","label":"용역분류","type":"checkbox","options":["통합허가","화관법","HAPs","ESG탄소중립","기타"],"row":4,"span":2},
     {"key":"contract_name","label":"계약명","type":"text","row":4,"span":1},
     {"key":"companions","label":"동행자","type":"text","row":5,"span":3},
     {"key":"purpose","label":"출장목적(상세 기술)","type":"multitext","required":true,"row":6,"span":3},
     {"key":"notice","label":"안내","type":"static","content":"※ 출장 경비 지급 기준은 한국환경안전연구원 사규 [별표 1. 지출증빙 및 지급 기준] 을 준용한다.","row":7,"span":3}
   ]'::jsonb,
       version = version + 1,
       updated_at = now()::text
 WHERE form_id = 'frm-biz-trip-request'
   AND fields @> '[{"key":"contract_class","label":"계약 구분"}]'::jsonb;

-- 개정본 버전 스냅샷 — 개정 전 상신 문서는 제출 당시 버전(form_versions)으로 렌더된다.
INSERT INTO approval_form_versions (form_id, version, fields, saved_by, saved_at)
SELECT form_id, version, fields, NULL, now()::text
  FROM approval_forms
 WHERE form_id = 'frm-biz-trip-request'
   AND fields @> '[{"key":"contract_class","label":"용역분류"}]'::jsonb
ON CONFLICT (form_id, version) DO NOTHING;
