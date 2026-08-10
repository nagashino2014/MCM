/**
 * 사내 메신저(MSG-P0) — 대화방·메시지 조회/생성.
 * 설계: docs/mobile-phase3-blueprint.md §MSG-2.
 * - 참여자 키는 users.user_id, 표시 이름·사진은 employee_profiles 조인(없으면 users.name).
 * - 모든 함수가 멤버십을 직접 검증한다(라우트는 requireSession 의 userId 만 전달).
 * - 타임스탬프는 ISO 문자열(text 컬럼) — 저장소 관례.
 */
import { getDb, rowsToObjects, withDbWrite, PgDatabase } from "@/lib/db";
import {
  chatAttachmentPublicPath,
  getChatAttachmentStorageKey,
  putChatAttachment,
} from "@/lib/storage/chat-attachment-storage";

export interface ChatRoomSummary {
  roomId: number;
  roomType: "dm" | "group";
  /** 그룹=지정 이름, DM=상대 이름(클라 표시용으로 서버가 채워 준다). */
  name: string;
  memberCount: number;
  /** DM 상대의 증명사진 경로(그룹은 null). */
  peerPhotoPath: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  muted: boolean;
}

export interface ChatMessageRow {
  messageId: number;
  roomId: number;
  senderId: string;
  senderName: string;
  senderPhotoPath: string | null;
  kind: "text" | "file" | "image" | "system";
  body: string;
  replyToMessageId: number | null;
  createdAt: string;
  deleted: boolean;
  /** file/image 메시지의 첨부(메시지당 1개 — P1 규칙). */
  attachment: {
    attachmentId: number;
    fileName: string;
    contentType: string | null;
    byteSize: number | null;
    /** 인증 프록시 다운로드 경로(/api/chat/attachments?id=). */
    path: string;
  } | null;
  /** 답장(인용) 원문 요약(MSG-P2) — 원문이 삭제됐으면 deleted 만 true. */
  replyTo: {
    messageId: number;
    senderName: string;
    preview: string;
    kind: ChatMessageRow["kind"];
    deleted: boolean;
  } | null;
}

export interface ChatRoomMember {
  userId: string;
  name: string;
  positionName: string | null;
  photoPath: string | null;
  memberRole: "owner" | "member";
}

const PREVIEW_MAX = 80;

function nowIso(): string {
  return new Date().toISOString();
}

