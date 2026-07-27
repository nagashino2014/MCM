/**
 * 코넨사인 메일 — 카테고리 관리(G2-12).
 * 카테고리 = mail_folders 의 사용자 폴더(system_kind IS NULL)와 동일 엔티티 —
 * 생성/삭제가 보관함 하위 폴더와 자동 연동된다. 삭제 시 보관 메일 처리 모드(같이 삭제/다른 폴더로 이전)를 받는다.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { getMailboxByUser } from "@/lib/mail/mailbox";

export interface MailCategory {
  folderId: string;
  name: string;
  total: number; // 이 폴더에 보관된 메일 수
}

export async function listCategories(userId: string): Promise<MailCategory[]> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) return [];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT f.folder_id, f.name, COUNT(s.message_id) FILTER (WHERE s.is_deleted = 0)::int AS total
         FROM mail_folders f LEFT JOIN mail_message_state s ON s.folder_id = f.folder_id
        WHERE f.mailbox_id = $1 AND f.system_kind IS NULL
        GROUP BY f.folder_id, f.name ORDER BY f.name`,
      [mailbox.mailboxId]
    )
  );
  return rows.map((r) => ({ folderId: String(r.folder_id), name: String(r.name), total: Number(r.total ?? 0) }));
}

export async function createCategory(userId: string, name: string): Promise<string> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) throw new Error("메일함이 없습니다.");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("카테고리 이름을 입력하세요.");
  const folderId = "mfd-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO mail_folders (folder_id, mailbox_id, name, system_kind, sort, created_at)
       VALUES ($1,$2,$3,NULL,100,$4)
       ON CONFLICT (mailbox_id, name) WHERE system_kind IS NULL DO NOTHING`,
      [folderId, mailbox.mailboxId, trimmed, new Date().toISOString()]
    );
  });
  return folderId;
}

/**
 * 카테고리 삭제 — 보관 메일 처리:
 * - mode="delete": 폴더 내 메일 state 를 함께 삭제(메일 자체는 mail_messages 에 남지만 어느 폴더에도 없음 → 휴지통 이동으로 정리)
 * - mode="move": targetFolderId(다른 카테고리 or 시스템 archive)로 이전
 * 받은편지함 라벨(category_id)은 FK ON DELETE SET NULL 로 자동 해제된다.
 */
export async function deleteCategory(
  userId: string,
  folderId: string,
  mode: "delete" | "move",
  targetFolderId?: string
): Promise<void> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) return;
  const db = await getDb();
  // 소유·사용자 폴더 검증.
  const own = rowsToObjects(
    await db.exec(`SELECT 1 FROM mail_folders WHERE folder_id = $1 AND mailbox_id = $2 AND system_kind IS NULL`, [
      folderId,
      mailbox.mailboxId,
    ])
  );
  if (!own.length) throw new Error("카테고리를 찾을 수 없습니다.");

  await withDbWrite(async (wdb) => {
    if (mode === "move") {
      // 대상 폴더 검증(내 메일함 폴더).
      const dest = rowsToObjects(
        await wdb.exec(`SELECT folder_id FROM mail_folders WHERE folder_id = $1 AND mailbox_id = $2`, [
          targetFolderId ?? "",
          mailbox.mailboxId,
        ])
      );
      if (!dest.length) throw new Error("이전할 폴더를 선택하세요.");
      // 이전 대상 폴더에 이미 있는 메일과 충돌하면(중복 PK) 기존 것을 우선.
      await wdb.run(
        `UPDATE mail_message_state s SET folder_id = $2
          WHERE s.folder_id = $1
            AND NOT EXISTS (SELECT 1 FROM mail_message_state x WHERE x.message_id = s.message_id AND x.folder_id = $2)`,
        [folderId, targetFolderId]
      );
      await wdb.run(`DELETE FROM mail_message_state WHERE folder_id = $1`, [folderId]);
    } else {
      // 같이 삭제: 이 폴더에 보관된 메일을 휴지통으로 이동(완전 유실 방지 — 휴지통에서 영구삭제 가능).
      const trash = rowsToObjects(
        await wdb.exec(`SELECT folder_id FROM mail_folders WHERE mailbox_id = $1 AND system_kind = 'trash'`, [mailbox.mailboxId])
      );
      const trashId = trash.length ? String(trash[0].folder_id) : null;
      if (trashId) {
        await wdb.run(
          `UPDATE mail_message_state s SET folder_id = $2
            WHERE s.folder_id = $1
              AND NOT EXISTS (SELECT 1 FROM mail_message_state x WHERE x.message_id = s.message_id AND x.folder_id = $2)`,
          [folderId, trashId]
        );
      }
      await wdb.run(`DELETE FROM mail_message_state WHERE folder_id = $1`, [folderId]);
    }
    await wdb.run(`DELETE FROM mail_folders WHERE folder_id = $1`, [folderId]);
  });
}
