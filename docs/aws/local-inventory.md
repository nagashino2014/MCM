# Local Inventory Baseline

## Runtime Components

| Component | Local entrypoint | AWS target |
| --- | --- | --- |
| Next.js UI/API | `frontend`, `npm run dev`, port `3000` | ECS Fargate service behind ALB |
| FastAPI OCR/RAG | `backend`, `uvicorn app.main:app --port 8001` | ECS service, optionally GPU-backed ECS on EC2 |
| Scraper CLI | `scraper/scripts/cli-collect.ts` | ECS worker task triggered by SQS/EventBridge |
| SQLite database | `data/ieps/db.sqlite` | Aurora PostgreSQL |
| Runtime files | `data/ieps/**`, `frontend/public/uploads/logos/**` | S3 bucket |
| Vector store | `frontend/data/chromadb` | OpenSearch Serverless, Aurora pgvector, or managed Chroma |

## Schema Sources

The local schema is not managed by SQL migration files. It is defined by runtime TypeScript code:

- `scraper/lib/scraper/scraper-db.ts`: complete scraping, IEPS, RBAC, facility, contact, operations schema.
- `frontend/lib/db.ts`: frontend-side idempotent schema guards for auth/facility/ops tables.
- `frontend/app/api/collection-configs/route.ts`: defensive creation of `collection_configs`.

`infra/aws/001_initial_schema.sql` freezes those definitions into a PostgreSQL baseline and adds storage/job columns needed for AWS operation.

## Required Inventory Command

Run this before every migration rehearsal and production cutover:

```powershell
python scripts/aws-migration/inventory.py --output docs/aws/local-inventory.json
```

Review:

- `database.integrity_check` must be `ok`.
- `database.foreign_key_check` must be empty or explicitly accepted as legacy data debt.
- `database.tables.*.row_count` must be preserved after PostgreSQL load.
- `files.*.files` and `files.*.bytes` become the S3 upload baseline.

## Secret Handling

Move these to Secrets Manager or SSM Parameter Store:

- `AUTH_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `OPENAI_API_KEY`
- database credentials
- optional R2/S3-compatible credentials if external storage remains enabled

Rotate any key that has existed in local `.env` files before producing a container image.
