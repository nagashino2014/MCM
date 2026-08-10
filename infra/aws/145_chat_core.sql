-- 145: 사내 메신저(MSG-P0) — 대화방·멤버·메시지·첨부 코어 스키마.
-- 설계: docs/mobile-phase3-blueprint.md §MSG-1.
--   참여자 키는 users.user_id(mail·approval 관례), 표시 정보는 employee_profiles 조인.
--   DM 중복 방지: dm_key = 'dm:{작은uid}:{큰uid}' UNIQUE.
--   읽음 커서 = chat_room_members.last_read_message_id (bigint, 뒤로 이동 금지는 앱 레이어 GREATEST).
--   삭제는 소프트(deleted_at). 수정 미지원. 첨부 메타는 board_attachments 스키마 준거(MSG-P1에서 사용).
-- 관례: 멱등(IF NOT EXISTS), text 타임스탬프(ISO 문자열).

CREATE TABLE IF NOT EXISTS chat_rooms (
  room_id bigserial PRIMARY KEY,
  room_type text NOT NULL CHECK (room_type IN ('dm','group')),
  name text,                       -- 그룹 전용. DM 은 클라이언트가 상대 이름을 표시한다.
  dm_key text UNIQUE,              -- DM 만. group 은 NULL.
  created_by text NOT NULL REFERENCES users(user_id),
  created_at text NOT NULL,
  last_message_at text,            -- 목록 정렬용 비정규화(발송 트랜잭션에서 갱신)
  last_message_preview text        -- 목록 미리보기 1줄(발송 트랜잭션에서 갱신)
);

CREATE TABLE IF NOT EXISTS chat_room_members (
  room_id bigint NOT NULL REFERENCES chat_rooms(room_id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  member_role text NOT NULL DEFAULT 'member' CHECK (member_role IN ('owner','member')),
  joined_at text NOT NULL,
  left_at text,                    -- 나가기. 재초대 시 NULL 로 복귀.
  last_read_message_id bigint NOT NULL DEFAULT 0,
  notify_muted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  message_id bigserial PRIMARY KEY,
  room_id bigint NOT NULL REFERENCES chat_rooms(room_id) ON DELETE CASCADE,
  sender_id text NOT NULL REFERENCES users(user_id),
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','file','image','system')),
  body text NOT NULL DEFAULT '',   -- text/system 본문. file/image 는 캡션(옵션).
  reply_to_message_id bigint,      -- MSG-P2 답장(인용). FK 는 걸지 않는다(삭제 메시지 인용 허용).
  created_at text NOT NULL,
  deleted_at text
);

CREATE TABLE IF NOT EXISTS chat_attachments (
  attachment_id bigserial PRIMARY KEY,
  message_id bigint NOT NULL REFERENCES chat_messages(message_id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text,
  byte_size bigint,
  sha256 text,
  storage_provider text,
  storage_bucket text,
  storage_key text,
  public_path text,
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id, message_id DESC);
CREATE INDEX IF NOT EXISTS idx_chat_room_members_user ON chat_room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_rooms_last ON chat_rooms(last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON chat_attachments(message_id);
