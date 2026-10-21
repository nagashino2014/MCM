/**
 * 외부 메일 프로그램 게이트웨이 — 저장소 구현(DB mail_* + S3).
 * - 인증: 앱 비밀번호(306 mail_app_passwords, bcrypt) + 실패 잠금(login_attempts, 키 = "mailgw:<주소>")
 *   + 접속기록(access_log, target_kind = mail_client). 계정 비활성(퇴사)·메일함 정지·기능 끔이면 거절.
 * - UID: mail_message_state.imap_uid(306 트리거가 폴더별로 부여). 플래그 \Seen·\Flagged 는 웹과 같은
 *   is_read·is_starred, 나머지(\Answered·\Deleted·\Draft·키워드)는 imap_flags.
 * - 원문 확정: 처음 FETCH 할 때 원문(수신 버킷·가져오기 원문, 없으면 DB 로 재구성)을 app_data 버킷에 고정하고
 *   크기·헤더·구조를 mail_messages.imap_* 에 남긴다. 이후 같은 UID 는 항상 같은 바이트를 내려준다.
 */
import crypto from "node:crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { clearLoginFailures, isLoginBlocked, recordLoginFailure } from "@/lib/auth/login-throttle";
import { recordAccessLog } from "@/lib/auth/access-log";
import { getExternalClientConfig, normalizeAppPassword } from "@/lib/mail/app-passwords";
import { ensureSystemFolders, MAIL_DOMAIN } from "@/lib/mail/mailbox";
import { createCategory, deleteCategory } from "@/lib/mail/categories";
import { importRawMessage, ImportItemError } from "@/lib/mail/import/store";
import { buildMimeMessage, htmlToPlainText, type MimeAttachment } from "@/lib/mail/mime";
import { putContractDocument, readContractDocument } from "@/lib/storage/contract-document-storage";
import { getS3Client } from "@/lib/storage/logo-storage";
import { describeStructure, parseMime, type StructNode } from "@/lib/mail/gateway/mime-tree";
import {
  GwUserError,
  type FlagMode,
  type GwAuthResult,
  type GwEntry,
  type GwFolder,
  type GwMeta,
  type GwProto,
  type GwSearchInfo,
  type GwSnapshot,
  type GwStore,
  type GwUser,
} from "@/lib/mail/gateway/types";

const AUTH_CACHE_MS = 10 * 60_000;
const ACCESS_LOG_EVERY_MS = 30 * 60_000;
const LAST_USED_EVERY_MS = 5 * 60_000;
const RAW_CACHE_BYTES = 64 * 1024 * 1024;
const RAW_CACHE_MAX_ITEM = 16 * 1024 * 1024;
const MATERIALIZE_CONCURRENCY = 6;

function epochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** 플래그 목록 → (is_read, is_starred, 나머지). */
function splitFlags(flags: string[]): { isRead: number; isStarred: number; rest: string[] } {
  const rest: string[] = [];
  for (const f of flags) {
    if (f === "\\Seen" || f === "\\Flagged" || f === "\\Recent") continue;
    if (!rest.some((x) => x.toLowerCase() === f.toLowerCase())) rest.push(f);
  }
  return { isRead: flags.includes("\\Seen") ? 1 : 0, isStarred: flags.includes("\\Flagged") ? 1 : 0, rest };
}

function jsonArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function deriveFlags(r: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (Number(r.is_read ?? 0) === 1) out.push("\\Seen");
  if (Number(r.is_starred ?? 0) === 1) out.push("\\Flagged");
  for (const f of jsonArray(r.imap_flags)) if (!out.includes(f)) out.push(f);
  return out;
}

function addrText(v: unknown): string {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? (() => {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  })() : [];
  return (arr as { name?: string; address?: string }[]).map((a) => `${a.name ?? ""} ${a.address ?? ""}`.trim()).join(", ");
}

