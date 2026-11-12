-- 357_contact_quick_registrations.sql
-- 주소록 간이 등록(2026-11-12 사용자 결정, 직원 개선 요청 9·20).
--   메일의 보낸사람·받는사람·참조 주소를 눌러 '주소록에 추가'하면, 업체를 먼저 고르거나(없으면 업체명만으로 간이 업체를 만들고)
--   담당자 이름·직함·전화를 적어 사업장 담당자(facility_contact_people)로 바로 넣는다. 주소록·메일 받는 사람 검색에 곧바로 나온다.
--   이렇게 만든 업체·담당자는 이 표에 '간이 등록'으로 남는다. 관리자(facility.edit)는 목록에서
--     ① 업체는 사업자번호·주소 등 상세 정보를 직접 등록하고 확정하고,
--     ② 담당자는 등록한 직원에게 '상세정보 등록 요청'(메신저 DM·알림)을 보낸다. 직원이 보완하면 완료된다.
--   업체·담당자 원본 표(facilities·facility_contact_people)는 바꾸지 않는다 — ADT·intel 배치가 쓰는 facilities 스키마를
--   건드리지 않기 위해 표시 구분을 이 표에 따로 둔다.
--   외래키를 두지 않는다. 담당자 삭제(DELETE /api/directory/contacts)는 행을 실제로 지우므로, 남은 간이 행은 조회에서 걸러진다.
-- 설치 전제: 없음(독립 표). 멱등.

CREATE TABLE IF NOT EXISTS contact_quick_registrations (
  quick_id       bigserial PRIMARY KEY,
  kind           text NOT NULL,          -- facility(간이 업체) | person(간이 담당자)
  facility_id    text NOT NULL,          -- facilities.facility_id
  person_id      bigint,                 -- facility_contact_people.id (kind=person)
  source         text NOT NULL DEFAULT 'mail', -- mail(메일 주소 클릭) | directory(주소록 화면)
  source_address text,                   -- 누른 메일 주소(소문자)
  registered_by  text NOT NULL,          -- 등록한 직원 users.user_id
  registered_at  text NOT NULL,
  status         text NOT NULL DEFAULT 'pending', -- pending(간이) | requested(상세정보 요청함) | done(확정·보완 완료)
  requested_by   text,
  requested_at   text,
  request_note   text,
  completed_by   text,
  completed_at   text,
  CONSTRAINT contact_quick_registrations_kind_check CHECK (kind IN ('facility', 'person')),
  CONSTRAINT contact_quick_registrations_source_check CHECK (source IN ('mail', 'directory')),
  CONSTRAINT contact_quick_registrations_status_check CHECK (status IN ('pending', 'requested', 'done')),
  CONSTRAINT contact_quick_registrations_person_check CHECK (kind = 'facility' OR person_id IS NOT NULL)
);

-- 업체·담당자마다 간이 행은 하나다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_quick_facility ON contact_quick_registrations(facility_id) WHERE kind = 'facility';
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_quick_person ON contact_quick_registrations(person_id) WHERE kind = 'person';
CREATE INDEX IF NOT EXISTS idx_contact_quick_status ON contact_quick_registrations(status, registered_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_quick_registered_by ON contact_quick_registrations(registered_by, status);

-- 점검(읽기 전용)
-- SELECT kind, status, count(*) FROM contact_quick_registrations GROUP BY 1, 2 ORDER BY 1, 2;
