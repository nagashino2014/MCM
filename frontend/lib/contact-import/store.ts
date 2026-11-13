/**
 * 연락처 가져오기 저장 — 대기 명단 적재, 회사 분류 반영, 사업장 마스터·기타 목록 이동.
 * 기타 업체·기관도 facilities 행이다. 표시 구분은 queries.ts FACILITY_OTHER_SQL 이 정한다.
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
import { suggestPersonSite, type SiteKind, type SiteRef } from "./person-site";

export const TRADE_ROLES = ["sales", "purchase"] as const;
export type TradeRole = (typeof TRADE_ROLES)[number];
export type CompanyDecision = "link" | "partner" | "other" | "exclude";

const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const first = async (db: PgDatabase, sql: string, params: unknown[] = []) => rowsToObjects(await db.exec(sql, params))[0];
const toText = (value: unknown): string | null => (value == null || value === "" ? null : String(value));
const digitsOf = (value: unknown) => String(value ?? "").replace(/\D/g, "");

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
    // 이미 사업장으로 옮겨진 사람이 다른 직원 파일에서 다시 나오면, 새로 알게 된 값(이메일 등)을 사업장 담당자의 빈 칸에 채운다.
    const refilled: number[] = [];
    for (const contact of contacts) {
      const dedupeKey = contactDedupeKey(key, contact.personName, contact.mobilePhone, contact.email);
      const inserted = rowsToObjects(await db.exec(
        `INSERT INTO contact_import_rows
           (batch_id, company_id, dedupe_key, person_name, title, department, office_phone, mobile_phone, fax_number, email, address, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$12,$11,$11)
         ON CONFLICT (dedupe_key) DO UPDATE SET
           title = COALESCE(contact_import_rows.title, EXCLUDED.title),
           department = COALESCE(contact_import_rows.department, EXCLUDED.department),
           office_phone = COALESCE(contact_import_rows.office_phone, EXCLUDED.office_phone),
           mobile_phone = COALESCE(contact_import_rows.mobile_phone, EXCLUDED.mobile_phone),
           fax_number = COALESCE(contact_import_rows.fax_number, EXCLUDED.fax_number),
           email = COALESCE(contact_import_rows.email, EXCLUDED.email),
           address = COALESCE(contact_import_rows.address, EXCLUDED.address),
           updated_at = EXCLUDED.updated_at
         RETURNING id, status, (xmax = 0) AS is_new`,
        [batchId, companyId, dedupeKey, contact.personName, contact.title, contact.department,
          contact.officePhone, contact.mobilePhone, contact.faxNumber, contact.email, now, contact.address]
      ));
      if (inserted[0]?.is_new === true || inserted[0]?.is_new === "t") newCount += 1;
      else {
        duplicateCount += 1;
        if (inserted[0]?.status === "imported") refilled.push(Number(inserted[0].id));
      }
    }
    if (company.decision && company.decision !== "exclude") {
      await moveCompanyContacts(db, companyId, now);
      await refillImportedContacts(db, companyId, refilled, now);
    }
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

/**
 * 사업장 담당자에 넣는다. 명함 등록과 같은 기준으로 같은 사람은 갱신한다(이름 + 휴대폰).
 * fillOnly 면 같은 사람이 있을 때 빈 칸만 채우고, 없으면(사람이 지웠으면) 다시 만들지 않는다.
 */
export async function addFacilityContact(db: PgDatabase, facilityId: string, c: ContactFields, now: string, opts: { fillOnly?: boolean } = {}): Promise<void> {
  const name = String(c.person_name);
  const department = toText(c.department);
  const mobile = toText(c.mobile_phone);
  const departmentId = await facilityDepartmentId(db, facilityId, department, toText(c.fax_number), now, !opts.fillOnly);
  const match = await findFacilityPerson(db, facilityId, name, mobile);
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
  if (opts.fillOnly) return;
  await db.run(
    `INSERT INTO facility_contact_people
       (facility_id, department_id, person_name, title, office_phone, mobile_phone, email, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8,$8)`,
    [facilityId, departmentId, name, toText(c.title), toText(c.office_phone), mobile, toText(c.email), now]
  );
}

