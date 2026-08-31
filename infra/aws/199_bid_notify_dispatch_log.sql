-- 199: 공공입찰 매칭 알림 발송 이력 — 프로파일별 기발송 건 기록(2026-08-24 사용자 리포트).
-- 배경: 발송 디스패처(notify-dispatch)가 슬롯마다 매칭 범위(rangeDays)를 통째로 재검색해
-- 발송하는 구조라, 신규 공고가 없어도 같은 건이 알림 시간대마다 반복 발송됐다.
-- 프로파일 단위로 이미 발송한 (bid_type, bid_id)를 기록해 두고, 다음 슬롯부터는
-- 검색 결과에서 기발송 건을 제외한 "신규 매칭"만 발송한다.
-- 관례: text 타임스탬프, 멱등(IF NOT EXISTS). 오래된 행은 디스패처가 주기 정리한다.

CREATE TABLE IF NOT EXISTS bid_notify_dispatch_log (
  profile_id text NOT NULL,
  bid_type   text NOT NULL,
  bid_id     text NOT NULL,
  sent_at    text NOT NULL,
  PRIMARY KEY (profile_id, bid_type, bid_id)
);

-- 정리 스캔용(프로파일 삭제·기간 경과 정리 시 sent_at 범위 조회).
CREATE INDEX IF NOT EXISTS idx_bid_notify_dispatch_log_sent_at
  ON bid_notify_dispatch_log (sent_at);
