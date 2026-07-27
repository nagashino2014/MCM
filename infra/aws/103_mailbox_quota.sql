-- 103_mailbox_quota.sql
-- G2-14 hotfix — 095 에서 누락된 mailboxes 용량 컬럼 추가.
-- (설정 화면·인원별 용량 배분 모달이 quota_bytes/used_bytes 를 참조 — 부재 시 관리자 목록 API 500 → 섹션 미표시)
-- 멱등.

ALTER TABLE mailboxes
  ADD COLUMN IF NOT EXISTS quota_bytes bigint,
  ADD COLUMN IF NOT EXISTS used_bytes bigint NOT NULL DEFAULT 0;