/** 사업장의 담당자 부서. 같은 이름이 없으면 create 일 때만 만든다. */
async function facilityDepartmentId(db: PgDatabase, facilityId: string, department: string | null, fax: string | null, now: string, create: boolean): Promise<number | null> {
  if (!department) return null;
  const found = await first(db, `SELECT id FROM facility_contact_departments WHERE facility_id = $1 AND department_name = $2 LIMIT 1`, [facilityId, department]);
  if (found) return Number(found.id);
  if (!create) return null;
  const created = await first(db,
    `INSERT INTO facility_contact_departments (facility_id, department_name, fax_number, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $4) RETURNING id`, [facilityId, department, fax, now]);
  return Number(created?.id ?? 0) || null;
}

/** 사업장 담당자 중 같은 사람(이름 + 휴대폰, 한쪽 휴대폰이 비었으면 이름만). 명함 등록과 같은 기준. */
async function findFacilityPerson(db: PgDatabase, facilityId: string, name: string, mobile: string | null): Promise<Record<string, unknown> | undefined> {
  const existing = rowsToObjects(await db.exec(
    `SELECT * FROM facility_contact_people WHERE facility_id = $1 AND person_name = $2 AND status <> 'inactive' ORDER BY id ASC`,
    [facilityId, name]
  ));
  const digits = digitsOf(mobile);
  return existing.find((p) => {
    const old = digitsOf(p.mobile_phone);
    return !old || !digits || old === digits;
  });
}

async function aliveFacilityIds(db: PgDatabase, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  return new Set(rowsToObjects(await db.exec(`SELECT facility_id FROM facilities WHERE facility_id = ANY($1::text[]) AND deleted_at IS NULL`, [ids])).map((r) => String(r.facility_id)));
}

export interface CompanySite extends SiteRef { kind: SiteKind; brn: string | null }

/** 회사 후보 중 다른 기관일 수 있는 것(앞부분·주소만 일치)은 담당자 배속 후보에서 뺀다. 직접 검색으로는 고를 수 있다. */
const SAME_COMPANY_MATCH_KINDS = new Set(["brn", "name_region", "name"]);

/**
 * 같은 회사의 사업장(산하 사업장) 후보. 근거는 강한 순서로
 * 회사에 고른 사업장 → 기존 사업장 후보(번호·이름 일치) → 법인등록번호 같음 → 사업자번호 같음 → 이름이 회사명으로 시작.
 * 이름 근거는 계열사(포스코 ↔ 포스코이앤씨)도 잡으므로 표시만 하고 지역만으로는 추천하지 않는다(person-site.ts).
 * extraIds 는 담당자가 이미 배속된 사업장 — 근거와 무관하게 목록에 남겨 이름을 보인다.
 */
export async function loadCompanySites(db: PgDatabase, company: Record<string, unknown>, extraIds: string[] = []): Promise<CompanySite[]> {
  const decided = toText(company.decided_facility_id);
  const candidateIds = ((company.match_candidates ?? []) as MatchCandidate[])
    .filter((c) => SAME_COMPANY_MATCH_KINDS.has(c.kind)).map((c) => c.facilityId);
  const seedIds = [...new Set([decided, ...candidateIds].filter((id): id is string => !!id))];
  const seeds = seedIds.length
    ? rowsToObjects(await db.exec(`SELECT business_registration_no, corporate_registration_no FROM facilities WHERE facility_id = ANY($1::text[]) AND deleted_at IS NULL`, [seedIds]))
    : [];
  // 번호는 하이픈 유무가 섞여 저장돼 있을 수 있어 숫자만 비교한다.
  const crns = [...new Set([...seeds.map((s) => digitsOf(s.corporate_registration_no)), digitsOf(company.found_crn)].filter((v) => v.length >= 10))];
  const brns = [...new Set([...seeds.map((s) => digitsOf(s.business_registration_no)), digitsOf(company.found_brn)].filter((v) => v.length >= 10))];
  const key = companyKey(String(company.display_name ?? ""));
  const rows = rowsToObjects(await db.exec(
    `SELECT facility_id, company_name, site_address, business_registration_no, corporate_registration_no
       FROM facilities
      WHERE deleted_at IS NULL
        AND (facility_id = ANY($1::text[])
             OR regexp_replace(COALESCE(corporate_registration_no, ''), '[^0-9]', '', 'g') = ANY($2::text[])
             OR regexp_replace(COALESCE(business_registration_no, ''), '[^0-9]', '', 'g') = ANY($3::text[])
             OR (length($4) >= 2 AND replace(lower(company_name), ' ', '') LIKE '%' || $4 || '%'))
      LIMIT 300`,
    [[...seedIds, ...extraIds], crns, brns, key]
  ));
  const order: SiteKind[] = ["decided", "candidate", "crn", "brn", "name", "chosen"];
  const sites: CompanySite[] = [];
  for (const r of rows) {
    const facilityId = String(r.facility_id);
    const kind: SiteKind | null = facilityId === decided ? "decided"
      : candidateIds.includes(facilityId) ? "candidate"
      : crns.includes(digitsOf(r.corporate_registration_no)) ? "crn"
      : brns.includes(digitsOf(r.business_registration_no)) ? "brn"
      : key.length >= 2 && companyKey(String(r.company_name)).startsWith(key) ? "name"
      : extraIds.includes(facilityId) ? "chosen"
      : null;
    if (!kind) continue;
    sites.push({ facilityId, companyName: String(r.company_name), address: toText(r.site_address), brn: toText(r.business_registration_no), kind });
  }
  return sites
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.companyName.localeCompare(b.companyName, "ko"))
    .slice(0, 60);
}

