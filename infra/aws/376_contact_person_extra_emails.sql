-- 376: 사업장 담당자의 추가 이메일(2026-11-20, 직원 요청 29)
--
-- 주소록에서 한 사람에게 회사 메일·개인 메일 등 여러 주소를 넣을 수 있게 한다.
-- 대표 주소는 지금처럼 facility_contact_people.email 에 두고(계산서 수신처·기존 조회가 그대로 쓴다),
-- 그 밖의 주소만 이 배열에 둔다. 소문자, 대표 주소와 겹치지 않게 앱이 정리해 넣는다.
--
-- 멱등: 열·인덱스 모두 IF NOT EXISTS. 기존 행은 빈 배열이 된다(데이터 변경 없음).
-- 적용 전 앱 동작: 조회는 to_jsonb(p)->'extra_emails' 로 읽어 열이 없어도 깨지지 않는다.
--   추가 이메일을 실제로 저장하려는 요청만 이 열이 필요하다 — next 배포 전에 적용한다.

ALTER TABLE facility_contact_people
  ADD COLUMN IF NOT EXISTS extra_emails text[] NOT NULL DEFAULT '{}'::text[];

-- 받는 사람 자동완성·메일 머리글의 이름 조회가 추가 주소로도 담당자를 찾는다.
CREATE INDEX IF NOT EXISTS idx_facility_contact_people_extra_emails
  ON facility_contact_people USING gin (extra_emails);
