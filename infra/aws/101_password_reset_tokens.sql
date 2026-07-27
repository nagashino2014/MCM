-- 101_password_reset_tokens.sql
-- G-L 로그인 개편 — 비밀번호 셀프 재설정 1회용 토큰(블루프린트 §8.1).
-- 토큰 원문은 저장하지 않고 sha256 해시만 저장. 30분 만료·사용 후 폐기. 멱등.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_id   text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,        -- sha256(hex)
  expires_at text NOT NULL,
  used_at    text,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);