interface PendingRow extends ContactFields { id: unknown; address: unknown; facility_id: unknown }

/**
 * 분류가 끝난 회사의 대기 담당자를 사업장으로 옮긴다. 사업장이 삭제됐으면 다시 분류하도록 되돌린다.
 * 담당자별로 고른 사업장이 있으면 그곳으로, 없으면 부서명·주소로 산하 사업장 추천이 나올 때 그곳으로(자동 배속),
 * 둘 다 없으면 회사에 고른 사업장으로 넣는다. 고르거나 추천으로 정한 사업장은 행의 facility_id 에 남기고,
 * 회사 분류대로 들어간 사람은 NULL 로 둔다 — 나중에 [산하 사업장 자동 배속]은 NULL 인 사람만 옮긴다.
 */
async function moveCompanyContacts(db: PgDatabase, companyId: string, now: string): Promise<{ moved: number; autoAssigned: number }> {
  const company = await first(db, `SELECT * FROM contact_import_companies WHERE company_id = $1`, [companyId]);
  if (!company?.decision || company.decision === "exclude") return { moved: 0, autoAssigned: 0 };
  const facilityId = String(company.decided_facility_id);
  const alive = await first(db, `SELECT facility_id FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL`, [facilityId]);
  if (!alive) {
    await db.run(`UPDATE contact_import_companies SET decision = NULL, decided_facility_id = NULL, created_facility = false, decided_by = NULL, decided_at = NULL, updated_at = $2 WHERE company_id = $1`, [companyId, now]);
    return { moved: 0, autoAssigned: 0 };
  }
  const pending = rowsToObjects(await db.exec(
    `SELECT id, person_name, title, department, office_phone, mobile_phone, fax_number, email, address, facility_id
       FROM contact_import_rows WHERE company_id = $1 AND status = 'pending' ORDER BY id`, [companyId]
  )) as unknown as PendingRow[];
  if (!pending.length) return { moved: 0, autoAssigned: 0 };
  const chosenAlive = await aliveFacilityIds(db, [...new Set(pending.map((r) => toText(r.facility_id)).filter((v): v is string => !!v))]);
  const sites = await loadCompanySites(db, company);
  let autoAssigned = 0;
  for (const row of pending) {
    const chosen = toText(row.facility_id);
    let placed: string | null = null;
    if (chosen && chosenAlive.has(chosen)) placed = chosen;
    else {
      const suggestion = suggestPersonSite({ department: toText(row.department), address: toText(row.address) }, sites, String(company.display_name));
      if (suggestion && suggestion.facilityId !== facilityId) {
        placed = suggestion.facilityId;
        autoAssigned += 1;
      }
    }
    await addFacilityContact(db, placed ?? facilityId, row, now);
    await db.run(`UPDATE contact_import_rows SET status = 'imported', facility_id = $3, updated_at = $2 WHERE id = $1`, [Number(row.id), now, placed]);
  }
  return { moved: pending.length, autoAssigned };
}

