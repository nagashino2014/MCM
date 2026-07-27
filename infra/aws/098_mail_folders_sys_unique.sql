-- 098_mail_folders_sys_unique.sql
-- 회사 도메인 메일 P1 hotfix — mail_folders 시스템 폴더 유니크 인덱스를 부분→전체로 교체.
-- 096 의 부분 인덱스(WHERE system_kind IS NOT NULL)는 코드의
-- `INSERT ... ON CONFLICT (mailbox_id, system_kind) DO NOTHING`(술어 미지정)과 매칭되지 않아
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification" 오류를 냈다.
-- 전체 유니크 인덱스는 system_kind NULL(사용자 폴더)을 서로 distinct 로 취급하므로 동작이 동일하다.
-- 멱등.

DROP INDEX IF EXISTS idx_mail_folders_sys;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_folders_sys
  ON mail_folders(mailbox_id, system_kind);
