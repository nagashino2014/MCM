-- 081: 입찰 패키지 수행인력 설정 — 참여직위/담당파트/수행실적 필터(jsonb)
-- staff_config = { roles: {employeeId: {role, part}}, parts: [..],
--                  perfFilter: { subtypes: [..], industries: [..], years: [..],
--                                amountMinMan, amountMaxMan, applyAllSubtypes, applyAllIndustries } }
-- (docs/bid-package-blueprint.md 수행인력 확정 개편. 멱등)
ALTER TABLE bid_packages ADD COLUMN IF NOT EXISTS staff_config jsonb;
