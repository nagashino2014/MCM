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
    // 주소 원장(280)에도 대표 주소로 기록 — 도메인이 등록돼 있을 때만(FK).
    await wdb.run(
      `INSERT INTO mailbox_addresses (address, mailbox_id, domain, local_part, is_primary, source, created_at)
       SELECT $1, mb.mailbox_id, $2, $3, 1, 'legacy', $4
         FROM mailboxes mb
        WHERE mb.address = $1 AND EXISTS (SELECT 1 FROM mail_domains WHERE domain = $2)
       ON CONFLICT (address) DO NOTHING`,
      [address, MAIL_DOMAIN, localPart, now]
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

// ── 다중 도메인 주소 원장(280, koensain.com 1단계) ─────────────────────────
// 메일함 하나가 여러 주소를 가진다(.app 수신 + .com 발신). mailboxes.address 는 대표(발신) 주소 캐시이며
// 대표 주소 변경은 setPrimaryAddress 한 곳에서만 한다. 설계: docs/company-email-com-domain-phase1.md §3.

export interface MailDomain {
  domain: string;
  inboundMode: "ses" | "external";
  sendEnabled: boolean;
  note: string | null;
}

export interface MailboxAddress {
  address: string;
  domain: string;
  localPart: string;
  isPrimary: boolean;
  source: string;
}

/** 주소를 소문자 로컬파트·도메인으로 나눈다(형식이 아니면 null). */
export function splitAddress(raw: string): { localPart: string; domain: string } | null {
  const m = String(raw ?? "").trim().toLowerCase().match(/^([^@\s]+)@([^@\s]+\.[^@\s]+)$/);
  return m ? { localPart: m[1], domain: m[2] } : null;
}

function toMailDomain(r: Record<string, unknown>): MailDomain {
  return {
    domain: String(r.domain),
    inboundMode: String(r.inbound_mode) === "external" ? "external" : "ses",
    sendEnabled: Number(r.send_enabled) === 1,
    note: r.note != null ? String(r.note) : null,
  };
}

export async function listMailDomains(): Promise<MailDomain[]> {
  const db = await getDb();
  return rowsToObjects(await db.exec(`SELECT * FROM mail_domains ORDER BY domain`)).map(toMailDomain);
}

export async function getMailDomain(domain: string): Promise<MailDomain | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT * FROM mail_domains WHERE domain = $1`, [domain.toLowerCase()]));
  return rows.length ? toMailDomain(rows[0]) : null;
}

/** 메일함의 주소 전체(대표 주소 먼저). 원장에 대표 행이 없으면 mailboxes.address 를 대표로 보탠다. */
export async function getMailboxAddresses(mailboxId: string): Promise<MailboxAddress[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT address, domain, local_part, is_primary, source FROM mailbox_addresses
        WHERE mailbox_id = $1 ORDER BY is_primary DESC, domain, address`,
      [mailboxId]
    )
  );
  const out: MailboxAddress[] = rows.map((r) => ({
    address: String(r.address),
    domain: String(r.domain),
    localPart: String(r.local_part),
    isPrimary: Number(r.is_primary) === 1,
    source: String(r.source),
  }));
  if (!out.some((a) => a.isPrimary)) {
    const mb = rowsToObjects(await db.exec(`SELECT address FROM mailboxes WHERE mailbox_id = $1`, [mailboxId]));
    const parts = mb.length ? splitAddress(String(mb[0].address)) : null;
    if (parts && !out.some((a) => a.address === `${parts.localPart}@${parts.domain}`)) {
      out.unshift({ address: `${parts.localPart}@${parts.domain}`, ...parts, isPrimary: true, source: "legacy" });
    }
  }
  return out;
}

export interface ResolvedAddress {
  mailboxId: string;
  domain: string;
  inboundMode: "ses" | "external" | null;
  /** 같은 메일함의 SES 수신 도메인 주소(사내 수신자 단락 배달용). 없으면 null. */
  sesAddress: string | null;
}

/**
 * 주소 → 메일함 해석(원장 + mailboxes.address). 수신 라우팅·사내 수신자 단락이 쓴다.
 * 활성 메일함만. 키는 소문자 주소.
 */
