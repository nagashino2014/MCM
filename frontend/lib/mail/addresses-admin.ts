/**
 * 코넨사인 메일 — 회사 주소(다중 도메인) 관리자 조회·일괄 등록(280, koensain.com 1단계).
 * .com 주소 = 메일함 로컬파트 + @도메인(아마란스 주소 앞자리 = 앱 이메일 앞자리, 2026-10-15 확인).
 * 설계: docs/company-email-com-domain-phase1.md §2, §5.5.
 */
import { getDb, rowsToObjects } from "@/lib/db";
import {
  addMailboxAddress,
  ensureMailbox,
  getMailDomain,
  listMailDomains,
  type MailDomain,
  type MailboxAddress,
} from "@/lib/mail/mailbox";

export interface AddressAdminRow {
  mailboxId: string;
  displayName: string;
  localPart: string;
  /** 사용자 관리에 등록된 이메일의 앞자리 — 로컬파트와 다르면 아마란스 주소와 어긋날 수 있다. */
  emailLocal: string | null;
  addresses: MailboxAddress[];
}

export interface AddressAdminList {
  domains: MailDomain[];
  rows: AddressAdminRow[];
  /** 메일함이 아직 없는 재직자 수(일괄 등록 시 메일함을 만든다). */
  noMailboxCount: number;
}

export async function listAddressAdmin(): Promise<AddressAdminList> {
  const db = await getDb();
  const boxes = rowsToObjects(
    await db.exec(
      `SELECT mb.mailbox_id, mb.address, mb.local_part, COALESCE(mb.display_name, mb.address) AS display_name,
              split_part(lower(u.email), '@', 1) AS email_local
         FROM mailboxes mb
         LEFT JOIN users u ON u.user_id = mb.user_id
        WHERE mb.status = 'active'
        ORDER BY COALESCE(mb.display_name, mb.address)`
    )
  );
  const addrs = rowsToObjects(
    await db.exec(`SELECT address, mailbox_id, domain, local_part, is_primary, source FROM mailbox_addresses ORDER BY is_primary DESC, domain, address`)
  );
  const byBox = new Map<string, MailboxAddress[]>();
  for (const a of addrs) {
    const list = byBox.get(String(a.mailbox_id)) ?? [];
    list.push({
      address: String(a.address),
      domain: String(a.domain),
      localPart: String(a.local_part),
      isPrimary: Number(a.is_primary) === 1,
      source: String(a.source),
    });
    byBox.set(String(a.mailbox_id), list);
  }
  const rows: AddressAdminRow[] = boxes.map((b) => {
    const id = String(b.mailbox_id);
    const list = byBox.get(id) ?? [];
    // 원장 대표 행이 없는 메일함(280 이후 구버전 코드가 만든 경우)은 mailboxes.address 를 대표로 표시.
    if (!list.some((a) => a.isPrimary)) {
      const addr = String(b.address).toLowerCase();
      const [lp, dm] = addr.split("@");
      if (!list.some((a) => a.address === addr)) list.unshift({ address: addr, domain: dm ?? "", localPart: lp ?? "", isPrimary: true, source: "legacy" });
    }
    return {
      mailboxId: id,
      displayName: String(b.display_name),
      localPart: String(b.local_part),
      emailLocal: b.email_local != null && String(b.email_local) !== "" ? String(b.email_local) : null,
      addresses: list,
    };
  });
  const missing = rowsToObjects(
    await db.exec(
      `SELECT count(*)::int AS n FROM users u
        WHERE u.status = 'active' AND COALESCE(u.email_local, '') <> ''
          AND NOT EXISTS (SELECT 1 FROM mailboxes mb WHERE mb.user_id = u.user_id)`
    )
  );
  return { domains: await listMailDomains(), rows, noMailboxCount: Number(missing[0]?.n ?? 0) };
}

export interface BulkRegisterResult {
  created: number;
  skipped: number;
  mailboxesCreated: number;
  failures: { who: string; error: string }[];
}

/**
 * 재직자 전원에게 `{메일함 로컬파트}@{domain}` 주소를 보조 주소로 등록한다(대표 전환은 하지 않음).
 * 메일함이 없는 재직자는 먼저 메일함을 만든다. 이미 등록된 주소는 건너뛴다.
 */
export async function bulkRegisterDomain(domainName: string): Promise<BulkRegisterResult> {
  const domain = await getMailDomain(domainName);
  if (!domain) throw new Error(`등록되지 않은 도메인입니다: ${domainName}`);
  const db = await getDb();
  const result: BulkRegisterResult = { created: 0, skipped: 0, mailboxesCreated: 0, failures: [] };

  const noBox = rowsToObjects(
    await db.exec(
      `SELECT u.user_id, u.email_local FROM users u
        WHERE u.status = 'active' AND COALESCE(u.email_local, '') <> ''
          AND NOT EXISTS (SELECT 1 FROM mailboxes mb WHERE mb.user_id = u.user_id)`
    )
  );
  for (const u of noBox) {
    try {
      await ensureMailbox(String(u.user_id));
      result.mailboxesCreated += 1;
    } catch (err) {
      result.failures.push({ who: String(u.email_local), error: err instanceof Error ? err.message : String(err) });
    }
  }

  const boxes = rowsToObjects(
    await db.exec(
      `SELECT mb.mailbox_id, mb.local_part FROM mailboxes mb
        WHERE mb.status = 'active' AND mb.user_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM mailbox_addresses ma WHERE ma.mailbox_id = mb.mailbox_id AND ma.domain = $1)`,
      [domain.domain]
    )
  );
  for (const b of boxes) {
    const address = `${String(b.local_part)}@${domain.domain}`;
    try {
      await addMailboxAddress(String(b.mailbox_id), address, "auto");
      result.created += 1;
    } catch (err) {
      result.failures.push({ who: address, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const total = rowsToObjects(
    await db.exec(`SELECT count(*)::int AS n FROM mailboxes WHERE status = 'active' AND user_id IS NOT NULL`)
  );
  // 건너뜀 = 이미 이 도메인 주소가 있던 메일함.
  result.skipped = Math.max(0, Number(total[0]?.n ?? 0) - boxes.length);
  return result;
}
