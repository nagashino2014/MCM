# MCM AWS Migration Runbook

이 디렉터리는 로컬 MCM 전체 앱을 AWS 운영형 구조로 이전하기 위한 실행 산출물입니다.

## 구성

- `local-inventory.md`: 현재 로컬 앱/데이터 인벤토리 기준.
- `storage-map.md`: 로컬 파일 경로에서 S3 object key로 가는 매핑.
- `cutover-runbook.md`: staging 리허설과 운영 전환 절차.
- `../..//infra/aws/001_initial_schema.sql`: Aurora PostgreSQL 초기 스키마.
- `../../scripts/aws-migration/inventory.py`: 로컬 SQLite/파일 기준선 리포트 생성.
- `../../scripts/aws-migration/sqlite_to_postgres.py`: SQLite snapshot을 PostgreSQL에 적재.
- `../../scripts/aws-migration/upload_files_to_s3.py`: 런타임 파일을 S3 prefix로 업로드.

## 권장 실행 순서

1. 로컬 쓰기 작업을 멈춘 뒤 `inventory.py`를 실행한다.
2. `db.sqlite`와 파일 저장소를 백업한다.
3. staging Aurora에 `001_initial_schema.sql`을 적용한다.
4. `sqlite_to_postgres.py --dry-run`으로 테이블별 적재량을 확인한다.
5. `upload_files_to_s3.py --dry-run`으로 S3 key 매핑을 확인한다.
6. staging에 실제 적재 후 UI/API/수집/OCR/RAG를 검증한다.
7. 운영 전환일에 최종 snapshot으로 같은 절차를 반복한다.
