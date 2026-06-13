-- 장기 미수금 대응 조치 (구두 독촉 / 내용 증명 발송 / 채권 추심 진행) 이력.
-- 수주/수금/발행 현황 > 미수금 현황 탭에서 사용한다.

CREATE TABLE IF NOT EXISTS receivable_actions (
  action_id text PRIMARY KEY,
  contract_id text NOT NULL REFERENCES contracts(contract_id) ON DELETE CASCADE,
  milestone_id text NOT NULL REFERENCES contract_payment_milestones(milestone_id) ON DELETE CASCADE,
  -- verbal_dunning(구두 독촉) / content_proof(내용 증명 발송) / debt_collection(채권 추심 진행)
  action_type text NOT NULL CHECK (action_type IN ('verbal_dunning', 'content_proof', 'debt_collection')),
  -- 독촉일 / 내용 증명 발송일 / 가압류 신청일 (YYYY-MM-DD)
  action_date text,
  progress_note text NOT NULL DEFAULT '',
  -- 채권 추심 진행 단계별 일자: {"가압류 신청": "YYYY-MM-DD", "공탁금 납입": ..., ...}
  stage_dates_json jsonb,
  created_at text NOT NULL,
  updated_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_receivable_actions_milestone
  ON receivable_actions(milestone_id);

CREATE INDEX IF NOT EXISTS idx_receivable_actions_contract
  ON receivable_actions(contract_id);

-- 내용 증명 / 채권 추심 관련 증빙 서류 (S3 또는 로컬 디스크에 저장, 메타데이터만 기록)
CREATE TABLE IF NOT EXISTS receivable_action_documents (
  document_id text PRIMARY KEY,
  action_id text NOT NULL REFERENCES receivable_actions(action_id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text,
  byte_size integer,
  storage_provider text NOT NULL,
  storage_bucket text,
  storage_key text NOT NULL,
  public_path text,
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_receivable_action_documents_action
  ON receivable_action_documents(action_id);
