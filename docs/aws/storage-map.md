# S3 Storage Map

MCM currently stores files on local disk and keeps path strings in SQLite. AWS operation stores file bytes in S3 and stores stable object keys in PostgreSQL.

## Bucket Layout

| Local source | S3 prefix | Purpose |
| --- | --- | --- |
| `data/ieps/raw/<year>/<postId>/*.pdf` | `ieps/raw/<year>/<postId>/*.pdf` | Original IEPS PDFs |
| `data/ieps/extracted/<year>/<postId>/*.json` | `ieps/extracted/<year>/<postId>/*.json` | FastAPI parse output |
| `data/ieps/logs/**` | `ieps/logs/**` | Collection and diagnostic logs |
| `data/ieps/summary.json` | `ieps/summary/summary.json` | Last local collection summary |
| `frontend/public/uploads/logos/**` | `uploads/logos/**` | Facility/group logos |
| `data/ksic/ksic11.json` | `reference/ksic/ksic11.json` | KSIC reference file |
| `backend/data/jobs/**` | `jobs/backend/**` | Legacy embedding job snapshots |
| `frontend/data/chromadb/**` | `vector/chromadb-snapshot/**` | ChromaDB snapshot for re-indexing |
| `data/ieps/db.sqlite` | `backups/sqlite/<timestamp>/db.sqlite` | Immutable cutover backup |

## PostgreSQL Storage Columns

The PostgreSQL baseline keeps legacy path columns and adds object-storage columns where paths are user-facing or parser-facing:

- `attachments.local_path` remains for historical compatibility.
- `attachments.storage_provider`, `attachments.storage_bucket`, `attachments.storage_key` identify the S3 object.
- `parsed_fields.pdf_path` remains for historical diagnostics.
- `parsed_fields.storage_provider`, `parsed_fields.storage_bucket`, `parsed_fields.storage_key` identify the parsed PDF source.
- `facilities.logo_path`, `facility_groups.logo_path`, and `facility_group_companies.logo_path` remain for UI compatibility.
- matching `logo_storage_*` columns identify the S3 object.
- `facility_annual_reports.source_pdf_path` remains while `source_storage_*` points to S3.

## Access Rules

- Keep S3 public access blocked.
- Serve private objects through the app or CloudFront signed URLs.
- Allow ECS task roles to access only required prefixes.
- Use SSE-KMS for the bucket.
- Treat PDFs and contact data as sensitive because they may contain business registration numbers, addresses, and phone numbers.

## Upload Dry Run

```powershell
python scripts/aws-migration/upload_files_to_s3.py --bucket mcm-ieps-prod --region ap-northeast-2 --dry-run
```
