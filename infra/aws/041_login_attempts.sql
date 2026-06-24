-- 041_login_attempts.sql
-- 로그인 시도 기록 — 무차별 대입(brute-force) 방어용. 실패 시도를 집계해 임계 초과 시 잠금.
-- 멱등: IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS login_attempts (
  id           bigserial PRIMARY KEY,
  email        text,
  ip           text,
  success      boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

-- 윈도 집계용 인덱스(email/ip 별 최근 실패 카운트).
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time ON login_attempts(email, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time   ON login_attempts(ip, attempted_at DESC);