function likeEscape(s: string): string {
  return "%" + s.replace(/[\\%_]/g, (m) => "\\" + m) + "%";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** 최근 원문 캐시(프로세스 공용, 바이트 상한). */
class RawCache {
  private map = new Map<string, Buffer>();
  private bytes = 0;
  get(k: string): Buffer | undefined {
    const v = this.map.get(k);
    if (v) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: Buffer): void {
    if (v.length > RAW_CACHE_MAX_ITEM) return;
    const old = this.map.get(k);
    if (old) {
      this.bytes -= old.length;
      this.map.delete(k);
    }
    this.map.set(k, v);
    this.bytes += v.length;
    for (const [key, val] of this.map) {
      if (this.bytes <= RAW_CACHE_BYTES) break;
      this.map.delete(key);
      this.bytes -= val.length;
    }
  }
}

export class PgGatewayStore implements GwStore {
  private authCache = new Map<string, { appPasswordId: string; expires: number }>();
  private accessLogged = new Map<string, number>();
  private lastUsedWritten = new Map<string, number>();
  private raw = new RawCache();
  private inflight = new Map<string, Promise<GwMeta & { raw?: Buffer }>>();

  // ── 인증 ──────────────────────────────────────────────────────────

  async authenticate(username: string, password: string, ip: string, proto: GwProto): Promise<GwAuthResult> {
    const cfg = await getExternalClientConfig();
    if (!cfg.enabled) return { ok: false, reason: "disabled" };
    const uname = String(username ?? "").trim().toLowerCase();
    const throttleKey = `mailgw:${uname}`;
    if (!uname.includes("@") || uname.length > 254) return { ok: false, reason: "invalid" };
    if (await isLoginBlocked(throttleKey, ip)) return { ok: false, reason: "blocked" };

    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT mb.mailbox_id, mb.user_id, mb.address, mb.display_name
           FROM mailboxes mb JOIN users u ON u.user_id = mb.user_id
          WHERE mb.mailbox_id = (
                  SELECT mailbox_id FROM mailbox_addresses WHERE address = $1
                  UNION SELECT mailbox_id FROM mailboxes WHERE lower(address) = $1 LIMIT 1)
            AND mb.status = 'active' AND u.status = 'active'`,
        [uname]
      )
    );
    const pw = normalizeAppPassword(password);
    let appPasswordId: string | null = null;
    if (rows.length && pw.length >= 12) {
      const mailboxId = String(rows[0].mailbox_id);
      const cacheKey = crypto.createHash("sha256").update(`${mailboxId}\0${pw}`).digest("hex");
      const cached = this.authCache.get(cacheKey);
      const live = rowsToObjects(
        await db.exec(
          `SELECT app_password_id, password_hash FROM mail_app_passwords
            WHERE mailbox_id = $1 AND revoked_at IS NULL ORDER BY created_at`,
          [mailboxId]
        )
      );
      if (cached && cached.expires > Date.now() && live.some((r) => String(r.app_password_id) === cached.appPasswordId)) {
        appPasswordId = cached.appPasswordId;
      } else {
        for (const r of live) {
          if (await verifyPassword(pw, String(r.password_hash))) {
            appPasswordId = String(r.app_password_id);
            this.authCache.set(cacheKey, { appPasswordId, expires: Date.now() + AUTH_CACHE_MS });
            await clearLoginFailures(throttleKey);
            break;
          }
        }
      }
    }
    if (!appPasswordId) {
      await recordLoginFailure(throttleKey, ip);
      return { ok: false, reason: "invalid" };
    }

    const r = rows[0];
    const user: GwUser = {
      userId: String(r.user_id),
      mailboxId: String(r.mailbox_id),
      address: String(r.address).toLowerCase(),
      displayName: r.display_name != null ? String(r.display_name) : String(r.address),
      sendAddresses: await this.sendAddresses(String(r.mailbox_id), String(r.address).toLowerCase()),
      appPasswordId,
    };
    await this.noteUse(user, ip, proto);
    return { ok: true, user };
  }

  /** 발신 가능한 내 주소 — 원장 주소 중 발신이 켜진 도메인(앱 기본 도메인은 도메인 행이 없어도 허용). */
  private async sendAddresses(mailboxId: string, primary: string): Promise<string[]> {
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT lower(a.address) AS address, md.send_enabled
           FROM (SELECT address, domain FROM mailbox_addresses WHERE mailbox_id = $1
                 UNION SELECT lower(address), split_part(lower(address), '@', 2) FROM mailboxes WHERE mailbox_id = $1) a
           LEFT JOIN mail_domains md ON md.domain = a.domain`,
        [mailboxId]
      )
    );
    const out = rows
      .filter((x) => (x.send_enabled == null ? String(x.address).endsWith("@" + MAIL_DOMAIN) : Number(x.send_enabled) === 1))
      .map((x) => String(x.address));
    if (!out.length) out.push(primary);
    return [...new Set(out)];
  }

  private async noteUse(user: GwUser, ip: string, proto: GwProto): Promise<void> {
    const now = Date.now();
    const useKey = `${user.appPasswordId}`;
    if ((this.lastUsedWritten.get(useKey) ?? 0) + LAST_USED_EVERY_MS < now) {
      this.lastUsedWritten.set(useKey, now);
      await withDbWrite(async (db) => {
        await db.run(
          `UPDATE mail_app_passwords SET last_used_at = $2, last_used_ip = $3, last_used_proto = $4 WHERE app_password_id = $1`,
          [user.appPasswordId, new Date(now).toISOString(), ip, proto]
        );
      }).catch((err) => console.warn("[mail-gw] last_used 기록 실패:", (err as Error).message));
    }
    // 아웃룩은 연결을 자주 다시 맺는다 — 같은 비밀번호·IP·프로토콜은 30분에 한 번만 접속기록을 남긴다.
    const logKey = `${user.appPasswordId}|${ip}|${proto}`;
    if ((this.accessLogged.get(logKey) ?? 0) + ACCESS_LOG_EVERY_MS < now) {
      this.accessLogged.set(logKey, now);
      await recordAccessLog({
        actorUserId: user.userId,
        action: "login",
        targetKind: "mail_client",
        targetId: user.appPasswordId,
        detail: { proto, ip, address: user.address },
      });
    }
  }

  async stillValid(user: GwUser): Promise<boolean> {
    const cfg = await getExternalClientConfig();
    if (!cfg.enabled) return false;
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT 1 FROM mail_app_passwords ap
           JOIN mailboxes mb ON mb.mailbox_id = ap.mailbox_id AND mb.status = 'active'
           JOIN users u ON u.user_id = mb.user_id AND u.status = 'active'
          WHERE ap.app_password_id = $1 AND ap.revoked_at IS NULL`,
        [user.appPasswordId]
      )
    );
    return rows.length > 0;
  }

  // ── 폴더 ──────────────────────────────────────────────────────────

  async listFolders(user: GwUser): Promise<GwFolder[]> {
    const db = await getDb();
    const sel = async () =>
      rowsToObjects(
        await db.exec(
          `SELECT folder_id, name, system_kind, imap_uidvalidity, imap_uidnext
             FROM mail_folders WHERE mailbox_id = $1 ORDER BY sort, name`,
          [user.mailboxId]
        )
      );
    let rows = await sel();
    if (!rows.some((r) => r.system_kind === "inbox")) {
      await ensureSystemFolders(user.mailboxId);
      rows = await sel();
    }
    if (rows.some((r) => r.imap_uidvalidity == null)) {
      // 306 이후 만든 빈 폴더 — 첫 배치 전에도 UIDVALIDITY 가 있어야 한다.
      await withDbWrite(async (wdb) => {
        await wdb.run(
          `UPDATE mail_folders SET imap_uidvalidity = $2 WHERE mailbox_id = $1 AND imap_uidvalidity IS NULL`,
          [user.mailboxId, epochSeconds()]
        );
      });
      rows = await sel();
    }
    return rows.map((r) => ({
      folderId: String(r.folder_id),
      name: r.system_kind === "inbox" ? "INBOX" : String(r.name),
      systemKind: r.system_kind != null ? String(r.system_kind) : null,
      uidValidity: Number(r.imap_uidvalidity),
      uidNext: Number(r.imap_uidnext ?? 1),
    }));
  }

  private async ownFolder(user: GwUser, folderId: string): Promise<GwFolder> {
    const f = (await this.listFolders(user)).find((x) => x.folderId === folderId);
    if (!f) throw new GwUserError("Mailbox does not exist");
    return f;
  }

  async snapshot(user: GwUser, folderId: string): Promise<GwSnapshot> {
    const folder = await this.ownFolder(user, folderId);
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT imap_uid, message_id, is_read, is_starred, imap_flags
           FROM mail_message_state
          WHERE folder_id = $1 AND mailbox_id = $2 AND is_deleted = 0 AND imap_uid IS NOT NULL
          ORDER BY imap_uid`,
        [folderId, user.mailboxId]
      )
    );
    const entries: GwEntry[] = rows.map((r) => ({ uid: Number(r.imap_uid), messageId: String(r.message_id), flags: deriveFlags(r) }));
    return { folder, entries };
  }

  async createFolder(user: GwUser, name: string): Promise<void> {
    if (!name.trim() || name.length > 100) throw new GwUserError("Invalid mailbox name");
    await createCategory(user.userId, name);
  }

  async renameFolder(user: GwUser, folderId: string, newName: string): Promise<void> {
    const name = newName.trim();
    if (!name || name.length > 100) throw new GwUserError("Invalid mailbox name");
    await withDbWrite(async (db) => {
      await db.run(`UPDATE mail_folders SET name = $3 WHERE folder_id = $1 AND mailbox_id = $2 AND system_kind IS NULL`, [
        folderId,
        user.mailboxId,
        name,
      ]);
    });
  }

  async deleteFolder(user: GwUser, folderId: string): Promise<void> {
    // 웹의 분류 삭제와 같다 — 안의 메일은 휴지통으로 옮긴다.
    await deleteCategory(user.userId, folderId, "delete");
  }

  // ── 플래그·복사·이동·삭제 ─────────────────────────────────────────

  async setFlags(user: GwUser, folderId: string, uids: number[], mode: FlagMode, flags: string[]): Promise<Map<number, string[]>> {
    const out = new Map<number, string[]>();
    if (!uids.length) return out;
    await withDbWrite(async (db) => {
      const rows = rowsToObjects(
        await db.exec(
          `SELECT imap_uid, message_id, is_read, is_starred, imap_flags FROM mail_message_state
            WHERE folder_id = $1 AND mailbox_id = $2 AND imap_uid = ANY($3::bigint[]) FOR UPDATE`,
          [folderId, user.mailboxId, uids]
        )
      );
      for (const r of rows) {
        const cur = deriveFlags(r);
        let next: string[];
        if (mode === "set") next = [...flags];
        else if (mode === "add") next = [...cur, ...flags.filter((f) => !cur.some((c) => c.toLowerCase() === f.toLowerCase()))];
        else next = cur.filter((c) => !flags.some((f) => f.toLowerCase() === c.toLowerCase()));
        const s = splitFlags(next);
        await db.run(
          `UPDATE mail_message_state SET is_read = $3, is_starred = $4, imap_flags = $5::jsonb WHERE message_id = $1 AND folder_id = $2`,
          [String(r.message_id), folderId, s.isRead, s.isStarred, JSON.stringify(s.rest)]
        );
        out.set(Number(r.imap_uid), deriveFlags({ is_read: s.isRead, is_starred: s.isStarred, imap_flags: s.rest }));
      }
    });
    return out;
  }

  private async transfer(user: GwUser, srcFolderId: string, uids: number[], destFolderId: string, move: boolean): Promise<[number, number][]> {
    const dest = await this.ownFolder(user, destFolderId);
    await this.ownFolder(user, srcFolderId);
    const pairs: [number, number][] = [];
    if (!uids.length) return pairs;
    await withDbWrite(async (db) => {
      const rows = rowsToObjects(
        await db.exec(
          `SELECT imap_uid, message_id, is_read, is_starred, imap_flags, category_id, labels FROM mail_message_state
            WHERE folder_id = $1 AND mailbox_id = $2 AND imap_uid = ANY($3::bigint[]) ORDER BY imap_uid FOR UPDATE`,
          [srcFolderId, user.mailboxId, uids]
        )
      );
      const now = new Date().toISOString();
      for (const r of rows) {
        const messageId = String(r.message_id);
        // 분류 폴더(사용자 폴더)로 옮기면 웹의 [보관]처럼 분류 라벨도 맞춘다.
        const categoryId = dest.systemKind == null ? dest.folderId : r.category_id != null ? String(r.category_id) : null;
        const existing = rowsToObjects(
          await db.exec(`SELECT imap_uid FROM mail_message_state WHERE message_id = $1 AND folder_id = $2`, [messageId, destFolderId])
        );
        let destUid: number;
        if (existing.length) {
          destUid = Number(existing[0].imap_uid);
          if (move) await db.run(`DELETE FROM mail_message_state WHERE message_id = $1 AND folder_id = $2`, [messageId, srcFolderId]);
        } else if (move) {
          const upd = rowsToObjects(
            await db.exec(
              `UPDATE mail_message_state SET folder_id = $3, category_id = $4
                WHERE message_id = $1 AND folder_id = $2 RETURNING imap_uid`,
              [messageId, srcFolderId, destFolderId, categoryId]
            )
          );
          destUid = Number(upd[0].imap_uid);
        } else {
          const ins = rowsToObjects(
            await db.exec(
              `INSERT INTO mail_message_state
                 (message_id, folder_id, mailbox_id, is_read, is_starred, imap_flags, category_id, labels, created_at)
               VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)
               RETURNING imap_uid`,
              [
                messageId,
                destFolderId,
                user.mailboxId,
                Number(r.is_read ?? 0),
                Number(r.is_starred ?? 0),
                JSON.stringify(jsonArray(r.imap_flags).filter((f) => f !== "\\Deleted")),
                categoryId,
                JSON.stringify(jsonArray(r.labels)),
                now,
              ]
            )
          );
          destUid = Number(ins[0].imap_uid);
        }
        pairs.push([Number(r.imap_uid), destUid]);
      }
    });
    return pairs;
  }

  copy(user: GwUser, srcFolderId: string, uids: number[], destFolderId: string): Promise<[number, number][]> {
    return this.transfer(user, srcFolderId, uids, destFolderId, false);
  }

  move(user: GwUser, srcFolderId: string, uids: number[], destFolderId: string): Promise<[number, number][]> {
    return this.transfer(user, srcFolderId, uids, destFolderId, true);
  }

  async expunge(user: GwUser, folderId: string, uids?: number[]): Promise<number[]> {
    await this.ownFolder(user, folderId);
    const gone: number[] = [];
    await withDbWrite(async (db) => {
      const rows = rowsToObjects(
        await db.exec(
          `DELETE FROM mail_message_state
            WHERE folder_id = $1 AND mailbox_id = $2 AND imap_flags @> $3::jsonb
              AND ($4::bigint[] IS NULL OR imap_uid = ANY($4::bigint[]))
          RETURNING imap_uid, message_id`,
          [folderId, user.mailboxId, JSON.stringify(["\\Deleted"]), uids ?? null]
        )
      );
      for (const r of rows) gone.push(Number(r.imap_uid));
      const ids = rows.map((r) => String(r.message_id));
      if (ids.length) {
        // 어느 폴더에도 남지 않은 메일은 웹의 [영구 삭제]처럼 지운다(첨부 메타 CASCADE, S3 는 보존 정책).
        await db.run(
          `DELETE FROM mail_messages m
            WHERE m.mailbox_id = $2 AND m.message_id = ANY($1::text[])
              AND NOT EXISTS (SELECT 1 FROM mail_message_state s WHERE s.message_id = m.message_id)`,
          [ids, user.mailboxId]
        );
      }
    });
    return gone;
  }

  async append(user: GwUser, folderId: string, raw: Buffer, flags: string[], date: Date | null): Promise<{ uid: number; uidValidity: number }> {
    const folder = await this.ownFolder(user, folderId);
    const direction = folder.systemKind === "sent" || folder.systemKind === "drafts" ? "out" : "in";
    let messageId: string;
    try {
      const res = await importRawMessage(
        raw,
        { mailboxId: user.mailboxId, folderId, direction, isRead: flags.includes("\\Seen"), labels: [], rawKeyPrefix: "mail-client" },
        date ?? undefined
      );
      messageId = res.messageId;
    } catch (err) {
      if (err instanceof ImportItemError) throw new GwUserError("Message could not be parsed");
      throw err;
    }
    const s = splitFlags(flags);
    let uid = 0;
    await withDbWrite(async (db) => {
      const rows = rowsToObjects(
        await db.exec(
          `UPDATE mail_message_state SET is_read = $3, is_starred = $4, imap_flags = $5::jsonb
            WHERE message_id = $1 AND folder_id = $2 RETURNING imap_uid`,
          [messageId, folderId, s.isRead, s.isStarred, JSON.stringify(s.rest)]
        )
      );
      uid = rows.length ? Number(rows[0].imap_uid) : 0;
    });
    if (!uid) throw new GwUserError("Message could not be stored");
    const fresh = await this.ownFolder(user, folderId);
    return { uid, uidValidity: fresh.uidValidity };
  }

  // ── 검색 ──────────────────────────────────────────────────────────

  async searchInfo(user: GwUser, folderId: string): Promise<Map<number, GwSearchInfo>> {
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT s.imap_uid, m.created_at, m.sent_at, m.received_at, m.subject, m.from_addr,
                m.to_addrs, m.cc_addrs, m.bcc_addrs, m.rfc_message_id,
                COALESCE(m.imap_raw_size, m.size_bytes,
                         octet_length(COALESCE(m.body_text, '')) + octet_length(COALESCE(m.body_html, '')))::bigint AS size
           FROM mail_message_state s JOIN mail_messages m ON m.message_id = s.message_id
          WHERE s.folder_id = $1 AND s.mailbox_id = $2 AND s.is_deleted = 0 AND s.imap_uid IS NOT NULL`,
        [folderId, user.mailboxId]
      )
    );
    const out = new Map<number, GwSearchInfo>();
    for (const r of rows) {
      const sent = r.sent_at ?? r.received_at;
      out.set(Number(r.imap_uid), {
        internalDate: new Date(String(r.created_at)),
        sentDate: sent != null ? new Date(String(sent)) : null,
        size: Number(r.size ?? 0),
        subject: r.subject != null ? String(r.subject) : "",
        from: r.from_addr != null ? String(r.from_addr) : "",
        to: addrText(r.to_addrs),
        cc: addrText(r.cc_addrs),
        bcc: addrText(r.bcc_addrs),
        messageId: r.rfc_message_id != null ? String(r.rfc_message_id) : "",
      });
    }
    return out;
  }

  async bodySearch(user: GwUser, folderId: string, term: string, withHeaders: boolean): Promise<Set<number>> {
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT s.imap_uid FROM mail_message_state s JOIN mail_messages m ON m.message_id = s.message_id
          WHERE s.folder_id = $1 AND s.mailbox_id = $2 AND s.imap_uid IS NOT NULL
            AND (m.body_text ILIKE $3 OR m.body_html ILIKE $3
                 OR ($4 AND (m.subject ILIKE $3 OR m.from_addr ILIKE $3 OR m.to_addrs::text ILIKE $3 OR m.cc_addrs::text ILIKE $3)))`,
        [folderId, user.mailboxId, likeEscape(term), withHeaders]
      )
    );
    return new Set(rows.map((r) => Number(r.imap_uid)));
  }

  // ── 원문 ──────────────────────────────────────────────────────────

  async loadMeta(user: GwUser, messageIds: string[]): Promise<Map<string, GwMeta>> {
    const out = new Map<string, GwMeta>();
    if (!messageIds.length) return out;
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT message_id, created_at, imap_raw_key, imap_raw_size, imap_header, imap_structure
           FROM mail_messages WHERE mailbox_id = $1 AND message_id = ANY($2::text[])`,
        [user.mailboxId, messageIds]
      )
    );
    const missing: string[] = [];
    for (const r of rows) {
      if (r.imap_raw_key != null && r.imap_header != null && r.imap_structure != null) {
        out.set(String(r.message_id), {
          internalDate: new Date(String(r.created_at)),
          size: Number(r.imap_raw_size),
          header: Buffer.from(r.imap_header as Buffer),
          structure: r.imap_structure as StructNode,
        });
      } else {
        missing.push(String(r.message_id));
      }
    }
    await pool(missing, MATERIALIZE_CONCURRENCY, async (id) => {
      try {
        const m = await this.materialize(user, id);
        out.set(id, m);
      } catch (err) {
        console.error("[mail-gw] 원문 확정 실패:", id, (err as Error).message);
      }
    });
    return out;
  }

  async loadRaw(user: GwUser, messageId: string): Promise<Buffer> {
    const hit = this.raw.get(messageId);
    if (hit) return hit;
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(`SELECT imap_raw_key FROM mail_messages WHERE message_id = $1 AND mailbox_id = $2`, [messageId, user.mailboxId])
    );
    if (!rows.length) throw new GwUserError("Message no longer exists");
    if (rows[0].imap_raw_key == null) {
      const m = await this.materialize(user, messageId);
      if (m.raw) return m.raw;
      return this.loadRaw(user, messageId);
    }
    const buf = await readContractDocument(String(rows[0].imap_raw_key));
    if (!buf) throw new GwUserError("Message content is unavailable");
    this.raw.set(messageId, buf);
    return buf;
  }

  /** 같은 메일을 여러 연결이 동시에 확정하지 않도록 프로세스 안에서 한 번만 돈다. */
  private materialize(user: GwUser, messageId: string): Promise<GwMeta & { raw?: Buffer }> {
    const running = this.inflight.get(messageId);
    if (running) return running;
    const p = this.doMaterialize(user, messageId).finally(() => this.inflight.delete(messageId));
    this.inflight.set(messageId, p);
    return p;
  }

  private async doMaterialize(user: GwUser, messageId: string): Promise<GwMeta & { raw?: Buffer }> {
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT message_id, direction, rfc_message_id, in_reply_to, references_json, from_addr, to_addrs, cc_addrs,
                subject, body_text, body_html, raw_s3_key, sent_at, received_at, created_at
           FROM mail_messages WHERE message_id = $1 AND mailbox_id = $2`,
        [messageId, user.mailboxId]
      )
    );
    if (!rows.length) throw new GwUserError("Message no longer exists");
    const r = rows[0];
    let raw: Buffer | null = null;
    let reuseKey: string | null = null;
    const rawKey = r.raw_s3_key != null ? String(r.raw_s3_key) : null;
    if (rawKey) {
      if (rawKey.startsWith("inbound/")) {
        raw = await this.readInbound(rawKey);
      } else {
        raw = await readContractDocument(rawKey);
        if (raw) reuseKey = rawKey;
      }
    }
    if (!raw) raw = await this.rebuild(user, r);

    const tree = parseMime(raw);
    const header = raw.subarray(0, tree.headerEnd);
    const structure = describeStructure(raw, tree);
    let key = reuseKey;
    if (!key) {
      const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
      key = ["mail-imap", user.mailboxId, `${messageId}-${hash}.eml`].join("/");
      await putContractDocument(key, raw, "message/rfc822");
    }
    let won = false;
    await withDbWrite(async (wdb) => {
      const upd = rowsToObjects(
        await wdb.exec(
          `UPDATE mail_messages SET imap_raw_key = $2, imap_raw_size = $3, imap_header = $4, imap_structure = $5::jsonb
            WHERE message_id = $1 AND imap_raw_key IS NULL RETURNING message_id`,
          [messageId, key, raw!.length, Buffer.from(header), JSON.stringify(structure)]
        )
      );
      won = upd.length > 0;
    });
    const internalDate = new Date(String(r.created_at));
    if (won) {
      this.raw.set(messageId, raw);
      return { internalDate, size: raw.length, header: Buffer.from(header), structure, raw };
    }
    // 다른 프로세스가 먼저 확정했다 — 그쪽 값을 쓴다(같은 UID 는 같은 바이트).
    const again = rowsToObjects(
      await db.exec(`SELECT imap_raw_size, imap_header, imap_structure FROM mail_messages WHERE message_id = $1`, [messageId])
    );
    if (!again.length) throw new GwUserError("Message no longer exists");
    return {
      internalDate,
      size: Number(again[0].imap_raw_size),
      header: Buffer.from(again[0].imap_header as Buffer),
      structure: again[0].imap_structure as StructNode,
    };
  }

  private async readInbound(key: string): Promise<Buffer | null> {
    const bucket = process.env.MAIL_INBOUND_BUCKET?.trim();
    if (!bucket) return null;
    try {
      const out = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const bytes = await out.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : null;
    } catch {
      // 수신 원문은 90일 뒤 수명주기로 지워진다 — DB 로 재구성한다.
      return null;
    }
  }

  /** 원문이 없는 메일(웹 발송 사본·보존기간 지난 수신)을 DB 내용으로 MIME 재구성. */
  private async rebuild(user: GwUser, r: Record<string, unknown>): Promise<Buffer> {
    const db = await getDb();
    const atts = rowsToObjects(
      await db.exec(
        `SELECT filename, content_type, s3_key, content_id FROM mail_attachments WHERE message_id = $1 ORDER BY created_at, attachment_id`,
        [String(r.message_id)]
      )
    );
    const attachments: MimeAttachment[] = [];
    for (const a of atts) {
      const content = await readContractDocument(String(a.s3_key));
      if (!content) continue;
      attachments.push({
        filename: String(a.filename),
        contentType: a.content_type != null ? String(a.content_type) : "application/octet-stream",
        content,
        contentId: a.content_id != null ? String(a.content_id) : undefined,
      });
    }
    const parseList = (v: unknown) => {
      const arr = Array.isArray(v) ? v : typeof v === "string" ? (JSON.parse(v || "[]") as unknown[]) : [];
      return (arr as { name?: string; address?: string }[]).filter((x) => x && x.address).map((x) => ({ name: x.name, address: String(x.address) }));
    };
    const fromAddr = r.from_addr != null ? String(r.from_addr) : user.address;
    const html = r.body_html != null ? String(r.body_html) : `<pre>${escapeHtml(r.body_text != null ? String(r.body_text) : "")}</pre>`;
    const text = r.body_text != null ? String(r.body_text) : htmlToPlainText(html);
    const when = r.sent_at ?? r.received_at ?? r.created_at;
    return buildMimeMessage({
      from: { name: String(r.direction) === "out" && fromAddr.toLowerCase() === user.address ? user.displayName : undefined, address: fromAddr },
      to: parseList(r.to_addrs),
      cc: parseList(r.cc_addrs),
      subject: r.subject != null ? String(r.subject) : "",
      text,
      html,
      attachments,
      messageId: r.rfc_message_id != null ? String(r.rfc_message_id) : `<${String(r.message_id)}@${MAIL_DOMAIN}>`,
      inReplyTo: r.in_reply_to != null ? String(r.in_reply_to) : null,
      references: jsonArray(r.references_json),
      date: when != null ? new Date(String(when)) : new Date(),
    });
  }
}
