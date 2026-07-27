/**
 * 코넨사인 메일 — 메일함(mailbox) 조회·보장 + 시스템 폴더 시드.
 * 주소 = {local_part}@{MAIL_DOMAIN}. local_part 는 042 의 users.email_local(기존 개인메일 앞자리 승계)
 * 을 기본값으로 채운다(P5 에서 검수). P1 은 발송 시점에 lazy 로 mailbox 를 보장한다(별도 프로비저닝 없이 파일럿 가능).
 * 설계: docs/company-email-blueprint.md §3, §4.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

export const MAIL_DOMAIN = (process.env.MAIL_DOMAIN ?? "koensain.app").trim().toLowerCase();

export interface Mailbox {
  mailboxId: string;
  userId: string | null;
  address: string;
  localPart: string;
  displayName: string;
  signatureHtml: string | null;
  status: string;
}

/** 시스템 폴더 정의(순서 = 사이드바 정렬). */
const SYSTEM_FOLDERS: { kind: string; name: string; sort: number }[] = [
  { kind: "inbox", name: "받은편지함", sort: 10 },
  { kind: "sent", name: "보낸편지함", sort: 20 },
  { kind: "drafts", name: "임시보관함", sort: 30 },
  { kind: "archive", name: "보관함", sort: 40 },
  { kind: "spam", name: "스팸함", sort: 50 },
  { kind: "trash", name: "휴지통", sort: 60 },
];

function newId(prefix: string): string {
  return prefix + "-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
}

/** 로컬파트 정규화 — 소문자·허용문자[a-z0-9._-]·선후행 점 제거. */
export function normalizeLocalPart(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[.]+|[.]+$/g, "");
}

function toMailbox(r: Record<string, unknown>): Mailbox {
  return {
    mailboxId: String(r.mailbox_id),
    userId: r.user_id != null ? String(r.user_id) : null,
    address: String(r.address),
    localPart: String(r.local_part),
    displayName: r.display_name != null ? String(r.display_name) : String(r.address),
    signatureHtml: r.signature_html != null ? String(r.signature_html) : null,
    status: String(r.status ?? "active"),
  };
}

/** user_id 로 mailbox 조회(없으면 null). */
export async function getMailboxByUser(userId: string): Promise<Mailbox | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT * FROM mailboxes WHERE user_id = $1 LIMIT 1`, [userId]));
  return rows.length ? toMailbox(rows[0]) : null;
}

/** 메일함의 시스템 폴더를 보장(멱등). system_kind UNIQUE 로 중복 생성 안 됨. */
export async function ensureSystemFolders(mailboxId: string): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    for (const f of SYSTEM_FOLDERS) {
      await db.run(
        `INSERT INTO mail_folders (folder_id, mailbox_id, name, system_kind, sort, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (mailbox_id, system_kind) DO NOTHING`,
        [newId("mfd"), mailboxId, f.name, f.kind, f.sort, now]
      );
    }
  });
}

/** 메일함의 특정 시스템 폴더 id(없으면 보장 후 재조회). */
export async function getSystemFolderId(mailboxId: string, kind: string): Promise<string> {
  const db = await getDb();
  const sel = async () =>
    rowsToObjects(
      await db.exec(`SELECT folder_id FROM mail_folders WHERE mailbox_id = $1 AND system_kind = $2 LIMIT 1`, [mailboxId, kind])
    );
  let rows = await sel();
  if (!rows.length) {
    await ensureSystemFolders(mailboxId);
    rows = await sel();
  }
  if (!rows.length) throw new Error(`시스템 폴더(${kind})를 찾을 수 없습니다.`);
  return String(rows[0].folder_id);
}

/** 내 서명 저장(G2-5). */
export async function updateSignature(userId: string, signatureHtml: string): Promise<void> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) throw new Error("메일함이 없습니다.");
  await withDbWrite(async (db) => {
    await db.run(`UPDATE mailboxes SET signature_html = $2, updated_at = $3 WHERE mailbox_id = $1`, [
      mailbox.mailboxId,
      signatureHtml,
      new Date().toISOString(),
    ]);
  });
}

/**
 * user_id 의 mailbox 를 보장한다. 없으면 users.email_local(→ email 앞자리) 로 생성.
 * local_part 를 유도할 수 없으면(둘 다 없음) 에러 — 계정에 메일 주소를 지정할 수 없는 상태.
 */
export async function ensureMailbox(userId: string): Promise<Mailbox> {
  const existing = await getMailboxByUser(userId);
  if (existing) {
    await ensureSystemFolders(existing.mailboxId);
    return existing;
  }

  const db = await getDb();
  const urows = rowsToObjects(
    await db.exec(
      `SELECT u.user_id, u.email_local, u.email, u.employee_id,
              COALESCE(ep.name, u.email) AS name
         FROM users u LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
        WHERE u.user_id = $1`,
      [userId]
    )
  );
  if (!urows.length) throw new Error("사용자를 찾을 수 없습니다.");
  const u = urows[0];
  const rawLocal =
    (u.email_local != null && String(u.email_local)) ||
    (u.email != null ? String(u.email).split("@")[0] : "") ||
    "";
  const localPart = normalizeLocalPart(rawLocal);
  if (!localPart) {
    throw new Error("이 계정에는 메일 주소로 쓸 아이디(email_local)가 없습니다. 관리자에게 문의하세요.");
  }
  const address = `${localPart}@${MAIL_DOMAIN}`;
  const displayName = u.name != null ? String(u.name) : address;
  const employeeId = u.employee_id != null ? String(u.employee_id) : null;
  const now = new Date().toISOString();
  const mailboxId = newId("mbx");

  await withDbWrite(async (wdb) => {
    await wdb.run(
      `INSERT INTO mailboxes (mailbox_id, user_id, employee_id, address, local_part, display_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $7)
       ON CONFLICT (address) DO NOTHING`,
      [mailboxId, userId, employeeId, address, localPart, displayName, now]
    );
  });

  // 경합(동시 최초 발송)으로 다른 트랜잭션이 먼저 만들었을 수 있어 재조회.
  const created = await getMailboxByUser(userId);
  if (!created) {
    // address 충돌(다른 유저가 같은 local_part 선점)로 INSERT 가 스킵된 경우.
    throw new Error(`메일 주소 '${address}' 가 이미 사용 중입니다. 관리자에게 문의하세요.`);
  }
  await ensureSystemFolders(created.mailboxId);
  return created;
}