/** 이미 옮긴 담당자 행이 다시 올라와 빈 칸이 채워졌으면, 그 사람이 있는 사업장 담당자의 빈 칸에도 반영한다. */
async function refillImportedContacts(db: PgDatabase, companyId: string, rowIds: number[], now: string): Promise<void> {
  if (!rowIds.length) return;
  const company = await first(db, `SELECT decision, decided_facility_id FROM contact_import_companies WHERE company_id = $1`, [companyId]);
  if (!company?.decision || company.decision === "exclude" || !company.decided_facility_id) return;
  const rows = rowsToObjects(await db.exec(
    `SELECT id, person_name, title, department, office_phone, mobile_phone, fax_number, email, COALESCE(facility_id, $2) AS target_facility_id
       FROM contact_import_rows WHERE id = ANY($1::bigint[]) AND status = 'imported'`, [rowIds, String(company.decided_facility_id)]
  ));
  for (const row of rows) await addFacilityContact(db, String(row.target_facility_id), row as unknown as ContactFields, now, { fillOnly: true });
}

/**
 * 담당자 한 명을 다른 사업장으로 옮긴다. 원래 사업장에서는 그 사람 행만 빠진다.
 * 대상 사업장에 같은 사람이 이미 있으면 빈 칸만 채우고 합쳐 중복 등록하지 않는다. 연락 기록도 함께 옮긴다.
 * 원래 사업장에서 사람이 이미 지워졌으면 가져온 값으로 대상 사업장에 새로 넣는다.
 */
async function transferFacilityPerson(db: PgDatabase, from: string, to: string, row: ContactFields, now: string): Promise<{ merged: boolean; recreated: boolean }> {
  const source = await findFacilityPerson(db, from, String(row.person_name), toText(row.mobile_phone));
  if (!source) {
    await addFacilityContact(db, to, row, now);
    return { merged: false, recreated: true };
  }
  const sourceId = Number(source.id);
  const sourceDept = source.department_id != null
    ? await first(db, `SELECT department_name, fax_number FROM facility_contact_departments WHERE id = $1`, [Number(source.department_id)])
    : undefined;
  const departmentId = await facilityDepartmentId(db, to, toText(sourceDept?.department_name) ?? toText(row.department), toText(sourceDept?.fax_number) ?? toText(row.fax_number), now, true);
  const target = await findFacilityPerson(db, to, String(source.person_name), toText(source.mobile_phone));
  if (target) {
    const targetId = Number(target.id);
    await db.run(
      `UPDATE facility_contact_people d SET
         title = COALESCE(d.title, s.title), department_id = COALESCE(d.department_id, $3), office_phone = COALESCE(d.office_phone, s.office_phone),
         mobile_phone = COALESCE(d.mobile_phone, s.mobile_phone), email = COALESCE(d.email, s.email), duties = COALESCE(d.duties, s.duties),
         card_storage_provider = CASE WHEN d.card_storage_key IS NULL THEN s.card_storage_provider ELSE d.card_storage_provider END,
         card_storage_bucket = CASE WHEN d.card_storage_key IS NULL THEN s.card_storage_bucket ELSE d.card_storage_bucket END,
         card_public_path = CASE WHEN d.card_storage_key IS NULL THEN s.card_public_path ELSE d.card_public_path END,
         card_ocr_text = CASE WHEN d.card_storage_key IS NULL THEN s.card_ocr_text ELSE d.card_ocr_text END,
         card_parsed_json = CASE WHEN d.card_storage_key IS NULL THEN s.card_parsed_json ELSE d.card_parsed_json END,
         card_captured_at = CASE WHEN d.card_storage_key IS NULL THEN s.card_captured_at ELSE d.card_captured_at END,
         card_storage_key = COALESCE(d.card_storage_key, s.card_storage_key),
         updated_at = $4
         FROM facility_contact_people s WHERE d.id = $1 AND s.id = $2`,
      [targetId, sourceId, departmentId, now]
    );
    await db.run(`UPDATE facility_contact_logs SET facility_id = $3, person_id = $4, department_id = $5 WHERE person_id = $1 AND facility_id = $2`, [sourceId, from, to, targetId, departmentId]);
    await db.run(`DELETE FROM facility_contact_people WHERE id = $1`, [sourceId]);
    return { merged: true, recreated: false };
  }
  await db.run(`UPDATE facility_contact_people SET facility_id = $2, department_id = $3, updated_at = $4 WHERE id = $1`, [sourceId, to, departmentId, now]);
  await db.run(`UPDATE facility_contact_logs SET facility_id = $3, department_id = $4 WHERE person_id = $1 AND facility_id = $2`, [sourceId, from, to, departmentId]);
  return { merged: false, recreated: false };
}