export async function resolveMailboxAddresses(addresses: string[]): Promise<Map<string, ResolvedAddress>> {
  const list = [...new Set(addresses.map((a) => String(a ?? "").trim().toLowerCase()).filter((a) => a.includes("@")))];
  const out = new Map<string, ResolvedAddress>();
  if (!list.length) return out;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `WITH hit AS (
         SELECT ma.address, ma.mailbox_id FROM mailbox_addresses ma WHERE ma.address = ANY($1::text[])
         UNION
         SELECT lower(mb.address), mb.mailbox_id FROM mailboxes mb WHERE lower(mb.address) = ANY($1::text[])
       )
       SELECT h.address, h.mailbox_id, md.inbound_mode, mb.local_part,
              (SELECT sa.address FROM mailbox_addresses sa JOIN mail_domains sd ON sd.domain = sa.domain
                WHERE sa.mailbox_id = h.mailbox_id AND sd.inbound_mode = 'ses'
                ORDER BY (sa.domain = $2) DESC, sa.is_primary DESC, sa.address LIMIT 1) AS ses_address
         FROM hit h
         JOIN mailboxes mb ON mb.mailbox_id = h.mailbox_id AND mb.status = 'active'
         LEFT JOIN mail_domains md ON md.domain = split_part(h.address, '@', 2)`,
      [list, MAIL_DOMAIN]
    )
  );
  for (const r of rows) {
    const address = String(r.address);
    const mode = r.inbound_mode != null ? (String(r.inbound_mode) === "external" ? "external" : "ses") : null;
    // 원장에 SES 도메인 주소가 없으면 메일함의 .app 로컬파트로 유도(inbound 의 local_part 경로가 받는다).
    const sesAddress =
      r.ses_address != null ? String(r.ses_address) : r.local_part != null ? `${String(r.local_part)}@${MAIL_DOMAIN}` : null;
    out.set(address, {
      mailboxId: String(r.mailbox_id),
      domain: address.split("@")[1] ?? "",
      inboundMode: mode,
      sesAddress,
    });
  }
  return out;
}

/** 메일함에 주소 추가(대표 아님). 도메인은 mail_domains 에 있어야 한다. */
export async function addMailboxAddress(
  mailboxId: string,
  rawAddress: string,
  source: "auto" | "manual" = "manual"
): Promise<MailboxAddress> {
  const parts = splitAddress(rawAddress);
  if (!parts) throw new Error("메일 주소 형식이 올바르지 않습니다.");
  const localPart = normalizeLocalPart(parts.localPart);
  if (!localPart || localPart !== parts.localPart) {
    throw new Error("주소 앞부분은 영문 소문자·숫자·._- 만 쓸 수 있습니다.");
  }
  const domain = await getMailDomain(parts.domain);
  if (!domain) throw new Error(`등록되지 않은 도메인입니다: ${parts.domain}`);
  const address = `${localPart}@${domain.domain}`;
  const db = await getDb();
  const taken = rowsToObjects(
    await db.exec(
      `SELECT mailbox_id FROM mailbox_addresses WHERE address = $1
       UNION SELECT mailbox_id FROM mailboxes WHERE lower(address) = $1`,
      [address]
    )
  );
  if (taken.some((r) => String(r.mailbox_id) !== mailboxId)) throw new Error(`'${address}' 는 다른 메일함이 쓰고 있습니다.`);
  // 앱 기본 도메인 주소는 별칭·다른 메일함 로컬파트와도 겹치면 안 된다(inbound 가 로컬파트로도 배달).
  if (domain.domain === MAIL_DOMAIN) {
    const clash = rowsToObjects(
      await db.exec(
        `SELECT 1 FROM mail_aliases WHERE alias_local = $1
         UNION ALL SELECT 1 FROM mailboxes WHERE local_part = $1 AND mailbox_id <> $2`,
        [localPart, mailboxId]
      )
    );
    if (clash.length) throw new Error(`'${address}' 는 별칭이나 다른 메일함과 겹칩니다.`);
  }
  await withDbWrite(async (wdb) => {
    await wdb.run(
      `INSERT INTO mailbox_addresses (address, mailbox_id, domain, local_part, is_primary, source, created_at)
       VALUES ($1, $2, $3, $4, 0, $5, $6)
       ON CONFLICT (address) DO NOTHING`,
      [address, mailboxId, domain.domain, localPart, source, new Date().toISOString()]
    );
  });
  return { address, domain: domain.domain, localPart, isPrimary: false, source };
}

