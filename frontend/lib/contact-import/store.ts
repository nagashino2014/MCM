/**
 * 연락처 가져오기 저장 — 대기 명단 적재, 회사 분류 반영, 기관 → 거래처 전환.
 * 거래처(매출·매입)만 사업장 마스터에 들어가고, 그 외는 기관 목록(external_organizations)에 둔다.
 */
import crypto from "node:crypto";
import { rowsToObjects, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { formatCompanyName, normalizeAddress } from "@/lib/ieps/formatters";
import { markReviewedWrite } from "@/lib/ieps/facility-update";
import { normalizeInput } from "@scraper/lib/facility-quality/rules";
import { extractRegion } from "@scraper/lib/ieps/region";
import {
  autoLinkTarget, buildFacilityIndex, companyDomain, companyKey, contactDedupeKey, matchFacilities, regionOf, suggestCategory,
  type FacilityRef, type MatchCandidate,
} from "@scraper/lib/contact-import/rules";
import type { ImportedContact, ParsedContactFile } from "./amaranth-xlsx";

export const TRADE_ROLES = ["sales", "purchase"] as const;
export type TradeRole = (typeof TRADE_ROLES)[number];
export type CompanyDecision = "link" | "partner" | "organization" | "exclude";

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const first = async (db: PgDatabase, sql: string, params: unknown[] = []) => rowsToObjects(await db.exec(sql, params))[0];
const toText = (value: unknown): string | null => (value == null || value === "" ? null : String(value));

export async function loadFacilityRefs(db: PgDatabase): Promise<FacilityRef[]> {
  const facilities = rowsToObjects(await db.exec(
    `SELECT facility_id, company_name, site_address, business_registration_no FROM facilities WHERE deleted_at IS NULL`
  ));
  const aliases = new Map<string, string[]>();
  for (const row of rowsToObjects(await db.exec(`SELECT facility_id, alias FROM facility_aliases`))) {
    const id = String(row.facility_id);
    aliases.set(id, [...(aliases.get(id) ?? []), String(row.alias)]);
  }
  return facilities.map((f) => ({
    facilityId: String(f.facility_id),
    companyName: String(f.company_name),
    address: toText(f.site_address),
    brn: toText(f.business_registration_no),
    aliases: aliases.get(String(f.facility_id)) ?? [],
  }));
}

export interface IngestResult { batchId: string; newCount: number; duplicateCount: number; newCompanies: number; searchNeeded: boolean }

/**
 * 파일 한 개를 대기 명단에 넣는다. 같은 회사·같은 사람은 합치고, 빈 칸만 채운다.
 * 이미 분류가 끝난 회사의 새 담당자는 그 분류대로 바로 옮긴다.
 */
export async function ingestContactFile(
  db: PgDatabase,
  args: { filename: string; sha256: string; userId: string; file: ParsedContactFile; facilities: FacilityRef[] }
): Promise<IngestResult> {
  const { filename, sha256, userId, file } = args;
  const now = new Date().toISOString();
  const batchId = "cib_" + hash(`${sha256}|${userId}|${now}`).slice(0, 20);
  await db.run(
    `INSERT INTO contact_import_batches (batch_id, original_filename, file_sha256, uploaded_by, uploaded_at, row_count)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [batchId, filename, sha256, userId, now, file.totalRows]
  );
  const index = buildFacilityIndex(args.facilities);
  const groups = new Map<string, ImportedContact[]>();
  for (const contact of file.contacts) {
    const key = companyKey(contact.companyName);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), contact]);
  }
  let newCount = 0;
  let duplicateCount = 0;
  let newCompanies = 0;
  let searchNeeded = false;
  for (const [key, contacts] of groups) {
    const companyId = "cic_" + hash(key).slice(0, 20);
    let company = await first(db, `SELECT company_id, decision FROM contact_import_companies WHERE company_id = $1`, [companyId]);
    if (!company) {
      newCompanies += 1;
      const displayName = mostCommon(contacts.map((c) => c.companyName))!;
      const address = mostCommon(contacts.map((c) => c.address));
      const homepage = mostCommon(contacts.map((c) => c.homepage));
      const emailDomain = mostCommon(contacts.map((c) => companyDomain(c.email)));
      const phone = mostCommon(contacts.map((c) => c.officePhone));
      const region = regionOf(address);
      const candidates = matchFacilities(displayName, address, index);
      // 이름이 같은 사업장이 이미 있으면 외부 조회 한도를 쓰지 않는다. 앞부분·주소만 맞으면 번호로 확인한다.
      const nameMatched = candidates.some((c) => c.kind === "name_region" || c.kind === "name");
      if (!nameMatched) searchNeeded = true;
      await db.run(
        `INSERT INTO contact_import_companies
           (company_id, normalized_name, display_name, address, region_sido, region_sigungu, phone_number, homepage_url,
            email_domain, suggested_category, match_candidates, search_status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$13)`,
        [companyId, key, displayName, address, region.sido, region.sigungu, phone, homepage, emailDomain,
          suggestCategory(displayName), JSON.stringify(candidates), nameMatched ? "done" : "pending", now]
      );
      company = { company_id: companyId, decision: null };
    }
    for (const contact of contacts) {
      const dedupeKey = contactDedupeKey(key, contact.personName, contact.mobilePhone, contact.email);
      const inserted = rowsToObjects(await db.exec(
        `INSERT INTO contact_import_rows
           (batch_id, company_id, dedupe_key, person_name, title, department, office_phone, mobile_phone, fax_number, email, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
         ON CONFLICT (dedupe_key) DO UPDATE SET
           title = COALESCE(contact_import_rows.title, EXCLUDED.title),
           department = COALESCE(contact_import_rows.department, EXCLUDED.department),
           office_phone = COALESCE(contact_import_rows.office_phone, EXCLUDED.office_phone),
           mobile_phone = COALESCE(contact_import_rows.mobile_phone, EXCLUDED.mobile_phone),
           fax_number = COALESCE(contact_import_rows.fax_number, EXCLUDED.fax_number),
           email = COALESCE(contact_import_rows.email, EXCLUDED.email),
           updated_at = EXCLUDED.updated_at
         RETURNING (xmax = 0) AS is_new`,
        [batchId, companyId, dedupeKey, contact.personName, contact.title, contact.department,
          contact.officePhone, contact.mobilePhone, contact.faxNumber, contact.email, now]
      ));
      if (inserted[0]?.is_new === true || inserted[0]?.is_new === "t") newCount += 1;
      else duplicateCount += 1;
    }
    if (company.decision && company.decision !== "exclude") await moveCompanyContacts(db, companyId, now);
  }
  await db.run(`UPDATE contact_import_batches SET new_count = $2, duplicate_count = $3 WHERE batch_id = $1`, [batchId, newCount, duplicateCount]);
  await recordAuditLogInline(db, {
    actorUserId: userId,
    action: "contact_import_upload",
    targetTable: "contact_import_batches",
    targetId: batchId,
    after: { filename, totalRows: file.totalRows, newCount, duplicateCount, newCompanies },
  });
  return { batchId, newCount, duplicateCount, newCompanies, searchNeeded };
}

function mostCommon(values: (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) if (count > bestCount) { best = value; bestCount = count; }
  return best;
}

interface ContactFields {
  person_name: unknown; title: unknown; department: unknown; office_phone: unknown; mobile_phone: unknown; fax_number: unknown; email: unknown;
}

/** 사업장 담당자에 넣는다. 명함 등록과 같은 기준으로 같은 사람은 갱신한다(이름 + 휴대폰). */
export async function addFacilityContact(db: PgDatabase, facilityId: string, c: ContactFields, now: string): Promise<void> {
  const name = String(c.person_name);
  const department = toText(c.department);
  const mobile = toText(c.mobile_phone);
  let departmentId: number | null = null;
  if (department) {
    const found = await first(db, `SELECT id FROM facility_contact_departments WHERE facility_id = $1 AND department_name = $2 LIMIT 1`, [facilityId, department]);
    if (found) departmentId = Number(found.id);
    else {
      const created = await first(db,
        `INSERT INTO facility_contact_departments (facility_id, department_name, fax_number, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $4) RETURNING id`, [facilityId, department, toText(c.fax_number), now]);
      departmentId = Number(created?.id ?? 0) || null;
    }
  }
  const existing = rowsToObjects(await db.exec(
    `SELECT id, mobile_phone FROM facility_contact_people WHERE facility_id = $1 AND person_name = $2 AND status <> 'inactive' ORDER BY id ASC`,
    [facilityId, name]
  ));
  const digits = (mobile ?? "").replace(/\D/g, "");
  const match = existing.find((p) => {
    const old = String(p.mobile_phone ?? "").replace(/\D/g, "");
    return !old || !digits || old === digits;
  });
  if (match) {
    // 사람이 고친 값을 덮지 않도록 빈 칸만 채운다.
    await db.run(
      `UPDATE facility_contact_people SET title = COALESCE(title, $2), department_id = COALESCE(department_id, $3),
         mobile_phone = COALESCE(mobile_phone, $4), office_phone = COALESCE(office_phone, $5), email = COALESCE(email, $6), updated_at = $7
       WHERE id = $1`,
      [Number(match.id), toText(c.title), departmentId, mobile, toText(c.office_phone), toText(c.email), now]
    );
    return;
  }
  await db.run(
    `INSERT INTO facility_contact_people
       (facility_id, department_id, person_name, title, office_phone, mobile_phone, email, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$8)`,
    [facilityId, departmentId, name, toText(c.title), toText(c.office_phone), mobile, toText(c.email), now]
  );
}

async function addOrgContact(db: PgDatabase, orgId: string, c: ContactFields, now: string): Promise<void> {
  const digits = String(c.mobile_phone ?? "").replace(/\D/g, "");
  const existing = rowsToObjects(await db.exec(`SELECT id, mobile_phone FROM external_org_contacts WHERE org_id = $1 AND person_name = $2`, [orgId, String(c.person_name)]));
  const match = existing.find((p) => {
    const old = String(p.mobile_phone ?? "").replace(/\D/g, "");
    return !old || !digits || old === digits;
  });
  if (match) {
    await db.run(
      `UPDATE external_org_contacts SET title = COALESCE(title, $2), department = COALESCE(department, $3), office_phone = COALESCE(office_phone, $4),
         mobile_phone = COALESCE(mobile_phone, $5), fax_number = COALESCE(fax_number, $6), email = COALESCE(email, $7), updated_at = $8 WHERE id = $1`,
      [Number(match.id), toText(c.title), toText(c.department), toText(c.office_phone), toText(c.mobile_phone), toText(c.fax_number), toText(c.email), now]
    );
    return;
  }
  await db.run(
    `INSERT INTO external_org_contacts (org_id, person_name, title, department, office_phone, mobile_phone, fax_number, email, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)`,
    [orgId, String(c.person_name), toText(c.title), toText(c.department), toText(c.office_phone), toText(c.mobile_phone), toText(c.fax_number), toText(c.email), now]
  );
}

/** 분류가 끝난 회사의 대기 담당자를 분류 대상으로 옮긴다. */
async function moveCompanyContacts(db: PgDatabase, companyId: string, now: string): Promise<number> {
  const company = await first(db, `SELECT decision, decided_facility_id, decided_org_id FROM contact_import_companies WHERE company_id = $1`, [companyId]);
  if (!company?.decision || company.decision === "exclude") return 0;
  const pending = rowsToObjects(await db.exec(
    `SELECT id, person_name, title, department, office_phone, mobile_phone, fax_number, email
       FROM contact_import_rows WHERE company_id = $1 AND status = 'pending' ORDER BY id`, [companyId]
  ));
  for (const row of pending) {
    if (company.decision === "organization") await addOrgContact(db, String(company.decided_org_id), row as unknown as ContactFields, now);
    else await addFacilityContact(db, String(company.decided_facility_id), row as unknown as ContactFields, now);
    await db.run(`UPDATE contact_import_rows SET status = 'imported', updated_at = $2 WHERE id = $1`, [Number(row.id), now]);
  }
  return pending.length;
}

interface PartnerInput {
  companyName: string; brn: string | null; crn?: string | null; address: string | null; phone: string | null; homepage: string | null;
  orgCategory: string | null; tradeRoles: TradeRole[]; userId: string; now: string;
}

/** 거래처를 사업장 마스터에 등록한다. 번호나 상호·소재지가 같은 사업장이 있으면 그 사업장을 쓴다. */
export async function registerPartnerFacility(db: PgDatabase, input: PartnerInput): Promise<{ facilityId: string; created: boolean }> {
  await markReviewedWrite(db);
  const companyName = formatCompanyName(input.companyName) ?? input.companyName.trim();
  const normCompany = companyName.replace(/\s+/g, "").replace(/[\(\)（）]/g, "").trim().toLowerCase();
  const siteAddress = normalizeInput("site_address", input.address);
  const normAddress = siteAddress?.replace(/\s+/g, " ").trim() ?? normalizeAddress(input.address);
  const brn = normalizeInput("business_registration_no", input.brn);
  const existing = brn
    ? await first(db, `SELECT facility_id FROM facilities WHERE business_registration_no = $1 AND deleted_at IS NULL LIMIT 1`, [brn])
    : normAddress
      ? await first(db, `SELECT facility_id FROM facilities WHERE normalized_company_name = $1 AND normalized_address = $2 AND deleted_at IS NULL LIMIT 1`, [normCompany, normAddress])
      : undefined;
  if (existing) {
    const facilityId = String(existing.facility_id);
    await mergeFacilityExtras(db, facilityId, input);
    return { facilityId, created: false };
  }
  const facilityId = "facm_" + hash(`${normCompany}|${brn ?? ""}|${input.now}`).slice(0, 14);
  const region = extractRegion(siteAddress);
  await db.run(
    `INSERT INTO facilities
       (facility_id, company_name, business_registration_no, corporate_registration_no, site_address, phone_number,
        normalized_company_name, normalized_address, region_sido, region_sigungu, source, org_category, trade_roles,
        homepage_url, created_at, updated_at, site_address_verbatim)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'contact-import',$11,$12::text[],$13,$14,$14,true)`,
    [facilityId, companyName, brn, normalizeInput("corporate_registration_no", input.crn ?? null), input.address, normalizeInput("phone_number", input.phone),
      normCompany, normAddress, region.sido, region.sigungu, input.orgCategory, input.tradeRoles, input.homepage, input.now]
  );
  await recordAuditLogInline(db, {
    actorUserId: input.userId,
    action: "facility_manual_create",
    targetTable: "facilities",
    targetId: facilityId,
    after: { companyName, businessRegistrationNo: brn, siteAddress: input.address, source: "contact-import", tradeRoles: input.tradeRoles },
  });
  return { facilityId, created: true };
}

/** 거래 구분을 더한다. 거래처 판정(FACILITY_PARTNER_SQL)이 이 값을 본다. */
export async function addFacilityTradeRoles(db: PgDatabase, facilityId: string, roles: TradeRole[], now: string): Promise<void> {
  await db.run(
    `UPDATE facilities SET trade_roles = ARRAY(SELECT DISTINCT unnest(COALESCE(trade_roles, '{}'::text[]) || $2::text[])), updated_at = $3 WHERE facility_id = $1`,
    [facilityId, roles, now]
  );
}

/** 기존 사업장에는 거래 구분을 더하고 비어 있는 홈페이지·연락처 구분만 채운다. */
async function mergeFacilityExtras(db: PgDatabase, facilityId: string, input: Pick<PartnerInput, "tradeRoles" | "homepage" | "orgCategory" | "now">): Promise<void> {
  await db.run(
    `UPDATE facilities SET
       trade_roles = ARRAY(SELECT DISTINCT unnest(COALESCE(trade_roles, '{}'::text[]) || $2::text[])),
       homepage_url = COALESCE(NULLIF(TRIM(COALESCE(homepage_url, '')), ''), $3),
       org_category = COALESCE(org_category, $4),
       updated_at = $5
     WHERE facility_id = $1`,
    [facilityId, input.tradeRoles, input.homepage, input.orgCategory, input.now]
  );
}

export interface DecisionItem {
  companyId: string;
  action: CompanyDecision | "reopen";
  facilityId?: string | null;
  tradeRoles?: string[];
  orgCategory?: string | null;
}

/**
 * 관리자 분류 한 건. link 는 후보가 하나로 정해질 때만 facilityId 없이 쓸 수 있다.
 * reopen 은 제외·기관 목록만 되돌린다. 사업장 마스터에 넣은 것은 사업장 화면에서 고친다.
 */
export async function decideCompany(db: PgDatabase, item: DecisionItem, userId: string): Promise<{ status: "ok" | "skipped"; reason?: string; moved?: number }> {
  const now = new Date().toISOString();
  const company = await first(db, `SELECT * FROM contact_import_companies WHERE company_id = $1 FOR UPDATE`, [item.companyId]);
  if (!company) return { status: "skipped", reason: "회사를 찾을 수 없습니다" };
  if (item.action === "reopen") {
    if (company.decision !== "exclude" && company.decision !== "organization") return { status: "skipped", reason: "사업장에 연결한 회사는 되돌릴 수 없습니다" };
    if (company.decision === "organization" && company.decided_org_id) {
      const org = await first(db, `SELECT promoted_facility_id, source FROM external_organizations WHERE org_id = $1`, [company.decided_org_id]);
      if (org?.promoted_facility_id) return { status: "skipped", reason: "이미 거래처로 전환한 기관입니다" };
      const names = rowsToObjects(await db.exec(`SELECT person_name FROM contact_import_rows WHERE company_id = $1 AND status = 'imported'`, [item.companyId]));
      for (const row of names) await db.run(`DELETE FROM external_org_contacts WHERE org_id = $1 AND person_name = $2`, [company.decided_org_id, row.person_name]);
      const left = await first(db, `SELECT COUNT(*)::int AS n FROM external_org_contacts WHERE org_id = $1`, [company.decided_org_id]);
      if (Number(left?.n ?? 0) === 0 && org?.source === "contact-import") {
        await db.run(`UPDATE external_organizations SET deleted_at = $2, updated_at = $2 WHERE org_id = $1`, [company.decided_org_id, now]);
      }
    }
    await db.run(`UPDATE contact_import_rows SET status = 'pending', updated_at = $2 WHERE company_id = $1`, [item.companyId, now]);
    await db.run(`UPDATE contact_import_companies SET decision = NULL, decided_facility_id = NULL, decided_org_id = NULL, decided_by = NULL, decided_at = NULL, updated_at = $2 WHERE company_id = $1`, [item.companyId, now]);
    return { status: "ok" };
  }
  if (company.decision) return { status: "skipped", reason: "이미 분류한 회사입니다" };
  const roles = (item.tradeRoles ?? []).filter((r): r is TradeRole => (TRADE_ROLES as readonly string[]).includes(r));
  const category = toText(item.orgCategory) ?? toText(company.suggested_category);
  const homepage = toText(company.homepage_url);
  let facilityId: string | null = null;
  let orgId: string | null = null;
  if (item.action === "link") {
    const candidates = (company.match_candidates ?? []) as MatchCandidate[];
    facilityId = toText(item.facilityId) ?? autoLinkTarget(candidates);
    if (!facilityId) return { status: "skipped", reason: "연결할 사업장을 골라 주세요" };
    const facility = await first(db, `SELECT facility_id FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL`, [facilityId]);
    if (!facility) return { status: "skipped", reason: "사업장을 찾을 수 없습니다" };
    await mergeFacilityExtras(db, facilityId, { tradeRoles: roles, homepage, orgCategory: null, now });
  } else if (item.action === "partner") {
    if (!roles.length) return { status: "skipped", reason: "매출·매입 중 거래 구분을 골라 주세요" };
    const created = await registerPartnerFacility(db, {
      companyName: String(company.display_name), brn: toText(company.found_brn), crn: toText(company.found_crn), address: toText(company.address),
      phone: toText(company.phone_number), homepage, orgCategory: category, tradeRoles: roles, userId, now,
    });
    facilityId = created.facilityId;
  } else if (item.action === "organization") {
    orgId = await upsertOrganization(db, {
      name: String(company.display_name), category, brn: toText(company.found_brn), crn: toText(company.found_crn), address: toText(company.address),
      phone: toText(company.phone_number), homepage, source: "contact-import", userId, now,
    });
  }
  await db.run(
    `UPDATE contact_import_companies SET decision = $2, decided_facility_id = $3, decided_org_id = $4, decided_by = $5, decided_at = $6, updated_at = $6 WHERE company_id = $1`,
    [item.companyId, item.action, facilityId, orgId, userId, now]
  );
  const moved = await moveCompanyContacts(db, item.companyId, now);
  await recordAuditLogInline(db, {
    actorUserId: userId,
    action: "contact_import_decide",
    targetTable: "contact_import_companies",
    targetId: item.companyId,
    after: { decision: item.action, facilityId, orgId, tradeRoles: roles, moved },
  });
  return { status: "ok", moved };
}

export interface OrganizationInput {
  name: string; category: string | null; brn: string | null; crn?: string | null; address: string | null; phone: string | null;
  homepage: string | null; memo?: string | null; source: "manual" | "contact-import"; userId: string; now: string;
}

/** 같은 이름의 기관이 있으면 빈 칸만 채워 그 기관을 쓴다. */
export async function upsertOrganization(db: PgDatabase, input: OrganizationInput): Promise<string> {
  const key = companyKey(input.name);
  const region = regionOf(input.address);
  const found = await first(db, `SELECT org_id FROM external_organizations WHERE normalized_name = $1 AND deleted_at IS NULL`, [key]);
  if (found) {
    await db.run(
      `UPDATE external_organizations SET org_category = COALESCE(org_category, $2), business_registration_no = COALESCE(business_registration_no, $3),
         corporate_registration_no = COALESCE(corporate_registration_no, $4), address = COALESCE(address, $5), region_sido = COALESCE(region_sido, $6),
         region_sigungu = COALESCE(region_sigungu, $7), phone_number = COALESCE(phone_number, $8), homepage_url = COALESCE(homepage_url, $9), updated_at = $10
       WHERE org_id = $1`,
      [found.org_id, input.category, input.brn, input.crn ?? null, input.address, region.sido, region.sigungu, input.phone, input.homepage, input.now]
    );
    return String(found.org_id);
  }
  const orgId = "org_" + hash(`${key}|${input.now}`).slice(0, 18);
  await db.run(
    `INSERT INTO external_organizations
       (org_id, org_name, normalized_name, org_category, business_registration_no, corporate_registration_no, address, region_sido, region_sigungu,
        phone_number, homepage_url, memo, source, created_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
    [orgId, input.name.trim(), key, input.category, input.brn, input.crn ?? null, input.address, region.sido, region.sigungu,
      input.phone, input.homepage, input.memo ?? null, input.source, input.userId, input.now]
  );
  return orgId;
}

/** 기관이 거래처가 되면 사업장 마스터로 옮긴다. 담당자도 함께 옮기고 기관은 목록에서 뺀다. */
export async function promoteOrganization(db: PgDatabase, orgId: string, tradeRoles: TradeRole[], userId: string): Promise<{ facilityId: string; created: boolean }> {
  const now = new Date().toISOString();
  const org = await first(db, `SELECT * FROM external_organizations WHERE org_id = $1 AND deleted_at IS NULL FOR UPDATE`, [orgId]);
  if (!org) throw new Error("기관을 찾을 수 없습니다.");
  const registered = await registerPartnerFacility(db, {
    companyName: String(org.org_name), brn: toText(org.business_registration_no), crn: toText(org.corporate_registration_no), address: toText(org.address),
    phone: toText(org.phone_number), homepage: toText(org.homepage_url), orgCategory: toText(org.org_category), tradeRoles, userId, now,
  });
  const contacts = rowsToObjects(await db.exec(`SELECT person_name, title, department, office_phone, mobile_phone, fax_number, email FROM external_org_contacts WHERE org_id = $1 ORDER BY id`, [orgId]));
  for (const contact of contacts) await addFacilityContact(db, registered.facilityId, contact as unknown as ContactFields, now);
  await db.run(`UPDATE external_organizations SET promoted_facility_id = $2, deleted_at = $3, updated_at = $3 WHERE org_id = $1`, [orgId, registered.facilityId, now]);
  // 대기 명단에서 나중에 들어오는 담당자도 새 사업장으로 가게 한다.
  await db.run(`UPDATE contact_import_companies SET decision = 'partner', decided_facility_id = $2, decided_org_id = NULL, updated_at = $3 WHERE decided_org_id = $1`, [orgId, registered.facilityId, now]);
  await recordAuditLogInline(db, {
    actorUserId: userId,
    action: "organization_promote",
    targetTable: "external_organizations",
    targetId: orgId,
    after: { facilityId: registered.facilityId, created: registered.created, tradeRoles, contacts: contacts.length },
  });
  return registered;
}

export const COMPANY_STAGE_SQL = `CASE
  WHEN decision = 'exclude' THEN 'excluded'
  WHEN decision IS NOT NULL THEN 'done'
  WHEN jsonb_array_length(match_candidates) > 0 THEN 'connect'
  WHEN search_verdict = 'recommend' THEN 'recommend'
  WHEN search_status IN ('pending', 'running') THEN 'searching'
  WHEN search_verdict = 'review' OR search_status IN ('paused', 'attention') THEN 'review'
  ELSE 'not_found' END`;
export const COMPANY_STAGES = ["connect", "recommend", "review", "not_found", "searching", "done", "excluded"] as const;
export type CompanyStage = (typeof COMPANY_STAGES)[number];