/**
 * 담당자 한 명의 배속 사업장을 바꾼다. facilityId 가 null 이면 회사 분류대로.
 * 분류 전이면 고른 값만 저장해 분류 때 반영하고, 이미 옮긴 담당자면 사업장 담당자 행을 옮긴다.
 * 옮긴 담당자는 회사 사업장으로 되돌려도 직접 고른 것으로 기록해(facility_id = 회사 사업장) 자동 배속이 다시 옮기지 않는다.
 */
export async function assignContactSite(
  db: PgDatabase, companyId: string, rowId: number, facilityId: string | null, userId: string, opts: { auto?: boolean; reason?: string } = {}
): Promise<{ status: "ok" | "skipped"; reason?: string; changed?: boolean }> {
  const now = new Date().toISOString();
  const row = await first(db,
    `SELECT r.*, c.decision, c.decided_facility_id FROM contact_import_rows r JOIN contact_import_companies c ON c.company_id = r.company_id
      WHERE r.id = $1 AND r.company_id = $2 FOR UPDATE OF r`, [rowId, companyId]);
  if (!row) return { status: "skipped", reason: "담당자를 찾을 수 없습니다" };
  if (row.decision === "exclude") return { status: "skipped", reason: "제외한 회사의 담당자입니다. 분류를 되돌린 뒤 고르세요" };
  const wanted = toText(facilityId);
  if (wanted && !(await aliveFacilityIds(db, [wanted])).has(wanted)) return { status: "skipped", reason: "사업장을 찾을 수 없습니다" };
  const decided = toText(row.decided_facility_id);
  if (row.status !== "imported") {
    if (toText(row.facility_id) === wanted) return { status: "ok", changed: false };
    await db.run(`UPDATE contact_import_rows SET facility_id = $2, updated_at = $3 WHERE id = $1`, [rowId, wanted, now]);
    await recordAuditLogInline(db, {
      actorUserId: userId, action: "contact_import_person_site", targetTable: "contact_import_rows", targetId: String(rowId),
      before: { facilityId: toText(row.facility_id) }, after: { facilityId: wanted, companyId, auto: !!opts.auto, reason: opts.reason ?? null },
    });
    return { status: "ok", changed: true };
  }
  const from = toText(row.facility_id) ?? decided;
  const to = wanted ?? decided;
  if (!from || !to) return { status: "skipped", reason: "회사에 고른 사업장이 없습니다" };
  if (from === to) {
    if (!opts.auto && toText(row.facility_id) !== to) await db.run(`UPDATE contact_import_rows SET facility_id = $2, updated_at = $3 WHERE id = $1`, [rowId, to, now]);
    return { status: "ok", changed: false };
  }
  const result = await transferFacilityPerson(db, from, to, row as unknown as ContactFields, now);
  await db.run(`UPDATE contact_import_rows SET facility_id = $2, updated_at = $3 WHERE id = $1`, [rowId, to, now]);
  await recordAuditLogInline(db, {
    actorUserId: userId, action: "contact_import_person_move", targetTable: "contact_import_rows", targetId: String(rowId),
    before: { facilityId: from }, after: { facilityId: to, companyId, personName: row.person_name, ...result, auto: !!opts.auto, reason: opts.reason ?? null },
  });
  return { status: "ok", changed: true };
}

/**
 * 분류가 끝난 회사의 담당자 중 회사 분류대로 들어간 사람(facility_id NULL)을 추천 산하 사업장으로 옮긴다(자동 배속).
 * 직접 고른 사람(회사 사업장을 고른 경우 포함)과 이미 자동 배속된 사람은 건드리지 않는다.
 */
