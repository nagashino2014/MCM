-- 181_rental_deposit_dates.sql
-- 간주임대료 보증금(180 시드)의 임대 기간을 실제 계약일로 정정 (2026-08-17 사용자 확인 + 임대차계약서 실사)
-- staging 에는 2026-08-17 선반영됨 — 멱등(같은 값 재설정 + INSERT ON CONFLICT DO NOTHING).

UPDATE rental_deposits SET date_from = '2021-11-20' WHERE deposit_id = 'rd-seed-altr01' AND date_from <> '2021-11-20';
UPDATE rental_deposits SET date_from = '2022-01-15' WHERE deposit_id = 'rd-seed-3dt001' AND date_from <> '2022-01-15';
UPDATE rental_deposits SET date_from = '2023-04-25' WHERE deposit_id = 'rd-seed-dald01' AND date_from <> '2023-04-25';
-- 1209호 이유억: 2020-05-21 임대 개시, 임차인 행정사 폐업(2026-08-13)으로 2026-08-31 임대 종료 예정
--   (간주임대료는 보증금 보유 기간 기준 — 보증금 반환일 확정 시 화면에서 date_to 조정)
UPDATE rental_deposits SET date_from = '2020-05-21', date_to = '2026-08-31'
 WHERE deposit_id = 'rd-seed-leeu01' AND (date_from <> '2020-05-21' OR date_to IS DISTINCT FROM '2026-08-31');
UPDATE rental_deposits SET property_label = '의왕스마트시티퀀텀 A921호', date_from = '2025-09-26'
 WHERE deposit_id = 'rd-seed-seoy01' AND (date_from <> '2025-09-26' OR property_label <> '의왕스마트시티퀀텀 A921호');

-- 1202호 에코씨앤엠: 보증금 없음(간주임대료 0) — 부동산임대공급가액명세서 완전성 위해 등록
INSERT INTO rental_deposits (deposit_id, property_label, tenant_name, tenant_corp_num, deposit_amount, date_from, memo)
VALUES ('rd-seed-ecocm1', '에이스골드타워 1202호', '주식회사 에코씨앤엠', '1678602886', 0, '2022-07-01', '보증금 없음 — 명세서 표시용')
ON CONFLICT (deposit_id) DO NOTHING;
