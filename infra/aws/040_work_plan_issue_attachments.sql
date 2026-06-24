-- 040_work_plan_issue_attachments.sql
-- 이슈 보고 첨부파일. S3 키는 용역/Task 별로 분류(issues/{contract|task}/{subjectId}/{issueId}/{파일명}).
-- 멱등.

CREATE TABLE IF NOT EXISTS work_plan_issue_attachments (
  attachment_id    text PRIMARY KEY,
  issue_id         text NOT NULL REFERENCES work_plan_issues(issue_id) ON DELETE CASCADE,
  file_name        text NOT NULL,
  content_type     text,
  byte_size        bigint,
  sha256           text,
  storage_provider text,
  storage_bucket   text,
  storage_key      text NOT NULL,
  public_path      text,
  created_by       text REFERENCES users(user_id) ON DELETE SET NULL,
  created_at       text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wpia_issue ON work_plan_issue_attachments(issue_id);