export async function autoAssignCompanySites(db: PgDatabase, companyId: string, userId: string): Promise<{ status: "ok" | "skipped"; reason?: string; moved?: number }> {
  const company = await first(db, `SELECT * FROM contact_import_companies WHERE company_id = $1`, [companyId]);
  if (!company) return { status: "skipped", reason: "회사를 찾을 수 없습니다" };
  if (!company.decision || company.decision === "exclude" || !company.decided_facility_id) {
    return { status: "skipped", reason: "분류한 회사만 자동 배속합니다(분류할 때는 자동으로 배속됩니다)" };
  }
  const decided = String(company.decided_facility_id);
  const rows = rowsToObjects(await db.exec(
    `SELECT id, department, address FROM contact_import_rows
      WHERE company_id = $1 AND status = 'imported' AND facility_id IS NULL ORDER BY id`, [companyId]));
  if (!rows.length) return { status: "ok", moved: 0 };
  const sites = await loadCompanySites(db, company);
  let moved = 0;
  for (const row of rows) {
    const suggestion = suggestPersonSite({ department: toText(row.department), address: toText(row.address) }, sites, String(company.display_name));
    if (!suggestion || suggestion.facilityId === decided) continue;
    const result = await assignContactSite(db, companyId, Number(row.id), suggestion.facilityId, userId, { auto: true, reason: suggestion.reason });
    if (result.changed) moved += 1;
  }
  return { status: "ok", moved };
}

/**
 * 자동 배속할 산하 사업장이 마스터에 없을 때 연락처 가져오기 화면에서 바로 등록한다.
 * 기준 사업장(회사에 고른 사업장 또는 고른 후보)의 법인등록번호·기관 구분·목록 구분을 물려받아
 * 같은 회사의 산하 사업장 후보(법인등록번호 같음)로 곧바로 잡힌다. 상호·소재지가 같은 사업장이 있으면 그곳을 쓴다.
 */
export async function registerSubSite(
  db: PgDatabase,
  companyId: string,
  input: { companyName: string; address: string | null; brn: string | null; baseFacilityId: string | null },
  userId: string
): Promise<{ facilityId: string; created: boolean }> {
  const company = await first(db, `SELECT company_id, decided_facility_id FROM contact_import_companies WHERE company_id = $1`, [companyId]);
  if (!company) throw Object.assign(new Error("회사를 찾을 수 없습니다."), { status: 404 });
  const name = input.companyName.trim();
  if (!name) throw Object.assign(new Error("사업장 이름을 적어 주세요."), { status: 400 });
  const baseId = toText(company.decided_facility_id) ?? toText(input.baseFacilityId);
  const base = baseId
    ? await first(db, `SELECT corporate_registration_no, org_category, listing FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL`, [baseId])
    : undefined;
  const listing = base?.listing === "master" || base?.listing === "other" ? (base.listing as "master" | "other") : null;
  return registerImportedFacility(db, {
    companyName: name, brn: toText(input.brn), crn: toText(base?.corporate_registration_no), address: toText(input.address),
    phone: null, homepage: null, orgCategory: toText(base?.org_category), tradeRoles: [], listing, userId, now: new Date().toISOString(),
    sameBrnAllowed: true,
  });
}

interface RegisterInput {
  companyName: string; brn: string | null; crn?: string | null; address: string | null; phone: string | null; homepage: string | null;
  orgCategory: string | null; tradeRoles: TradeRole[]; listing: "master" | "other" | null; userId: string; now: string;
  /** 산하 사업장 등록 — 본사와 사업자번호가 같은 공장도 있으므로 번호가 아니라 상호·소재지로만 같은 곳을 찾는다. */
  sameBrnAllowed?: boolean;
}

/**
 * 가져온 회사를 사업장으로 등록한다. 번호나 상호·소재지가 같은 사업장이 있으면 그 사업장을 쓴다.
 * 이미 있는 사업장의 구분(listing)은 바꾸지 않는다 — 다른 사람이 관리하는 곳일 수 있다.
 */
