-- 개별 브리핑 공유: 권한 부여와 채널별 전달을 분리하고 동일 요청의 성공 채널을 재발송하지 않는다.
-- 322를 적용하지 않는 최소 로컬 fixture도 동일한 개별 공유 표식을 사용한다.
ALTER TABLE intel_rag_briefing_shares ADD COLUMN IF NOT EXISTS explicit_share boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS intel_briefing_share_requests (
  request_id text PRIMARY KEY,
  briefing_id text NOT NULL REFERENCES intel_rag_briefings(briefing_id) ON DELETE CASCADE,
  actor_user_id text NOT NULL REFERENCES users(user_id),
  request_key text NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_user_id, request_key)
);
CREATE TABLE IF NOT EXISTS intel_briefing_share_deliveries (
  delivery_id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES intel_briefing_share_requests(request_id) ON DELETE CASCADE,
  recipient_user_id text NOT NULL REFERENCES users(user_id),
  channel text NOT NULL CHECK(channel IN ('shared','inbox','push','messenger')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','skipped','unknown')),
  attempt integer NOT NULL DEFAULT 0,
  error text,
  provider_id text,
  lease_token text,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(request_id,recipient_user_id,channel)
);
CREATE INDEX IF NOT EXISTS idx_briefing_share_delivery_request ON intel_briefing_share_deliveries(request_id,status);
-- 메시지는 기존 text 종류를 유지한다. 클릭 가능한 문서 카드는 서버가 생성한 고정 경로만 저장한다.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS shared_record jsonb;
