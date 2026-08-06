-- 138: 계약 세분류 정리(2026-08-06 사용자 지시) — 견적(137)과 동일 체계로 맞춘다.
--   ① 장외영향평가 → 화학사고예방관리계획 (법령 명칭 변경 반영, 32건)
--   ② 대분류와 중복인 '장외&화관법' 세분류 1건 → 화관법기준 (사용자 확정)
--   ③ 목록에 없는 잔재 '환경법규' 1건 → 환경자문 (사용자 확정)
-- 영업허가는 데이터상 이미 장외&화관법 소속이라 이동 대상이 없다(UI 목록만 정정, 008 선례와 동일 취지).
-- 관례: 멱등(같은 값이 없으면 아무것도 하지 않음), updated_at 갱신.

UPDATE contracts
   SET service_subtype = '화학사고예방관리계획',
       updated_at = COALESCE(updated_at, NOW()::text)
 WHERE service_subtype = '장외영향평가';

UPDATE contracts
   SET service_subtype = '화관법기준',
       updated_at = COALESCE(updated_at, NOW()::text)
 WHERE service_type = '장외&화관법' AND service_subtype = '장외&화관법';

UPDATE contracts
   SET service_subtype = '환경자문',
       updated_at = COALESCE(updated_at, NOW()::text)
 WHERE service_type = '기타' AND service_subtype = '환경법규';

-- 잔재 방지: 통합허가로 잘못 분류된 영업허가가 있으면 장외&화관법으로 이동(현재 0건, 멱등 가드)
UPDATE contracts
   SET service_type = '장외&화관법',
       updated_at = COALESCE(updated_at, NOW()::text)
 WHERE service_type = '통합허가' AND service_subtype = '영업허가';
