/**
 * 코넨사인 메일 — 외부 메일 프로그램(아웃룩 등) 연결: 앱 비밀번호·연결 설정.
 * - 연결 설정(서버 주소·포트·사용 여부)은 mail_settings key 'external_client'(JSON) 한 줄. 관리자가 켠다.
 * - 앱 비밀번호는 계정별로 발급·폐기하고 bcrypt 해시만 저장한다(306). 평문은 발급 응답에서 한 번만 보인다.
 * 게이트웨이(lib/mail/gateway)는 같은 표를 읽어 IMAP/SMTP 로그인을 확인한다.
 * 설계: docs/mail-external-client-plan.md §3.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { ensureMailbox, getMailboxByUser } from "@/lib/mail/mailbox";

export interface ExternalClientConfig {
  enabled: boolean;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
}

export const DEFAULT_EXTERNAL_CLIENT: ExternalClientConfig = {
  enabled: false,
  imapHost: "imap.koensain.app",
  imapPort: 993,
  smtpHost: "smtp.koensain.app",
  smtpPort: 465,
};

/** 계정당 동시에 쓸 수 있는 앱 비밀번호 수(로그인마다 해시를 차례로 대조하므로 작게 둔다). */
export const MAX_ACTIVE_APP_PASSWORDS = 5;

export async function getExternalClientConfig(): Promise<ExternalClientConfig> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT value FROM mail_settings WHERE key = 'external_client'`));
  if (!rows.length || rows[0].value == null) return { ...DEFAULT_EXTERNAL_CLIENT };
  try {
    const v = JSON.parse(String(rows[0].value)) as Partial<ExternalClientConfig>;
    return {
      enabled: v.enabled === true,
      imapHost: String(v.imapHost || DEFAULT_EXTERNAL_CLIENT.imapHost),
      imapPort: Number(v.imapPort) || DEFAULT_EXTERNAL_CLIENT.imapPort,
      smtpHost: String(v.smtpHost || DEFAULT_EXTERNAL_CLIENT.smtpHost),
      smtpPort: Number(v.smtpPort) || DEFAULT_EXTERNAL_CLIENT.smtpPort,
    };
  } catch {
    return { ...DEFAULT_EXTERNAL_CLIENT };
  }
}

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** 현재 설정에 입력을 합치고 검사한다(저장하지 않음). 형식이 틀리면 400 오류. */
export async function resolveExternalClientConfig(input: Partial<ExternalClientConfig>): Promise<ExternalClientConfig> {
  const cur = await getExternalClientConfig();
  const next: ExternalClientConfig = {
    enabled: input.enabled ?? cur.enabled,
    imapHost: String(input.imapHost ?? cur.imapHost).trim().toLowerCase(),
    imapPort: Number(input.imapPort ?? cur.imapPort),
    smtpHost: String(input.smtpHost ?? cur.smtpHost).trim().toLowerCase(),
    smtpPort: Number(input.smtpPort ?? cur.smtpPort),
  };
  if (!HOST_RE.test(next.imapHost) || !HOST_RE.test(next.smtpHost)) {
    throw Object.assign(new Error("서버 주소 형식이 올바르지 않습니다."), { status: 400 });
  }
  for (const p of [next.imapPort, next.smtpPort]) {
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw Object.assign(new Error("포트 번호가 올바르지 않습니다."), { status: 400 });
  }
  return next;
}

export async function saveExternalClientConfig(input: Partial<ExternalClientConfig>): Promise<ExternalClientConfig> {
  const next = await resolveExternalClientConfig(input);
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO mail_settings (key, value, updated_at) VALUES ('external_client', $1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      [JSON.stringify(next), new Date().toISOString()]
    );
  });
  return next;
}

export interface AppPasswordItem {
  appPasswordId: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  lastUsedProto: string | null;
}

export async function listAppPasswords(userId: string): Promise<AppPasswordItem[]> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) return [];
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT app_password_id, label, created_at, last_used_at, last_used_ip, last_used_proto
         FROM mail_app_passwords WHERE mailbox_id = $1 AND revoked_at IS NULL ORDER BY created_at`,
      [mailbox.mailboxId]
    )
  );
  return rows.map((r) => ({
    appPasswordId: String(r.app_password_id),
    label: String(r.label),
    createdAt: String(r.created_at),
    lastUsedAt: r.last_used_at != null ? String(r.last_used_at) : null,
    lastUsedIp: r.last_used_ip != null ? String(r.last_used_ip) : null,
    lastUsedProto: r.last_used_proto != null ? String(r.last_used_proto) : null,
  }));
}

/** 16자 영문 소문자(4자씩 띄움). 띄어쓰기는 입력 편의용 — 확인할 때는 공백을 지운다. */
export function generateAppPassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyz"; // l 제외(1·I 와 혼동)
  const bytes = crypto.randomBytes(16);
  let s = "";
  for (let i = 0; i < 16; i++) s += alphabet[bytes[i] % alphabet.length];
  return s.match(/.{4}/g)!.join(" ");
}

/** 공백·대소문자 차이를 없앤 앱 비밀번호(해시·대조 공통). */
export function normalizeAppPassword(plain: string): string {
  return String(plain ?? "").replace(/\s+/g, "").toLowerCase();
}

export async function createAppPassword(userId: string, label: string): Promise<{ item: AppPasswordItem; password: string }> {
  const cfg = await getExternalClientConfig();
  if (!cfg.enabled) throw Object.assign(new Error("외부 메일 프로그램 연결이 꺼져 있습니다. 관리자에게 문의하세요."), { status: 403 });
  const name = String(label ?? "").trim().slice(0, 40);
  if (!name) throw Object.assign(new Error("앱 비밀번호 이름을 입력하세요."), { status: 400 });
  const mailbox = await ensureMailbox(userId);
  if (mailbox.status !== "active") throw Object.assign(new Error("사용이 정지된 메일함입니다."), { status: 403 });
  const active = await listAppPasswords(userId);
  if (active.length >= MAX_ACTIVE_APP_PASSWORDS) {
    throw Object.assign(new Error(`앱 비밀번호는 ${MAX_ACTIVE_APP_PASSWORDS}개까지 만들 수 있습니다. 쓰지 않는 것을 먼저 폐기하세요.`), {
      status: 400,
    });
  }
  const password = generateAppPassword();
  const hash = await hashPassword(normalizeAppPassword(password));
  const id = "mapw-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO mail_app_passwords (app_password_id, mailbox_id, user_id, label, password_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, mailbox.mailboxId, userId, name, hash, now]
    );
  });
  return {
    item: { appPasswordId: id, label: name, createdAt: now, lastUsedAt: null, lastUsedIp: null, lastUsedProto: null },
    password,
  };
}

export async function revokeAppPassword(userId: string, appPasswordId: string): Promise<boolean> {
  const mailbox = await getMailboxByUser(userId);
  if (!mailbox) return false;
  let ok = false;
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(
      await db.exec(
        `UPDATE mail_app_passwords SET revoked_at = $3
          WHERE app_password_id = $1 AND mailbox_id = $2 AND revoked_at IS NULL
        RETURNING app_password_id`,
        [appPasswordId, mailbox.mailboxId, new Date().toISOString()]
      )
    );
    ok = rows.length > 0;
  });
  return ok;
}