/** 멤버십 검증 — 아니면 null. (left 멤버는 비멤버 취급) */
async function memberRow(
  db: PgDatabase,
  roomId: number,
  userId: string
): Promise<{ lastReadMessageId: number } | null> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT last_read_message_id FROM chat_room_members
        WHERE room_id = $1 AND user_id = $2 AND left_at IS NULL`,
      [roomId, userId]
    )
  );
  if (!rows.length) return null;
  return { lastReadMessageId: Number(rows[0].last_read_message_id ?? 0) };
}

export class ChatAccessError extends Error {}

/** 내 대화방 목록 — 안읽음 수·마지막 메시지·표시 이름 포함. */
export async function listRooms(userId: string, type?: "dm" | "group"): Promise<ChatRoomSummary[]> {
  const db = await getDb();
  const rooms = rowsToObjects(
    await db.exec(
      `SELECT r.room_id, r.room_type, r.name, r.last_message_at, r.last_message_preview,
              m.notify_muted,
              (SELECT COUNT(*) FROM chat_messages cm
                WHERE cm.room_id = r.room_id
                  AND cm.message_id > m.last_read_message_id
                  AND cm.sender_id <> $1
                  AND cm.deleted_at IS NULL) AS unread
         FROM chat_room_members m
         JOIN chat_rooms r ON r.room_id = m.room_id
        WHERE m.user_id = $1 AND m.left_at IS NULL
          ${type ? "AND r.room_type = $2" : ""}
        ORDER BY r.last_message_at DESC NULLS LAST, r.room_id DESC`,
      type ? [userId, type] : [userId]
    )
  );
  if (!rooms.length) return [];

  // 멤버 표시 정보(이름·사진) — 방들 한 번에 조인.
  const ids = rooms.map((r) => Number(r.room_id));
  const memberRows = rowsToObjects(
    await db.exec(
      `SELECT m.room_id, m.user_id, COALESCE(e.name, u.name) AS name, e.photo_public_path
         FROM chat_room_members m
         JOIN users u ON u.user_id = m.user_id
         LEFT JOIN employee_profiles e ON e.user_id = m.user_id
        WHERE m.room_id = ANY($1) AND m.left_at IS NULL`,
      [ids]
    )
  );
  const byRoom = new Map<number, { userId: string; name: string; photo: string | null }[]>();
  for (const r of memberRows) {
    const rid = Number(r.room_id);
    const arr = byRoom.get(rid) ?? [];
    arr.push({
      userId: String(r.user_id),
      name: String(r.name ?? ""),
      photo: r.photo_public_path != null ? String(r.photo_public_path) : null,
    });
    byRoom.set(rid, arr);
  }

  return rooms.map((r) => {
    const rid = Number(r.room_id);
    const members = byRoom.get(rid) ?? [];
    const others = members.filter((m) => m.userId !== userId);
    const roomType = String(r.room_type) as "dm" | "group";
    const name =
      roomType === "group"
        ? String(r.name ?? "") || others.map((o) => o.name).join(", ")
        : others[0]?.name ?? "(알 수 없음)";
    return {
      roomId: rid,
      roomType,
      name,
      memberCount: members.length,
      peerPhotoPath: roomType === "dm" ? (others[0]?.photo ?? null) : null,
      lastMessageAt: r.last_message_at != null ? String(r.last_message_at) : null,
      lastMessagePreview: r.last_message_preview != null ? String(r.last_message_preview) : null,
      unreadCount: Number(r.unread ?? 0),
      muted: r.notify_muted === true,
    };
  });
}

/**
 * 대화방 생성 — 상대 1명이면 DM(dm_key 로 기존 방 재사용), 2명 이상이면 그룹.
 * 반환: roomId (+ created 플래그 — DM 재사용이면 false).
 */
export async function createRoom(
  userId: string,
  targetUserIds: string[],
  name?: string
): Promise<{ roomId: number; created: boolean }> {
  const targets = [...new Set(targetUserIds.filter((t) => t && t !== userId))];
  if (!targets.length) throw new ChatAccessError("대화 상대를 선택해 주세요.");

  return withDbWrite(async (db) => {
    // 대상 계정 유효성(활성 계정만).
    const valid = rowsToObjects(
      await db.exec(`SELECT user_id FROM users WHERE user_id = ANY($1) AND status = 'active'`, [targets])
    ).map((r) => String(r.user_id));
    if (valid.length !== targets.length) throw new ChatAccessError("대화 상대 계정을 찾을 수 없습니다.");

    const now = nowIso();

    if (targets.length === 1) {
      const pair = [userId, targets[0]].sort();
      const dmKey = `dm:${pair[0]}:${pair[1]}`;
      const existing = rowsToObjects(
        await db.exec(`SELECT room_id FROM chat_rooms WHERE dm_key = $1`, [dmKey])
      );
      if (existing.length) {
        const roomId = Number(existing[0].room_id);
        // 한쪽이 나갔던 DM 재개 — left_at 복귀.
        await db.run(
          `UPDATE chat_room_members SET left_at = NULL WHERE room_id = $1 AND user_id = ANY($2)`,
          [roomId, pair]
        );
        return { roomId, created: false };
      }
      const created = rowsToObjects(
        await db.exec(
          `INSERT INTO chat_rooms (room_type, dm_key, created_by, created_at) VALUES ('dm', $1, $2, $3)
           RETURNING room_id`,
          [dmKey, userId, now]
        )
      );
      const roomId = Number(created[0].room_id);
      for (const uid of pair) {
        await db.run(
          `INSERT INTO chat_room_members (room_id, user_id, member_role, joined_at) VALUES ($1, $2, $3, $4)`,
          [roomId, uid, uid === userId ? "owner" : "member", now]
        );
      }
      return { roomId, created: true };
    }

    // 그룹
    const created = rowsToObjects(
      await db.exec(
        `INSERT INTO chat_rooms (room_type, name, created_by, created_at) VALUES ('group', $1, $2, $3)
         RETURNING room_id`,
        [name?.trim() || null, userId, now]
      )
    );
    const roomId = Number(created[0].room_id);
    for (const uid of [userId, ...targets]) {
      await db.run(
        `INSERT INTO chat_room_members (room_id, user_id, member_role, joined_at) VALUES ($1, $2, $3, $4)`,
        [roomId, uid, uid === userId ? "owner" : "member", now]
      );
    }
    const creatorName = rowsToObjects(
      await db.exec(
        `SELECT COALESCE(e.name, u.name) AS name FROM users u
          LEFT JOIN employee_profiles e ON e.user_id = u.user_id WHERE u.user_id = $1`,
        [userId]
      )
    );
    await insertMessage(db, roomId, userId, "system", `${String(creatorName[0]?.name ?? "")}님이 대화를 시작했습니다.`, null);
    return { roomId, created: true };
  });
}

/** 메시지 조회 — before(과거 페이징) / after(증분 폴링). 오름차순 반환. */
export async function listMessages(
  roomId: number,
  userId: string,
  opts: { before?: number; after?: number; limit?: number }
): Promise<ChatMessageRow[]> {
  const db = await getDb();
  if (!(await memberRow(db, roomId, userId))) throw new ChatAccessError("대화방 멤버가 아닙니다.");
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);

  // before: 최신에서 과거로 limit 개(내림차순으로 잘라 뒤집는다). after: 증분 오름차순.
  const cond = opts.after ? "AND cm.message_id > $2" : opts.before ? "AND cm.message_id < $2" : "";
  const order = opts.after ? "ASC" : "DESC";
  const params: unknown[] = opts.after ? [roomId, opts.after] : opts.before ? [roomId, opts.before] : [roomId];
  const rows = rowsToObjects(
    await db.exec(
      `SELECT cm.message_id, cm.room_id, cm.sender_id, cm.kind, cm.body, cm.reply_to_message_id,
              cm.created_at, cm.deleted_at, COALESCE(e.name, u.name) AS sender_name, e.photo_public_path,
              a.attachment_id, a.file_name, a.content_type, a.byte_size,
              rm.kind AS reply_kind, rm.body AS reply_body, rm.deleted_at AS reply_deleted_at,
              COALESCE(re.name, ru.name) AS reply_sender_name, ra.file_name AS reply_file_name
         FROM chat_messages cm
         JOIN users u ON u.user_id = cm.sender_id
         LEFT JOIN employee_profiles e ON e.user_id = cm.sender_id
         LEFT JOIN chat_attachments a ON a.message_id = cm.message_id
         LEFT JOIN chat_messages rm ON rm.message_id = cm.reply_to_message_id
         LEFT JOIN users ru ON ru.user_id = rm.sender_id
         LEFT JOIN employee_profiles re ON re.user_id = rm.sender_id
         LEFT JOIN chat_attachments ra ON ra.message_id = rm.message_id
        WHERE cm.room_id = $1 ${cond}
        ORDER BY cm.message_id ${order}
        LIMIT ${limit}`,
      params
    )
  );
  const mapped = rows.map((r) => ({
    messageId: Number(r.message_id),
    roomId: Number(r.room_id),
    senderId: String(r.sender_id),
    senderName: String(r.sender_name ?? ""),
    senderPhotoPath: r.photo_public_path != null ? String(r.photo_public_path) : null,
    kind: String(r.kind) as ChatMessageRow["kind"],
    // 소프트 삭제 — 본문은 내리지 않는다.
    body: r.deleted_at != null ? "" : String(r.body ?? ""),
    replyToMessageId: r.reply_to_message_id != null ? Number(r.reply_to_message_id) : null,
    createdAt: String(r.created_at),
    deleted: r.deleted_at != null,
    attachment:
      r.attachment_id != null && r.deleted_at == null
        ? {
            attachmentId: Number(r.attachment_id),
            fileName: String(r.file_name ?? ""),
            contentType: r.content_type != null ? String(r.content_type) : null,
            byteSize: r.byte_size != null ? Number(r.byte_size) : null,
            path: chatAttachmentPublicPath(Number(r.attachment_id)),
          }
        : null,
    replyTo:
      r.reply_to_message_id != null
        ? {
            messageId: Number(r.reply_to_message_id),
            senderName: String(r.reply_sender_name ?? ""),
            preview:
              r.reply_deleted_at != null
                ? ""
                : String(r.reply_body ?? "").replace(/\s+/g, " ").slice(0, 50) ||
                  (r.reply_file_name != null ? `📎 ${String(r.reply_file_name)}` : ""),
            kind: String(r.reply_kind ?? "text") as ChatMessageRow["kind"],
            deleted: r.reply_deleted_at != null,
          }
        : null,
  }));
  return opts.after ? mapped : mapped.reverse();
}

async function insertMessage(
  db: PgDatabase,
  roomId: number,
  senderId: string,
  kind: ChatMessageRow["kind"],
  body: string,
  replyTo: number | null,
  previewText?: string
): Promise<number> {
  const now = nowIso();
  const rows = rowsToObjects(
    await db.exec(
      `INSERT INTO chat_messages (room_id, sender_id, kind, body, reply_to_message_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING message_id`,
      [roomId, senderId, kind, body, replyTo, now]
    )
  );
  const messageId = Number(rows[0].message_id);
  const preview = (previewText ?? (kind === "system" ? body : body.replace(/\s+/g, " "))).slice(0, PREVIEW_MAX);
  await db.run(
    `UPDATE chat_rooms SET last_message_at = $2, last_message_preview = $3 WHERE room_id = $1`,
    [roomId, now, preview]
  );
  // 발신자 읽음 커서는 자기 메시지까지 전진(자기 메시지가 안읽음으로 잡히지 않게).
  await db.run(
    `UPDATE chat_room_members SET last_read_message_id = GREATEST(last_read_message_id, $3)
      WHERE room_id = $1 AND user_id = $2`,
    [roomId, senderId, messageId]
  );
  return messageId;
}

/** 텍스트 메시지 전송. 반환: 생성된 메시지 id. */
export async function postTextMessage(
  roomId: number,
  userId: string,
  body: string,
  replyTo?: number | null
): Promise<number> {
  const text = body.trim();
  if (!text) throw new ChatAccessError("메시지 내용이 비어 있습니다.");
  if (text.length > 4000) throw new ChatAccessError("메시지는 4,000자 이내로 입력해 주세요.");
  return withDbWrite(async (db) => {
    if (!(await memberRow(db, roomId, userId))) throw new ChatAccessError("대화방 멤버가 아닙니다.");
    return insertMessage(db, roomId, userId, "text", text, replyTo ?? null);
  });
}

/** 읽음 커서 전진(뒤로는 이동하지 않는다). */
export async function markRead(roomId: number, userId: string, messageId: number): Promise<void> {
  const db = await getDb();
  if (!(await memberRow(db, roomId, userId))) throw new ChatAccessError("대화방 멤버가 아닙니다.");
  await db.run(
    `UPDATE chat_room_members SET last_read_message_id = GREATEST(last_read_message_id, $3)
      WHERE room_id = $1 AND user_id = $2`,
    [roomId, userId, messageId]
  );
}

/** 첨부 메시지 전송(MSG-P1) — S3 저장 → file/image 메시지 + chat_attachments 기록. */
export async function postFileMessage(
  roomId: number,
  userId: string,
  file: { buffer: Buffer; fileName: string; contentType: string; byteSize: number },
  caption?: string
): Promise<number> {
  const { storageKey, fileName } = getChatAttachmentStorageKey({ roomId, fileName: file.fileName });
  // 멤버십은 트랜잭션 안에서 검증하지만, S3 업로드는 커밋 전에 끝내 둔다(실패 시 메시지 자체가 안 생기게).
  const stored = await putChatAttachment(storageKey, file.buffer, file.contentType);
  const kind: ChatMessageRow["kind"] = file.contentType.startsWith("image/") ? "image" : "file";

  return withDbWrite(async (db) => {
    if (!(await memberRow(db, roomId, userId))) throw new ChatAccessError("대화방 멤버가 아닙니다.");
    const messageId = await insertMessage(
      db,
      roomId,
      userId,
      kind,
      (caption ?? "").trim(),
      null,
      `${kind === "image" ? "🖼" : "📎"} ${fileName}`
    );
    const rows = rowsToObjects(
      await db.exec(
        `INSERT INTO chat_attachments
           (message_id, file_name, content_type, byte_size, storage_provider, storage_bucket, storage_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING attachment_id`,
        [
          messageId,
          fileName,
          file.contentType,
          file.byteSize,
          stored.storageProvider,
          stored.storageBucket,
          stored.storageKey,
          nowIso(),
        ]
      )
    );
    const attachmentId = Number(rows[0].attachment_id);
    await db.run(`UPDATE chat_attachments SET public_path = $2 WHERE attachment_id = $1`, [
      attachmentId,
      chatAttachmentPublicPath(attachmentId),
    ]);
    return messageId;
  });
}

/** 업로드 완료 확정(MSG-P2 presigned 대용량) — 파일은 이미 S3 에 있고 메타만 기록한다. */
export async function postUploadedFileMessage(
  roomId: number,
  userId: string,
  file: { storageKey: string; fileName: string; contentType: string; byteSize: number },
  caption?: string
): Promise<number> {
  // 키 위조 방지 — presign 이 발급한 이 방의 프리픽스만 허용.
  if (!file.storageKey.startsWith(`chat/${roomId}/`)) {
    throw new ChatAccessError("업로드 키가 올바르지 않습니다.");
  }
  const kind: ChatMessageRow["kind"] = file.contentType.startsWith("image/") ? "image" : "file";
  return withDbWrite(async (db) => {
    if (!(await memberRow(db, roomId, userId))) throw new ChatAccessError("대화방 멤버가 아닙니다.");
    const messageId = await insertMessage(
      db,
      roomId,
      userId,
      kind,
      (caption ?? "").trim(),
      null,
      `${kind === "image" ? "🖼" : "📎"} ${file.fileName}`
    );
    const bucket = process.env.MCM_STORAGE_BUCKET?.trim() ?? null;
    const rows = rowsToObjects(
      await db.exec(
        `INSERT INTO chat_attachments
           (message_id, file_name, content_type, byte_size, storage_provider, storage_bucket, storage_key, created_at)
         VALUES ($1, $2, $3, $4, 's3', $5, $6, $7) RETURNING attachment_id`,
        [messageId, file.fileName, file.contentType, file.byteSize, bucket, file.storageKey, nowIso()]
      )
    );
    const attachmentId = Number(rows[0].attachment_id);
    await db.run(`UPDATE chat_attachments SET public_path = $2 WHERE attachment_id = $1`, [
      attachmentId,
      chatAttachmentPublicPath(attachmentId),
    ]);
    return messageId;
  });
}

/** 방 상세(MSG-P2) — 멤버 목록 + 내 알림 설정. 멤버가 아니면 null. */
export async function getRoomDetail(
  roomId: number,
  userId: string
): Promise<{
  roomId: number;
  roomType: "dm" | "group";
  name: string | null;
  muted: boolean;
  members: ChatRoomMember[];
} | null> {
  const db = await getDb();
  const rooms = rowsToObjects(
    await db.exec(
      `SELECT r.room_type, r.name, m.notify_muted
         FROM chat_rooms r
         JOIN chat_room_members m ON m.room_id = r.room_id AND m.user_id = $2 AND m.left_at IS NULL
        WHERE r.room_id = $1`,
      [roomId, userId]
    )
  );
  if (!rooms.length) return null;
  const memberRows = rowsToObjects(
    await db.exec(
      `SELECT m.user_id, m.member_role, COALESCE(e.name, u.name) AS name, e.photo_public_path, p.position_name
         FROM chat_room_members m
         JOIN users u ON u.user_id = m.user_id
         LEFT JOIN employee_profiles e ON e.user_id = m.user_id
         LEFT JOIN positions p ON p.position_id = e.position_id
        WHERE m.room_id = $1 AND m.left_at IS NULL
        ORDER BY name`,
      [roomId]
    )
  );
  return {
    roomId,
    roomType: String(rooms[0].room_type) as "dm" | "group",
    name: rooms[0].name != null ? String(rooms[0].name) : null,
    muted: rooms[0].notify_muted === true,
    members: memberRows.map((r) => ({
      userId: String(r.user_id),
      name: String(r.name ?? ""),
      positionName: r.position_name != null ? String(r.position_name) : null,
      photoPath: r.photo_public_path != null ? String(r.photo_public_path) : null,
      memberRole: (String(r.member_role) as "owner" | "member") ?? "member",
    })),
  };
}

async function actorName(db: PgDatabase, userId: string): Promise<string> {
  const rows = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(e.name, u.name) AS name FROM users u
        LEFT JOIN employee_profiles e ON e.user_id = u.user_id WHERE u.user_id = $1`,
      [userId]
    )
  );
  return String(rows[0]?.name ?? "");
}