/** 대표 아닌 주소 삭제. 대표 주소·기존 수신 주소(legacy)는 지우지 않는다. */
export async function removeMailboxAddress(mailboxId: string, rawAddress: string): Promise<void> {
  const address = String(rawAddress ?? "").trim().toLowerCase();
  const addrs = await getMailboxAddresses(mailboxId);
  const row = addrs.find((a) => a.address === address);
  if (!row) throw new Error("이 메일함의 주소가 아닙니다.");
  if (row.isPrimary) throw new Error("대표 주소는 지울 수 없습니다. 먼저 다른 주소를 대표로 바꾸세요.");
  if (row.source === "legacy") throw new Error("기존 수신 주소는 지울 수 없습니다.");
  await withDbWrite(async (wdb) => {
    await wdb.run(`DELETE FROM mailbox_addresses WHERE mailbox_id = $1 AND address = $2 AND is_primary = 0`, [mailboxId, address]);
  });
}

/**
 * 대표(발신) 주소 전환 — 원장 is_primary 와 mailboxes.address 를 한 트랜잭션에서 함께 바꾼다.
 * 대상 도메인의 send_enabled 가 꺼져 있으면 거절한다.
 */
export async function setPrimaryAddress(mailboxId: string, rawAddress: string): Promise<{ previous: string; current: string }> {
  const address = String(rawAddress ?? "").trim().toLowerCase();
  const addrs = await getMailboxAddresses(mailboxId);
  const target = addrs.find((a) => a.address === address);
  if (!target) throw new Error("이 메일함에 등록된 주소가 아닙니다.");
  const previous = addrs.find((a) => a.isPrimary)?.address ?? "";
  if (target.isPrimary) return { previous, current: address };
  const domain = await getMailDomain(target.domain);
  if (!domain?.sendEnabled) throw new Error(`${target.domain} 도메인은 아직 발신이 켜져 있지 않습니다.`);
  const now = new Date().toISOString();
  await withDbWrite(async (wdb) => {
    // 원장에 대표 행이 없던 메일함은 이전 대표 주소를 legacy 로 먼저 남긴다(수신 주소 보존).
    const p = previous ? splitAddress(previous) : null;
    if (p) {
      await wdb.run(
        `INSERT INTO mailbox_addresses (address, mailbox_id, domain, local_part, is_primary, source, created_at)
         SELECT $1, $2, $3, $4, 0, 'legacy', $5 WHERE EXISTS (SELECT 1 FROM mail_domains WHERE domain = $3)
         ON CONFLICT (address) DO NOTHING`,
        [previous, mailboxId, p.domain, p.localPart, now]
      );
    }
    await wdb.run(`UPDATE mailbox_addresses SET is_primary = 0 WHERE mailbox_id = $1 AND is_primary = 1`, [mailboxId]);
    await wdb.run(`UPDATE mailbox_addresses SET is_primary = 1 WHERE mailbox_id = $1 AND address = $2`, [mailboxId, address]);
    await wdb.run(`UPDATE mailboxes SET address = $2, updated_at = $3 WHERE mailbox_id = $1`, [mailboxId, address, now]);
  });
  return { previous, current: address };
}

export async function setDomainSendEnabled(domain: string, enabled: boolean): Promise<void> {
  await withDbWrite(async (wdb) => {
    await wdb.run(`UPDATE mail_domains SET send_enabled = $2, updated_at = $3 WHERE domain = $1`, [
      domain.toLowerCase(),
      enabled ? 1 : 0,
      new Date().toISOString(),
    ]);
  });
}