export async function registerImportedFacility(db: PgDatabase, input: RegisterInput): Promise<{ facilityId: string; created: boolean }> {
  await markReviewedWrite(db);
  const companyName = formatCompanyName(input.companyName) ?? input.companyName.trim();
  const normCompany = companyName.replace(/\s+/g, "").replace(/[\(\)（）]/g, "").trim().toLowerCase();
  const siteAddress = normalizeInput("site_address", input.address);
  const normAddress = siteAddress?.replace(/\s+/g, " ").trim() ?? normalizeAddress(input.address);
  const brn = normalizeInput("business_registration_no", input.brn);
  const existing = brn && !input.sameBrnAllowed
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
        homepage_url, listing, created_at, updated_at, site_address_verbatim)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'contact-import',$11,$12::text[],$13,$14,$15,$15,true)`,
    [facilityId, companyName, brn, normalizeInput("corporate_registration_no", input.crn ?? null), input.address, normalizeInput("phone_number", input.phone),
      normCompany, normAddress, region.sido, region.sigungu, input.orgCategory, input.tradeRoles, input.homepage, input.listing, input.now]
  );
  await recordAuditLogInline(db, {
    actorUserId: input.userId,
    action: "facility_manual_create",
    targetTable: "facilities",
    targetId: facilityId,
    after: { companyName, businessRegistrationNo: brn, siteAddress: input.address, source: "contact-import", tradeRoles: input.tradeRoles, listing: input.listing, subSite: !!input.sameBrnAllowed },
  });
  return { facilityId, created: true };
}

/** 기존 사업장에는 거래 구분을 더하고 비어 있는 홈페이지·연락처 구분만 채운다. */
async function mergeFacilityExtras(db: PgDatabase, facilityId: string, input: Pick<RegisterInput, "tradeRoles" | "homepage" | "orgCategory" | "now">): Promise<void> {
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

async function hasLiveContract(db: PgDatabase, facilityId: string): Promise<boolean> {
  return !!(await first(db,
    `SELECT 1 AS ok WHERE EXISTS (SELECT 1 FROM contracts c WHERE (c.counterparty_facility_id = $1 OR c.facility_id = $1) AND c.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM purchase_contracts pc WHERE pc.counterparty_facility_id = $1 AND pc.deleted_at IS NULL)`,
    [facilityId]
  ));
}

export type ListingAction = { action: "other" } | { action: "master" } | { action: "promote"; tradeRoles: TradeRole[] };

/**
 * 사업장 마스터 ↔ 기타 목록 이동과 거래처 승격.
 * 계약이 있는 곳은 거래처이므로 기타로 옮기지 않는다. 계약 없이 거래 구분만 있으면 지우고 옮긴다.
 */
export async function changeFacilityListing(db: PgDatabase, facilityId: string, change: ListingAction, userId: string): Promise<void> {
  const now = new Date().toISOString();
  const before = await first(db, `SELECT listing, trade_roles FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL FOR UPDATE`, [facilityId]);
  if (!before) throw Object.assign(new Error("사업장을 찾을 수 없습니다."), { status: 404 });
  if (change.action === "other") {
    if (await hasLiveContract(db, facilityId)) {
      throw Object.assign(new Error("계약이 있는 사업장은 거래처이므로 기타 목록으로 옮길 수 없습니다."), { status: 409 });
    }
    await db.run(`UPDATE facilities SET listing = 'other', trade_roles = '{}', updated_at = $2 WHERE facility_id = $1`, [facilityId, now]);
  } else if (change.action === "master") {
    await db.run(`UPDATE facilities SET listing = 'master', updated_at = $2 WHERE facility_id = $1`, [facilityId, now]);
  } else {
    await db.run(
      `UPDATE facilities SET listing = 'master', trade_roles = ARRAY(SELECT DISTINCT unnest(COALESCE(trade_roles, '{}'::text[]) || $2::text[])), updated_at = $3 WHERE facility_id = $1`,
      [facilityId, change.tradeRoles, now]
    );
  }
  await recordAuditLogInline(db, {
    actorUserId: userId,
    action: "facility_listing_change",
    targetTable: "facilities",
    targetId: facilityId,
    before: { listing: before.listing, tradeRoles: before.trade_roles },
    after: change,
  });
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
 * reopen 은 제외·기타 목록만 되돌린다. 거래처로 넣은 것은 사업장 화면에서 고친다.
 */
export async function decideCompany(db: PgDatabase, item: DecisionItem, userId: string): Promise<{ status: "ok" | "skipped"; reason?: string; moved?: number; autoAssigned?: number }> {
  const now = new Date().toISOString();
  const company = await first(db, `SELECT * FROM contact_import_companies WHERE company_id = $1 FOR UPDATE`, [item.companyId]);
  if (!company) return { status: "skipped", reason: "회사를 찾을 수 없습니다" };
  if (item.action === "reopen") {
    if (company.decision !== "exclude" && company.decision !== "other") return { status: "skipped", reason: "사업장에 넣은 회사는 되돌릴 수 없습니다" };
    if (company.decision === "other" && company.decided_facility_id) {
      const facilityId = String(company.decided_facility_id);
      const facility = await first(db, `SELECT trade_roles FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL`, [facilityId]);
      if (facility && ((facility.trade_roles as string[] | null)?.length || (await hasLiveContract(db, facilityId)))) {
        return { status: "skipped", reason: "이미 거래처가 된 곳입니다" };
      }
      if (facility) {
        // 산하 사업장으로 따로 옮긴 담당자는 그 사업장에 그대로 둔다(다시 분류하면 같은 곳으로 간다).
        for (const row of rowsToObjects(await db.exec(
          `SELECT person_name, mobile_phone FROM contact_import_rows WHERE company_id = $1 AND status = 'imported' AND COALESCE(facility_id, $2) = $2`,
          [item.companyId, facilityId]
        ))) {
          await db.run(
            `DELETE FROM facility_contact_people WHERE facility_id = $1 AND person_name = $2 AND regexp_replace(COALESCE(mobile_phone, ''), '[^0-9]', '', 'g') = $3`,
            [facilityId, row.person_name, digitsOf(row.mobile_phone)]
          );
        }
        const left = await first(db, `SELECT COUNT(*)::int AS n FROM facility_contact_people WHERE facility_id = $1`, [facilityId]);
        if (company.created_facility && Number(left?.n ?? 0) === 0) {
          await db.run(`UPDATE facilities SET deleted_at = $2, deleted_by = $3, delete_reason = '연락처 가져오기 분류 되돌리기', updated_at = $2 WHERE facility_id = $1`, [facilityId, now, userId]);
        }
      }
    }
    await db.run(
      `UPDATE contact_import_rows SET status = 'pending', facility_id = CASE WHEN facility_id = $3 THEN NULL ELSE facility_id END, updated_at = $2 WHERE company_id = $1`,
      [item.companyId, now, toText(company.decided_facility_id)]
    );
    await db.run(`UPDATE contact_import_companies SET decision = NULL, decided_facility_id = NULL, created_facility = false, decided_by = NULL, decided_at = NULL, updated_at = $2 WHERE company_id = $1`, [item.companyId, now]);
    return { status: "ok" };
  }
  if (company.decision) return { status: "skipped", reason: "이미 분류한 회사입니다" };
  const roles = (item.tradeRoles ?? []).filter((r): r is TradeRole => (TRADE_ROLES as readonly string[]).includes(r));
  const category = toText(item.orgCategory) ?? toText(company.suggested_category);
  const homepage = toText(company.homepage_url);
  let facilityId: string | null = null;
  let created = false;
  if (item.action === "link") {
    const candidates = (company.match_candidates ?? []) as MatchCandidate[];
    facilityId = toText(item.facilityId) ?? autoLinkTarget(candidates);
    if (!facilityId) return { status: "skipped", reason: "연결할 사업장을 골라 주세요" };
    const facility = await first(db, `SELECT facility_id FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL`, [facilityId]);
    if (!facility) return { status: "skipped", reason: "사업장을 찾을 수 없습니다" };
    await mergeFacilityExtras(db, facilityId, { tradeRoles: roles, homepage, orgCategory: null, now });
  } else if (item.action === "partner" || item.action === "other") {
    if (item.action === "partner" && !roles.length) return { status: "skipped", reason: "매출·매입 중 거래 구분을 골라 주세요" };
    const registered = await registerImportedFacility(db, {
      companyName: String(company.display_name), brn: toText(company.found_brn), crn: toText(company.found_crn), address: toText(company.address),
      phone: toText(company.phone_number), homepage, orgCategory: category, tradeRoles: item.action === "partner" ? roles : [],
      listing: item.action === "partner" ? "master" : "other", userId, now,
    });
    facilityId = registered.facilityId;
    created = registered.created;
  }
  await db.run(
    `UPDATE contact_import_companies SET decision = $2, decided_facility_id = $3, created_facility = $4, decided_by = $5, decided_at = $6, updated_at = $6 WHERE company_id = $1`,
    [item.companyId, item.action, facilityId, created, userId, now]
  );
  const { moved, autoAssigned } = await moveCompanyContacts(db, item.companyId, now);
  await recordAuditLogInline(db, {
    actorUserId: userId,
    action: "contact_import_decide",
    targetTable: "contact_import_companies",
    targetId: item.companyId,
    after: { decision: item.action, facilityId, created, tradeRoles: roles, moved, autoAssigned },
  });
  return { status: "ok", moved, autoAssigned };
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
