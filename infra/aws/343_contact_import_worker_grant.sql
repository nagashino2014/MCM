-- 343_contact_import_worker_grant.sql
-- 342 의 사업자번호 검색 워커 권한. 워커는 앱(mcm_app)과 다른 mcm_worker 로 접속하고,
-- 265 의 기본 권한은 mcm_app 에만 주므로 새 표마다 명시해야 한다.
-- 워커는 회사 행의 검색 결과만 쓴다. 담당자 명단(contact_import_rows)은 읽지 않는다. 멱등.

GRANT SELECT, UPDATE ON TABLE contact_import_companies TO mcm_worker;