/** 그룹 방 이름 변경(MSG-P2) — system 메시지 기록. */
export async function renameRoom(roomId: number, userId: string, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new ChatAccessError("방 이름을 입력해 주세요.");
  if (trimmed.length > 60) throw new ChatAccessError("방 이름은 60자 이내로 입력해 주세요.");
  await withDbWrite(async (db) => {
    if (!(await memberRow(db, roomId, userId))) throw new ChatAccessError("대화방 멤버가 아닙니다.");
    const rows = rowsToObjects(
      await db.exec(`SELECT room_type FROM chat_rooms WHERE room_id = $1`, [roomId])
    );
    if (String(rows[0]?.room_type) !== "group") throw new ChatAccessError("그룹 대화만 이름을 바꿀 수 있습니다.");
    await db.run(`UPDATE chat_rooms SET name = $2 WHERE room_id = $1`, [roomId, trimmed]);
    await insertMessage(db, roomId, userId, "system", `${await actorName(db, userId)}님이 방 이름을 "${trimmed}"(으)로 바꿨습니다.`, null);
  });
}

/** 방 알림 끄기/켜기(내 설정만). */
export async function setRoomMuted(roomId: number, userId: string, muted: boolean): Promise<void> {
  const db = await getDb();
  if (!(await memberRow(db, roomId, userId))) throw new ChatAccessError("대화방 멤버가 아닙니다.");
  await db.run(
    `UPDATE chat_room_members SET notify_muted = $3 WHERE room_id = $1 AND user_id = $2`,
    [roomId, userId, muted]
  );
}

