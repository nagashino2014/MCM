-- 131: AI 브리핑 공유(사용자 요구 — RAG & 영업 발굴 브리핑을 조직도에서 선택한 인원에게 공유).
-- 공유 1건 = (브리핑, 수신자) 쌍. 재공유 시 UNIQUE 로 중복을 막고 shared_at 만 갱신한다.
-- 수신자는 RAG 화면 "공유받은 브리핑" 목록에서 열람하며, 열람 시 read_at 마킹.
-- 관례: 타임스탬프 text(ISO), 멱등(IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS intel_rag_briefing_shares (
  share_id          text PRIMARY KEY,
  briefing_id       text NOT NULL REFERENCES intel_rag_briefings(briefing_id) ON DELETE CASCADE,
  recipient_user_id text NOT NULL,
  shared_by         text,
  read_at           text,
  created_at        text NOT NULL,
  UNIQUE (briefing_id, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_rag_shares_recipient ON intel_rag_briefing_shares(recipient_user_id, created_at DESC);
