/**
 * 메일 머리글 주소 → 앱 주소록 이름표(2026-11-12 사용자 요청).
 * 보낸사람·받는사람·참조 태그에 주소록에 등록된 사람이면 성명·직함을 붙인다. 등록되지 않은 주소는 주소만 보인다.
 * 우선순위: 임직원(메일함 주소 원장·회사 도메인 로컬파트) > 사업장 담당자(외부 주소록) > 내 메일 주소록(이름만).
 * 조회 실패(표 미설치 등)는 해당 출처만 건너뛰어 메일 상세 조회를 깨지 않는다.
 */
import { rowsToObjects, type PgDatabase } from "@/lib/db";
import { MAIL_DOMAIN, splitAddress } from "@/lib/mail/mailbox";

export interface MailAddressBookEntry {
  /** 성명 */
  name: string;
  /** 직함(임직원=직위, 외부 담당자=직함). 없으면 null. */
  title: string | null;
  /** 소속(임직원=부서, 외부 담당자=업체명) — 태그 툴팁용. */
  org: string | null;
  kind: "employee" | "contact" | "personal";
}

const text = (v: unknown): string | null => (v == null || String(v).trim() === "" ? null : String(v).trim());

/** "이름 <주소>"·주소 → 소문자 주소(형식이 아니면 null). */
export function normalizeMailAddress(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  const m = s.match(/<([^>]+)>\s*$/);
  const addr = (m ? m[1] : s).trim().toLowerCase();
  return splitAddress(addr) ? addr : null;
}

async function safeRows(db: PgDatabase, sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  try {
    return rowsToObjects(await db.exec(sql, params));
  } catch {
    return [];
  }
}

/** 주소 목록을 주소록과 맞춰 이름표를 돌려준다(키 = 소문자 주소). mailboxId 는 '내 메일 주소록' 조회용. */
export async function resolveMailAddressBook(
  db: PgDatabase,
  mailboxId: string | null,
  rawAddresses: (string | null | undefined)[]
): Promise<Record<string, MailAddressBookEntry>> {
  const addresses = [...new Set(rawAddresses.map(normalizeMailAddress).filter((a): a is string => !!a))].slice(0, 200);
  const out: Record<string, MailAddressBookEntry> = {};
  if (!addresses.length) return out;

  // 1) 임직원 — 메일함 주소 원장(.app·.com 등 다중 도메인)과 대표 주소.
  const byMailbox = await safeRows(
    db,
    `SELECT LOWER(a.address) AS address, e.name, p.position_name, d.dept_name
       FROM (
         SELECT ma.address, ma.mailbox_id FROM mailbox_addresses ma WHERE LOWER(ma.address) = ANY($1::text[])
         UNION
         SELECT mb.address, mb.mailbox_id FROM mailboxes mb WHERE LOWER(mb.address) = ANY($1::text[])
       ) a
       JOIN mailboxes mb ON mb.mailbox_id = a.mailbox_id
       JOIN employee_profiles e ON e.user_id = mb.user_id AND e.status = 'active'
       LEFT JOIN positions p ON p.position_id = e.position_id
       LEFT JOIN departments d ON d.dept_id = e.dept_id`,
    [addresses]
  );
  for (const r of byMailbox) {
    const name = text(r.name);
    if (!name) continue;
    out[String(r.address)] = { name, title: text(r.position_name), org: text(r.dept_name), kind: "employee" };
  }

  // 1-b) 메일함이 아직 없는 직원 — 회사 도메인 주소의 로컬파트를 users.email_local 과 맞춘다.
  const domains = new Set<string>([MAIL_DOMAIN.toLowerCase()]);
  for (const r of await safeRows(db, `SELECT domain FROM mail_domains`, [])) domains.add(String(r.domain).toLowerCase());
  const companyLocals = new Map<string, string[]>();
  for (const a of addresses) {
    if (out[a]) continue;
    const sp = splitAddress(a);
    if (!sp || !domains.has(sp.domain)) continue;
    companyLocals.set(sp.localPart, [...(companyLocals.get(sp.localPart) ?? []), a]);
  }
  if (companyLocals.size) {
    const rows = await safeRows(
      db,
      `SELECT LOWER(u.email_local) AS local_part, e.name, p.position_name, d.dept_name
         FROM users u
         JOIN employee_profiles e ON e.user_id = u.user_id AND e.status = 'active'
         LEFT JOIN positions p ON p.position_id = e.position_id
         LEFT JOIN departments d ON d.dept_id = e.dept_id
        WHERE u.status = 'active' AND LOWER(u.email_local) = ANY($1::text[])`,
      [[...companyLocals.keys()]]
    );
    for (const r of rows) {
      const name = text(r.name);
      if (!name) continue;
      for (const a of companyLocals.get(String(r.local_part)) ?? []) {
        out[a] ??= { name, title: text(r.position_name), org: text(r.dept_name), kind: "employee" };
      }
    }
  }

  // 2) 사업장 담당자(외부 주소록) — 같은 주소가 여러 업체에 있으면 최근 등록분.
  const rest = addresses.filter((a) => !out[a]);
  if (rest.length) {
    const rows = await safeRows(
      db,
      `SELECT DISTINCT ON (LOWER(cp.email)) LOWER(cp.email) AS address, cp.person_name, cp.title, f.company_name
         FROM facility_contact_people cp
         LEFT JOIN facilities f ON f.facility_id = cp.facility_id
        WHERE LOWER(cp.email) = ANY($1::text[]) AND COALESCE(cp.status, 'active') <> 'inactive'
        ORDER BY LOWER(cp.email), cp.id DESC`,
      [rest]
    );
    for (const r of rows) {
      const name = text(r.person_name);
      if (!name) continue;
      out[String(r.address)] = { name, title: text(r.title), org: text(r.company_name), kind: "contact" };
    }
  }

  // 3) 내 메일 주소록(305) — 표시 이름만 있다.
  const mine = addresses.filter((a) => !out[a]);
  if (mine.length && mailboxId) {
    const rows = await safeRows(
      db,
      `SELECT address, display_name FROM mail_contacts WHERE mailbox_id = $1 AND address = ANY($2::text[])`,
      [mailboxId, mine]
    );
    for (const r of rows) {
      const name = text(r.display_name);
      if (!name) continue;
      out[String(r.address).toLowerCase()] = { name, title: null, org: null, kind: "personal" };
    }
  }
  return out;
}