/** 그룹 초대(MSG-P2) — 나갔던 멤버는 복귀. system 메시지 기록. */
export async function inviteMembers(roomId: number, userId: string, targetUserIds: string[]): Promise<void> {
  const targets = [...new Set(targetUserIds.filter((t) => t && t !== userId))];
  if (!targets.length) throw new ChatAccessError("초대할 사람을 선택해 주세요.");
  await withDbWrite(async (db) => {
    if (!(await memberRow(db, roomId, userId))) throw new ChatAccessError("대화방 멤버가 아닙니다.");
    const rows = rowsToObjects(
      await db.exec(`SELECT room_type FROM chat_rooms WHERE room_id = $1`, [roomId])
    );
    if (String(rows[0]?.room_type) !== "group") throw new ChatAccessError("그룹 대화에서만 초대할 수 있습니다.");
    const valid = rowsToObjects(
      await db.exec(`SELECT user_id, name FROM users WHERE user_id = ANY($1) AND status = 'active'`, [targets])
    );
    if (!valid.length) throw new ChatAccessError("초대할 계정을 찾을 수 없습니다.");
    const now = nowIso();
    const added: string[] = [];
    for (const v of valid) {
      const uid = String(v.user_id);
      // 기존 멤버(활성)는 건너뛰고, 나갔던 멤버는 복귀, 신규는 insert.
      const existing = rowsToObjects(
        await db.exec(`SELECT left_at FROM chat_room_members WHERE room_id = $1 AND user_id = $2`, [roomId, uid])
      );
      if (existing.length && existing[0].left_at == null) continue;
      if (existing.length) {
        await db.run(`UPDATE chat_room_members SET left_at = NULL, joined_at = $3 WHERE room_id = $1 AND user_id = $2`, [roomId, uid, now]);
      } else {
        await db.run(
          `INSERT INTO chat_room_members (room_id, user_id, member_role, joined_at) VALUES ($1, $2, 'member', $3)`,
          [roomId, uid, now]
        );
      }
      added.push(String(v.name));
    }
    if (added.length) {
      await insertMessage(db, roomId, userId, "system", `${await actorName(db, userId)}님이 ${added.join(", ")}님을 초대했습니다.`, null);
    }
  });
}

