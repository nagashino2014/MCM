# Cutover Runbook

## Staging Rehearsal

1. Stop local collection/parsing jobs.
2. Run the local inventory:

   ```powershell
   python scripts/aws-migration/inventory.py --output docs/aws/local-inventory.json
   ```

3. Copy `data/ieps/db.sqlite` to an immutable backup path.
4. Apply `infra/aws/001_initial_schema.sql` to an empty staging Aurora PostgreSQL database.
5. Dry-run the data load:

   ```powershell
   python scripts/aws-migration/sqlite_to_postgres.py --sqlite data/ieps/db.sqlite --dry-run
   ```

6. Load staging PostgreSQL:

   ```powershell
   $env:DATABASE_URL="postgresql://..."
   python scripts/aws-migration/sqlite_to_postgres.py --sqlite data/ieps/db.sqlite
   ```

7. Dry-run and then upload runtime files:

   ```powershell
   python scripts/aws-migration/upload_files_to_s3.py --bucket mcm-ieps-staging --region ap-northeast-2 --dry-run
   python scripts/aws-migration/upload_files_to_s3.py --bucket mcm-ieps-staging --region ap-northeast-2
   ```

8. Deploy Next.js, FastAPI, and scraper worker images to staging ECS.
9. Verify:
   - `GET /api/health`
   - `GET /ieps/health`
   - login with migrated `users`
   - facility list/detail/merge/contact/group flows
   - review queue and audit log
   - one collection job through SQS worker
   - one parse job through FastAPI and S3
   - RAG/Chroma replacement path if enabled

## Production Cutover

1. Announce a write freeze.
2. Disable local collection and parsing triggers.
3. Run final `inventory.py` and archive the output.
4. Copy final `db.sqlite` and upload it to `backups/sqlite/<timestamp>/db.sqlite`.
5. Apply schema to production Aurora.
6. Load final SQLite data.
7. Upload final runtime files to production S3.
8. Deploy production ECS services.
9. Point DNS/CloudFront/ALB to the AWS service.
10. Run post-cutover validation and compare row counts to the final inventory.

## Rollback

Rollback is DNS/application-level until users write new data in AWS.

- Keep local server and final `db.sqlite` snapshot untouched during the verification window.
- If critical validation fails before AWS writes are accepted, point DNS back to local/previous environment.
- If AWS writes have already happened, export affected PostgreSQL rows and reconcile before rollback.

## Post-Cutover Stabilization

- Review CloudWatch logs for Next.js, FastAPI, and scraper worker.
- Confirm SQS dead-letter queue is empty.
- Confirm Aurora automated backups and PITR are enabled.
- Confirm S3 bucket versioning and lifecycle policies.
- Rotate bootstrap `ADMIN_PASSWORD` and remove it from runtime secrets after admin creation.
