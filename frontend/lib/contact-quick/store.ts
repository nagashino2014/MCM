/**
 * 주소록 간이 등록(357, 2026-11-12 사용자 결정 — 직원 개선 요청 9·20).
 * 메일 주소를 눌러 '주소록에 추가'할 때 업체를 먼저 정한다: 기존 업체를 고르거나, 없으면 업체명만으로 간이 업체를 만든다.
 * 담당자는 사업장 담당자(facility_contact_people)로 바로 넣어 주소록·받는 사람 검색에 곧바로 나오게 하고,
 * 간이로 만든 업체·담당자는 contact_quick_registrations 에 남겨 관리자가 확정하거나 등록 직원에게 상세정보를 요청한다.
 */
import { rowsToObjects, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { MAIL_DOMAIN } from "@/lib/mail/mailbox";
import { companyDomain, companyKey } from "@scraper/lib/contact-import/rules";
import { extractRegion } from "@scraper/lib/ieps/region";
import { normalizeInput } from "@scraper/lib/facility-quality/rules";
import { postDirectSharedRecordInTransaction } from "@/lib/chat/queries";
import crypto from "node:crypto";

export type QuickKind = "facility" | "person";
export type QuickStatus = "pending" | "requested" | "done";
export const QUICK_STATUSES: QuickStatus[] = ["pending", "requested", "done"];

const EMAIL_RE = /^[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[^\s@<>()"',;]+$/;
const first = async (db: PgDatabase, sql: string, params: unknown[] = []) => rowsToObjects(await db.exec(sql, params))[0];
const clean = (value: unknown, max = 200): string | null => {
  const t = String(value ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};
const text = (value: unknown): string | null => (value == null || value === "" ? null : String(value));

/** "이름 <주소>" 나 대문자 주소도 받는다. 형식이 아니면 null. */
export function normalizeEmail(raw: unknown): string | null {
  const m = String(raw ?? "").match(/<([^>]+)>/);
  const addr = (m ? m[1] : String(raw ?? "")).trim().toLowerCase();
  return EMAIL_RE.test(addr) ? addr : null;
}

export interface QuickFacilityHit { facilityId: string; companyName: string; region: string | null; reason: string }
export interface QuickLookup {
  address: string;
  /** 회사(사내) 메일 주소면 true — 임직원은 주소록 임직원 탭에 이미 있다. */
  internal: boolean;
  /** 같은 이메일로 이미 주소록에 있는 담당자. */
  existing: { id: number; personName: string; title: string | null; facilityId: string; facilityName: string | null }[];
  /** 이메일 도메인으로 고른 업체 후보(회사 홈페이지·같은 도메인 담당자·연락처 가져오기 분류). */
  suggestions: QuickFacilityHit[];
  /** 무료 메일이 아니면 회사 도메인 — 간이 업체 홈페이지 기본값. */
  domain: string | null;
}

async function isInternalDomain(db: PgDatabase, domain: string): Promise<boolean> {
  if (domain === MAIL_DOMAIN) return true;
  // 트랜잭션 안에서도 부르므로 표가 없을 때 오류로 트랜잭션을 깨지 않게 먼저 확인한다.
  const table = await first(db, `SELECT to_regclass('public.mail_domains') IS NOT NULL AS ok`);
  if (!table?.ok) return false;
  return !!(await first(db, `SELECT 1 AS ok FROM mail_domains WHERE domain = $1`, [domain]));
}

/** 메일 주소 하나로 간이 등록 양식의 처음 상태를 만든다. */
export async function lookupQuickContact(db: PgDatabase, rawAddress: string): Promise<QuickLookup> {
  const address = normalizeEmail(rawAddress);
  if (!address) throw Object.assign(new Error("메일 주소 형식이 아닙니다."), { status: 400 });
  const host = address.split("@")[1];
  const internal = await isInternalDomain(db, host);
  const existing = rowsToObjects(await db.exec(
    `SELECT p.id, p.person_name, p.title, p.facility_id, f.company_name
       FROM facility_contact_people p
       LEFT JOIN facilities f ON f.facility_id = p.facility_id
      WHERE LOWER(p.email) = $1 AND COALESCE(p.status, 'active') <> 'inactive' AND f.deleted_at IS NULL
      ORDER BY p.id LIMIT 5`, [address]
  )).map((r) => ({
    id: Number(r.id), personName: String(r.person_name), title: text(r.title), facilityId: String(r.facility_id), facilityName: text(r.company_name),
  }));
  const domain = companyDomain(address);
  const suggestions: QuickFacilityHit[] = [];
  if (domain && !internal) {
    const seen = new Set<string>();
    const push = (rows: Record<string, unknown>[], reason: string) => {
      for (const r of rows) {
        const id = String(r.facility_id);
        if (seen.has(id) || suggestions.length >= 6) continue;
        seen.add(id);
        suggestions.push({
          facilityId: id, companyName: String(r.company_name),
          region: [r.region_sido, r.region_sigungu].filter(Boolean).join(" ") || null, reason,
        });
      }
    };
    const like = `%@${domain}`;
    // 같은 도메인 메일을 쓰는 담당자가 많은 업체부터.
    push(rowsToObjects(await db.exec(
      `SELECT f.facility_id, f.company_name, f.region_sido, f.region_sigungu, COUNT(*) AS n
         FROM facility_contact_people p JOIN facilities f ON f.facility_id = p.facility_id AND f.deleted_at IS NULL
        WHERE LOWER(p.email) LIKE $1 AND COALESCE(p.status, 'active') <> 'inactive'
        GROUP BY f.facility_id, f.company_name, f.region_sido, f.region_sigungu
        ORDER BY n DESC, f.company_name LIMIT 6`, [like]
    )), "같은 도메인 담당자");
    // 홈페이지 주소가 같은 도메인인 업체.
    push(rowsToObjects(await db.exec(
      `SELECT facility_id, company_name, region_sido, region_sigungu FROM facilities
        WHERE deleted_at IS NULL AND homepage_url IS NOT NULL
          AND split_part(regexp_replace(regexp_replace(LOWER(TRIM(homepage_url)), '^https?://', ''), '^www\\.', ''), '/', 1) = $1
        ORDER BY company_name LIMIT 6`, [domain]
    )), "홈페이지 도메인");
    // 연락처 가져오기에서 같은 도메인 회사를 사업장으로 분류한 곳.
    push(rowsToObjects(await db.exec(
      `SELECT f.facility_id, f.company_name, f.region_sido, f.region_sigungu
         FROM contact_import_companies c JOIN facilities f ON f.facility_id = c.decided_facility_id AND f.deleted_at IS NULL
        WHERE c.email_domain = $1 AND c.decision IN ('link', 'partner', 'other')
        ORDER BY f.company_name LIMIT 6`, [domain]
    )), "연락처 가져오기");
  }
  return { address, internal, existing, suggestions, domain: internal ? null : domain };
}

export interface QuickRegisterInput {
  /** 기존 업체를 고른 경우. */
  facilityId?: string | null;
  /** 간이 업체를 새로 만드는 경우 — 업체명 필수, 나머지 선택. */
  newFacility?: { companyName?: string | null; phone?: string | null; address?: string | null; homepage?: string | null } | null;
  /** 같은 이름의 업체가 있어도 새로 만든다(화면에서 확인한 뒤). */
  forceNewFacility?: boolean;
  person: {
    personName?: string | null; title?: string | null; departmentName?: string | null;
    mobilePhone?: string | null; officePhone?: string | null; email?: string | null;
  };
  source?: "mail" | "directory";
  sourceAddress?: string | null;
}

export class QuickRegisterConflict extends Error {
  status = 409;
  constructor(message: string, public candidates: QuickFacilityHit[]) {
    super(message);
  }
}

export interface QuickRegisterResult { facilityId: string; facilityName: string; personId: number; facilityCreated: boolean; quickPersonId: number }

/**
 * 간이 등록 한 건. 업체가 정해지지 않으면 거절한다. 간이 업체는 '기타 업체·기관'(listing='other')에 둔다 —
 * 관리자가 상세 정보를 넣고 확정하면서 거래처로 승격하거나 사업장 마스터로 옮긴다.
 */
export async function quickRegister(db: PgDatabase, input: QuickRegisterInput, userId: string): Promise<QuickRegisterResult> {
  const now = new Date().toISOString();
  const personName = clean(input.person?.personName, 100);
  if (!personName) throw Object.assign(new Error("담당자 이름을 입력하세요."), { status: 400 });
  const email = input.person?.email ? normalizeEmail(input.person.email) : null;
  if (input.person?.email && String(input.person.email).trim() && !email) throw Object.assign(new Error("이메일 형식이 올바르지 않습니다."), { status: 400 });
  if (email && (await isInternalDomain(db, email.split("@")[1]))) {
    throw Object.assign(new Error("회사 메일 주소입니다. 임직원은 주소록 임직원 탭에 있습니다."), { status: 400 });
  }
  const source = input.source === "directory" ? "directory" : "mail";

  let facilityId = clean(input.facilityId, 80);
  let facilityName: string;
  let facilityCreated = false;
  if (facilityId) {
    const found = await first(db, `SELECT facility_id, company_name FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL`, [facilityId]);
    if (!found) throw Object.assign(new Error("업체를 찾을 수 없습니다. 다시 골라 주세요."), { status: 400 });
    facilityName = String(found.company_name);
  } else {
    const companyName = clean(input.newFacility?.companyName, 120);
    if (!companyName) throw Object.assign(new Error("업체를 고르거나 새 업체명을 입력하세요."), { status: 400 });
    const key = companyKey(companyName);
    if (!key) throw Object.assign(new Error("업체명을 확인하세요."), { status: 400 });
    if (!input.forceNewFacility) {
      // 법인격·띄어쓰기만 다른 같은 이름이 있으면 먼저 보여 준다(중복 업체 방지).
      const same = rowsToObjects(await db.exec(
        `SELECT facility_id, company_name, region_sido, region_sigungu FROM facilities
          WHERE deleted_at IS NULL AND normalized_company_name LIKE '%' || $1 || '%' ORDER BY company_name LIMIT 30`,
        [key.slice(0, 40)]
      )).filter((r) => companyKey(String(r.company_name)) === key);
      if (same.length) {
        throw new QuickRegisterConflict(
          "같은 이름의 업체가 이미 있습니다. 목록에서 고르거나, 다른 곳이면 새로 만들기를 한 번 더 누르세요.",
          same.slice(0, 6).map((r) => ({
            facilityId: String(r.facility_id), companyName: String(r.company_name),
            region: [r.region_sido, r.region_sigungu].filter(Boolean).join(" ") || null, reason: "같은 이름",
          }))
        );
      }
    }
    const address = clean(input.newFacility?.address, 300);
    const homepage = clean(input.newFacility?.homepage, 300);
    const siteAddress = normalizeInput("site_address", address);
    const region = extractRegion(siteAddress);
    const normCompany = companyName.replace(/\s+/g, "").replace(/[\(\)（）]/g, "").trim().toLowerCase();
    facilityId = "facq_" + crypto.createHash("sha256").update(`${normCompany}|${userId}|${now}`).digest("hex").slice(0, 14);
    facilityName = companyName;
    await db.run(
      `INSERT INTO facilities
         (facility_id, company_name, site_address, phone_number, normalized_company_name, normalized_address,
          region_sido, region_sigungu, source, homepage_url, listing, trade_roles, created_at, updated_at, site_address_verbatim)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'quick-register',$9,'other','{}'::text[],$10,$10,true)`,
      [facilityId, companyName, address, normalizeInput("phone_number", clean(input.newFacility?.phone, 40)), normCompany,
        siteAddress?.replace(/\s+/g, " ").trim() ?? null, region.sido, region.sigungu, homepage, now]
    );
    await db.run(
      `INSERT INTO contact_quick_registrations (kind, facility_id, source, source_address, registered_by, registered_at)
       VALUES ('facility', $1, $2, $3, $4, $5)`,
      [facilityId, source, normalizeEmail(input.sourceAddress), userId, now]
    );
    await recordAuditLogInline(db, {
      actorUserId: userId,
      action: "facility_quick_create",
      targetTable: "facilities",
      targetId: facilityId,
      after: { companyName, siteAddress: address, homepage, source: "quick-register" },
    });
    facilityCreated = true;
  }

  let departmentId: number | null = null;
  const departmentName = clean(input.person?.departmentName, 100);
  if (departmentName) {
    const found = await first(db, `SELECT id FROM facility_contact_departments WHERE facility_id = $1 AND department_name = $2 ORDER BY id LIMIT 1`, [facilityId, departmentName]);
    departmentId = found
      ? Number(found.id)
      : Number((await first(db,
        `INSERT INTO facility_contact_departments (facility_id, department_name, created_at, updated_at) VALUES ($1, $2, $3, $3) RETURNING id`,
        [facilityId, departmentName, now]))?.id ?? 0) || null;
  }
  const person = {
    title: clean(input.person?.title, 60),
    mobilePhone: clean(input.person?.mobilePhone, 40),
    officePhone: clean(input.person?.officePhone, 40),
  };
  const inserted = await first(db,
    `INSERT INTO facility_contact_people
       (facility_id, department_id, person_name, title, office_phone, mobile_phone, email, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$8) RETURNING id`,
    [facilityId, departmentId, personName, person.title, person.officePhone, person.mobilePhone, email, now]
  );
  const personId = Number(inserted?.id);
  const quick = await first(db,
    `INSERT INTO contact_quick_registrations (kind, facility_id, person_id, source, source_address, registered_by, registered_at)
     VALUES ('person', $1, $2, $3, $4, $5, $6) RETURNING quick_id`,
    [facilityId, personId, source, normalizeEmail(input.sourceAddress), userId, now]
  );
  await recordAuditLogInline(db, {
    actorUserId: userId,
    action: "facility_contact_person_quick_create",
    targetTable: "facility_contact_people",
    targetId: String(personId),
    after: { facilityId, personName, ...person, email, departmentName, source },
  });
  return { facilityId, facilityName, personId, facilityCreated, quickPersonId: Number(quick?.quick_id) };
}

export interface QuickItem {
  quickId: number;
  kind: QuickKind;
  status: QuickStatus;
  facilityId: string;
  facilityName: string;
  facilityBrn: string | null;
  facilityAddress: string | null;
  personId: number | null;
  personName: string | null;
  title: string | null;
  departmentName: string | null;
  mobilePhone: string | null;
  officePhone: string | null;
  email: string | null;
  sourceAddress: string | null;
  registeredBy: string;
  registeredByName: string | null;
  registeredAt: string;
  requestedAt: string | null;
  requestedByName: string | null;
  requestNote: string | null;
  completedAt: string | null;
  completedByName: string | null;
}

const ITEM_SQL = `
  SELECT q.quick_id, q.kind, q.status, q.facility_id, f.company_name, f.business_registration_no, f.site_address,
         q.person_id, p.person_name, p.title, d.department_name, p.mobile_phone, p.office_phone, p.email,
         q.source_address, q.registered_by, q.registered_at, q.requested_at, q.request_note, q.completed_at,
         COALESCE(re.name, ru.name) AS registered_by_name,
         COALESCE(qe.name, qu.name) AS requested_by_name,
         COALESCE(ce.name, cu.name) AS completed_by_name
    FROM contact_quick_registrations q
    JOIN facilities f ON f.facility_id = q.facility_id AND f.deleted_at IS NULL
    LEFT JOIN facility_contact_people p ON p.id = q.person_id
    LEFT JOIN facility_contact_departments d ON d.id = p.department_id
    LEFT JOIN users ru ON ru.user_id = q.registered_by
    LEFT JOIN employee_profiles re ON re.user_id = q.registered_by
    LEFT JOIN users qu ON qu.user_id = q.requested_by
    LEFT JOIN employee_profiles qe ON qe.user_id = q.requested_by
    LEFT JOIN users cu ON cu.user_id = q.completed_by
    LEFT JOIN employee_profiles ce ON ce.user_id = q.completed_by
   WHERE (q.kind = 'facility' OR p.id IS NOT NULL)`;

function toItem(r: Record<string, unknown>): QuickItem {
  return {
    quickId: Number(r.quick_id),
    kind: String(r.kind) as QuickKind,
    status: String(r.status) as QuickStatus,
    facilityId: String(r.facility_id),
    facilityName: String(r.company_name ?? ""),
    facilityBrn: text(r.business_registration_no),
    facilityAddress: text(r.site_address),
    personId: r.person_id != null ? Number(r.person_id) : null,
    personName: text(r.person_name),
    title: text(r.title),
    departmentName: text(r.department_name),
    mobilePhone: text(r.mobile_phone),
    officePhone: text(r.office_phone),
    email: text(r.email),
    sourceAddress: text(r.source_address),
    registeredBy: String(r.registered_by),
    registeredByName: text(r.registered_by_name),
    registeredAt: String(r.registered_at),
    requestedAt: text(r.requested_at),
    requestedByName: text(r.requested_by_name),
    requestNote: text(r.request_note),
    completedAt: text(r.completed_at),
    completedByName: text(r.completed_by_name),
  };
}

/** 간이 등록 목록. 관리자는 전체, 그 외 직원은 자기가 등록한 것만. 처리 중(open)은 pending·requested. */
export async function listQuickRegistrations(
  db: PgDatabase,
  opts: { userId: string; all: boolean; status: "open" | "done" }
): Promise<{ items: QuickItem[]; counts: { open: number; done: number } }> {
  const mine = opts.all ? "" : ` AND q.registered_by = $1`;
  const params: unknown[] = opts.all ? [] : [opts.userId];
  const statusSql = opts.status === "done" ? ` AND q.status = 'done'` : ` AND q.status <> 'done'`;
  const items = rowsToObjects(await db.exec(
    `${ITEM_SQL}${mine}${statusSql}
     ORDER BY q.registered_at DESC, q.quick_id DESC LIMIT 500`, params
  )).map(toItem);
  const counts = { open: 0, done: 0 };
  for (const r of rowsToObjects(await db.exec(
    `SELECT CASE WHEN q.status = 'done' THEN 'done' ELSE 'open' END AS bucket, COUNT(*)::int AS n
       FROM contact_quick_registrations q
       JOIN facilities f ON f.facility_id = q.facility_id AND f.deleted_at IS NULL
       LEFT JOIN facility_contact_people p ON p.id = q.person_id
      WHERE (q.kind = 'facility' OR p.id IS NOT NULL)${mine}
      GROUP BY 1`, params
  ))) counts[String(r.bucket) as "open" | "done"] = Number(r.n);
  return { items, counts };
}

export async function getQuickRegistration(db: PgDatabase, quickId: number): Promise<QuickItem | null> {
  const row = await first(db, `${ITEM_SQL} AND q.quick_id = $1`, [quickId]);
  return row ? toItem(row) : null;
}

/** 관리자 확정 — 업체는 상세 정보를 넣은 뒤, 담당자는 정보가 충분하다고 볼 때. */
export async function confirmQuick(db: PgDatabase, quickId: number, userId: string): Promise<QuickItem> {
  const item = await getQuickRegistration(db, quickId);
  if (!item) throw Object.assign(new Error("간이 등록을 찾을 수 없습니다."), { status: 404 });
  if (item.status === "done") return item;
  const now = new Date().toISOString();
  await db.run(`UPDATE contact_quick_registrations SET status = 'done', completed_by = $2, completed_at = $3 WHERE quick_id = $1`, [quickId, userId, now]);
  await recordAuditLogInline(db, {
    actorUserId: userId, action: "contact_quick_confirm", targetTable: "contact_quick_registrations", targetId: String(quickId),
    before: { status: item.status }, after: { status: "done", kind: item.kind, facilityId: item.facilityId, personId: item.personId },
  });
  return { ...item, status: "done", completedAt: now };
}

/** 보완 화면 경로 — 메신저·알림의 링크. */
export function supplementHref(quickId: number): string {
  return `/external-parties/quick?item=${quickId}`;
}

export interface DetailRequestResult { item: QuickItem; roomId: number; messageId: number; recipientId: string }

/**
 * 담당자 상세정보 등록 요청 — 등록한 직원에게 메신저 DM(업체 카드 첨부)을 보낸다. 웹 알림·푸시는 호출부가 트랜잭션 밖에서 보낸다.
 * 본인이 등록한 것에는 요청하지 않는다(DM 은 다른 수신자가 필요하다).
 */
export async function requestPersonDetails(db: PgDatabase, quickId: number, adminId: string, note: string | null): Promise<DetailRequestResult> {
  const item = await getQuickRegistration(db, quickId);
  if (!item) throw Object.assign(new Error("간이 등록을 찾을 수 없습니다."), { status: 404 });
  if (item.kind !== "person") throw Object.assign(new Error("상세정보 요청은 담당자에만 보낼 수 있습니다."), { status: 400 });
  if (item.status === "done") throw Object.assign(new Error("이미 완료된 담당자입니다."), { status: 409 });
  if (item.registeredBy === adminId) throw Object.assign(new Error("본인이 등록한 담당자입니다. 목록에서 바로 보완하세요."), { status: 400 });
  const cleanNote = clean(note, 500);
  const who = [item.personName, item.title].filter(Boolean).join(" ");
  const body = [
    `[주소록 상세정보 요청] ${item.facilityName} ${who} 담당자를 간이 등록해 주셨습니다.`,
    "부서·휴대폰·사무실 전화·이메일 등 아는 정보를 보완해 주세요.",
    cleanNote ? `요청 메모: ${cleanNote}` : null,
    `PC에서 열기: ${supplementHref(quickId)} (기타 업체·기관 > 간이 등록)`,
  ].filter(Boolean).join("\n");
  const sent = await postDirectSharedRecordInTransaction(db, adminId, item.registeredBy, body, {
    type: "facility", id: item.facilityId, title: item.facilityName, href: `/facility/${encodeURIComponent(item.facilityId)}`,
  });
  const now = new Date().toISOString();
  await db.run(
    `UPDATE contact_quick_registrations SET status = 'requested', requested_by = $2, requested_at = $3, request_note = $4 WHERE quick_id = $1`,
    [quickId, adminId, now, cleanNote]
  );
  await recordAuditLogInline(db, {
    actorUserId: adminId, action: "contact_quick_request", targetTable: "contact_quick_registrations", targetId: String(quickId),
    after: { recipient: item.registeredBy, roomId: sent.roomId, messageId: sent.messageId, note: cleanNote },
  });
  return { item: { ...item, status: "requested", requestedAt: now, requestNote: cleanNote }, ...sent, recipientId: item.registeredBy };
}

export interface SupplementInput {
  personName?: string | null; title?: string | null; departmentName?: string | null;
  mobilePhone?: string | null; officePhone?: string | null; email?: string | null;
}

/** 등록 직원(또는 관리자)이 담당자 정보를 보완한다. 저장하면 간이 표시가 끝난다. */
export async function supplementPerson(db: PgDatabase, quickId: number, userId: string, input: SupplementInput): Promise<QuickItem> {
  const item = await getQuickRegistration(db, quickId);
  if (!item || item.kind !== "person" || item.personId == null) throw Object.assign(new Error("간이 등록 담당자를 찾을 수 없습니다."), { status: 404 });
  const personName = clean(input.personName, 100);
  if (!personName) throw Object.assign(new Error("담당자 이름을 입력하세요."), { status: 400 });
  const email = input.email && String(input.email).trim() ? normalizeEmail(input.email) : null;
  if (input.email && String(input.email).trim() && !email) throw Object.assign(new Error("이메일 형식이 올바르지 않습니다."), { status: 400 });
  const now = new Date().toISOString();
  let departmentId: number | null = null;
  const departmentName = clean(input.departmentName, 100);
  if (departmentName) {
    const found = await first(db, `SELECT id FROM facility_contact_departments WHERE facility_id = $1 AND department_name = $2 ORDER BY id LIMIT 1`, [item.facilityId, departmentName]);
    departmentId = found
      ? Number(found.id)
      : Number((await first(db,
        `INSERT INTO facility_contact_departments (facility_id, department_name, created_at, updated_at) VALUES ($1, $2, $3, $3) RETURNING id`,
        [item.facilityId, departmentName, now]))?.id ?? 0) || null;
  }
  const after = {
    personName, title: clean(input.title, 60), departmentId, mobilePhone: clean(input.mobilePhone, 40), officePhone: clean(input.officePhone, 40), email,
  };
  await db.run(
    `UPDATE facility_contact_people SET person_name = $2, title = $3, department_id = $4, mobile_phone = $5, office_phone = $6, email = $7, updated_at = $8
      WHERE id = $1`,
    [item.personId, after.personName, after.title, after.departmentId, after.mobilePhone, after.officePhone, after.email, now]
  );
  await db.run(`UPDATE contact_quick_registrations SET status = 'done', completed_by = $2, completed_at = $3 WHERE quick_id = $1`, [quickId, userId, now]);
  await recordAuditLogInline(db, {
    actorUserId: userId, action: "facility_contact_person_update", targetTable: "facility_contact_people", targetId: String(item.personId),
    before: { personName: item.personName, title: item.title, departmentName: item.departmentName, mobilePhone: item.mobilePhone, officePhone: item.officePhone, email: item.email },
    after: { ...after, departmentName, quickId },
  });
  return (await getQuickRegistration(db, quickId))!;
}