/** 나가기 — left_at 마킹. 그룹은 system 메시지, DM 은 조용히(재개 시 복귀). */
export async function leaveRoom(roomId: number, userId: string): Promise<void> {
  await withDbWrite(async (db) => {
    if (!(await memberRow(db, roomId, userId))) throw new ChatAccessError("대화방 멤버가 아닙니다.");
    const rows = rowsToObjects(
      await db.exec(`SELECT room_type FROM chat_rooms WHERE room_id = $1`, [roomId])
    );
    if (String(rows[0]?.room_type) === "group") {
      await insertMessage(db, roomId, userId, "system", `${await actorName(db, userId)}님이 나갔습니다.`, null);
    }
    await db.run(`UPDATE chat_room_members SET left_at = $3 WHERE room_id = $1 AND user_id = $2`, [
      roomId,
      userId,
      nowIso(),
    ]);
  });
}

export interface ChatSearchHit {
  roomId: number;
  roomName: string;
  roomType: "dm" | "group";
  messageId: number;
  senderName: string;
  body: string;
  createdAt: string;
}

/** 메시지 본문 검색(MSG-P2) — 내가 속한 방 전체, 최신순. */
export async function searchMessages(userId: string, q: string, limit = 30): Promise<ChatSearchHit[]> {
  const kw = q.trim();
  if (kw.length < 2) return [];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT cm.message_id, cm.room_id, cm.body, cm.created_at, r.room_type, r.name AS room_name,
              COALESCE(e.name, u.name) AS sender_name
         FROM chat_messages cm
         JOIN chat_room_members me ON me.room_id = cm.room_id AND me.user_id = $1 AND me.left_at IS NULL
         JOIN chat_rooms r ON r.room_id = cm.room_id
         JOIN users u ON u.user_id = cm.sender_id
         LEFT JOIN employee_profiles e ON e.user_id = cm.sender_id
        WHERE cm.deleted_at IS NULL AND cm.kind <> 'system' AND cm.body ILIKE $2
        ORDER BY cm.message_id DESC
        LIMIT ${Math.min(Math.max(limit, 1), 50)}`,
      [userId, `%${kw}%`]
    )
  );
  if (!rows.length) return [];
  // DM 방 표시명 = 상대 이름(목록과 동일 규칙).
  const dmRoomIds = [...new Set(rows.filter((r) => String(r.room_type) === "dm").map((r) => Number(r.room_id)))];
  const peers = dmRoomIds.length
    ? rowsToObjects(
        await db.exec(
          `SELECT m.room_id, COALESCE(e.name, u.name) AS name
             FROM chat_room_members m
             JOIN users u ON u.user_id = m.user_id
             LEFT JOIN employee_profiles e ON e.user_id = m.user_id
            WHERE m.room_id = ANY($1) AND m.user_id <> $2`,
          [dmRoomIds, userId]
        )
      )
    : [];
  const peerName = new Map(peers.map((p) => [Number(p.room_id), String(p.name ?? "")]));
  return rows.map((r) => ({
    roomId: Number(r.room_id),
    roomType: String(r.room_type) as "dm" | "group",
    roomName:
      String(r.room_type) === "dm"
        ? peerName.get(Number(r.room_id)) ?? "(알 수 없음)"
        : String(r.room_name ?? "") || "그룹 대화",
    messageId: Number(r.message_id),
    senderName: String(r.sender_name ?? ""),
    body: String(r.body ?? "").replace(/\s+/g, " ").slice(0, 120),
    createdAt: String(r.created_at),
  }));
}

/** 첨부 다운로드용 조회 — 요청자가 해당 방 멤버일 때만 반환. */
export async function getChatAttachmentForUser(
  userId: string,
  attachmentId: number
): Promise<{ fileName: string; contentType: string | null; storageKey: string } | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT a.file_name, a.content_type, a.storage_key
         FROM chat_attachments a
         JOIN chat_messages cm ON cm.message_id = a.message_id
         JOIN chat_room_members m ON m.room_id = cm.room_id AND m.user_id = $1 AND m.left_at IS NULL
        WHERE a.attachment_id = $2 AND cm.deleted_at IS NULL`,
      [userId, attachmentId]
    )
  );
  if (!rows.length || rows[0].storage_key == null) return null;
  return {
    fileName: String(rows[0].file_name ?? "file"),
    contentType: rows[0].content_type != null ? String(rows[0].content_type) : null,
    storageKey: String(rows[0].storage_key),
  };
}

/** 푸시 발송에 필요한 방·발신자 표시 정보(MSG-P1). */
export async function pushInfoForMessage(
  roomId: number,
  senderId: string
): Promise<{ senderName: string; roomName: string | null; roomType: "dm" | "group" }> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT r.room_type, r.name AS room_name, COALESCE(e.name, u.name) AS sender_name
         FROM chat_rooms r, users u
         LEFT JOIN employee_profiles e ON e.user_id = u.user_id
        WHERE r.room_id = $1 AND u.user_id = $2`,
      [roomId, senderId]
    )
  );
  const r = rows[0] ?? {};
  return {
    senderName: String(r.sender_name ?? ""),
    roomName: r.room_name != null ? String(r.room_name) : null,
    roomType: (String(r.room_type ?? "dm") as "dm" | "group"),
  };
}

/** 방 멤버 user_id 목록(발신자 제외·음소거 제외) — 푸시 수신자 계산용(MSG-P1). */
export async function listPushTargets(roomId: number, exceptUserId: string): Promise<string[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT user_id FROM chat_room_members
        WHERE room_id = $1 AND user_id <> $2 AND left_at IS NULL AND notify_muted = false`,
      [roomId, exceptUserId]
    )
  );
  return rows.map((r) => String(r.user_id));
}
