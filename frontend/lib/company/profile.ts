import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

/*
 * 회사 프로필(079) — 자사 일반현황·연혁·면허/인증 보유현황.
 * 입찰 증빙서류 패키지(docs/bid-package-blueprint.md)의 자사 데이터 공급원.
 * 프로필은 단일 행(profile_id='default').
 */

export interface CompanyFinanceRow {
  year: string;
  capital: string; // 자본금(표기 그대로 — 단위 자유)
  revenue: string; // 매출액
}

export interface CompanyProfile {
  companyName: string;
  ceoName: string;
  bizRegNo: string;
  corpRegNo: string;
  address: string;
  phone: string;
  fax: string;
  bizField: string;
  foundedYm: string; // YYYY-MM
  mainBusiness: string;
  credit: { bondGrade: string; creditGrade: string; ratedAt: string };
  finance: CompanyFinanceRow[];
  updatedAt: string | null;
}

export interface CompanyHistoryItem {
  historyId: string;
  eventYm: string; // YYYY-MM
  content: string;
}

export type CredentialKind = "license" | "certification";

export interface CompanyCredential {
  credentialId: string;
  kind: CredentialKind;
  name: string;
  credentialNo: string;
  issuedAt: string;
  validUntil: string;
  issuer: string;
  note: string;
}

/** 인적구성(통합허가 대행업 기준) — 재직자 env_grade 집계. NULL/빈값은 '미구분'에 합산. */
export interface StaffComposition {
  total: number;
  rows: { grade: string; count: number }[];
}

const s = (v: unknown): string => (v == null ? "" : String(v).trim());

function parseJson<T>(value: unknown, fallback: T): T {
  try {
    const v = typeof value === "string" ? JSON.parse(value) : value;
    if (v != null && typeof v === "object") return v as T;
  } catch {
    // 무시
  }
  return fallback;
}

export async function getCompanyProfile(): Promise<CompanyProfile> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec("SELECT * FROM company_profile WHERE profile_id = 'default'"));
  const r = rows[0] ?? {};
  const credit = parseJson<Record<string, unknown>>(r.credit, {});
  const financeRaw = parseJson<unknown>(r.finance, []);
  const finance: CompanyFinanceRow[] = Array.isArray(financeRaw)
    ? financeRaw.map((f) => {
        const o = (f ?? {}) as Record<string, unknown>;
        return { year: s(o.year), capital: s(o.capital), revenue: s(o.revenue) };
      })
    : [];
  return {
    companyName: s(r.company_name),
    ceoName: s(r.ceo_name),
    bizRegNo: s(r.biz_reg_no),
    corpRegNo: s(r.corp_reg_no),
    address: s(r.address),
    phone: s(r.phone),
    fax: s(r.fax),
    bizField: s(r.biz_field),
    foundedYm: s(r.founded_ym),
    mainBusiness: s(r.main_business),
    credit: { bondGrade: s(credit.bondGrade), creditGrade: s(credit.creditGrade), ratedAt: s(credit.ratedAt) },
    finance,
    updatedAt: r.updated_at != null ? String(r.updated_at) : null,
  };
}

export async function saveCompanyProfile(
  input: Omit<CompanyProfile, "updatedAt">,
  actorUserId: string | null
): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO company_profile
         (profile_id, company_name, ceo_name, biz_reg_no, corp_reg_no, address, phone, fax,
          biz_field, founded_ym, main_business, credit, finance, updated_by, updated_at)
       VALUES ('default', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14)
       ON CONFLICT (profile_id) DO UPDATE SET
         company_name = EXCLUDED.company_name,
         ceo_name = EXCLUDED.ceo_name,
         biz_reg_no = EXCLUDED.biz_reg_no,
         corp_reg_no = EXCLUDED.corp_reg_no,
         address = EXCLUDED.address,
         phone = EXCLUDED.phone,
         fax = EXCLUDED.fax,
         biz_field = EXCLUDED.biz_field,
         founded_ym = EXCLUDED.founded_ym,
         main_business = EXCLUDED.main_business,
         credit = EXCLUDED.credit,
         finance = EXCLUDED.finance,
         updated_by = EXCLUDED.updated_by,
         updated_at = EXCLUDED.updated_at`,
      [
        s(input.companyName),
        s(input.ceoName),
        s(input.bizRegNo),
        s(input.corpRegNo),
        s(input.address),
        s(input.phone),
        s(input.fax),
        s(input.bizField),
        s(input.foundedYm),
        s(input.mainBusiness),
        JSON.stringify(input.credit ?? {}),
        JSON.stringify(Array.isArray(input.finance) ? input.finance : []),
        actorUserId,
        now,
      ]
    );
  });
}

export async function getStaffComposition(): Promise<StaffComposition> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT COALESCE(NULLIF(TRIM(env_grade), ''), '미구분') AS grade, COUNT(*) AS count
         FROM employee_profiles
        WHERE COALESCE(status, 'active') <> 'inactive'
        GROUP BY 1`
    )
  );
  // 고급인력 → 일반인력 → 미구분 순 고정 정렬
  const order = ["고급인력", "일반인력", "미구분"];
  const map = new Map(rows.map((r) => [String(r.grade), Number(r.count ?? 0)]));
  const result: { grade: string; count: number }[] = [];
  for (const g of order) {
    if (map.has(g)) {
      result.push({ grade: g, count: map.get(g)! });
      map.delete(g);
    }
  }
  for (const [grade, count] of map) result.push({ grade, count });
  return { total: result.reduce((acc, r) => acc + r.count, 0), rows: result };
}

// ---------- 연혁 ----------

export async function listHistory(): Promise<CompanyHistoryItem[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT * FROM company_history ORDER BY event_ym DESC, display_order DESC, history_id DESC")
  );
  return rows.map((r) => ({
    historyId: String(r.history_id ?? ""),
    eventYm: s(r.event_ym),
    content: s(r.content),
  }));
}

export async function addHistory(eventYm: string, content: string): Promise<CompanyHistoryItem> {
  const ym = s(eventYm);
  const text = s(content);
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error("연월은 YYYY-MM 형식이어야 합니다.");
  if (!text) throw new Error("연혁 내용을 입력하세요.");
  const historyId = "chs_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      "INSERT INTO company_history (history_id, event_ym, content, display_order, created_at) VALUES ($1, $2, $3, 0, $4)",
      [historyId, ym, text, now]
    );
  });
  return { historyId, eventYm: ym, content: text };
}

export async function updateHistory(historyId: string, eventYm: string, content: string): Promise<void> {
  const ym = s(eventYm);
  const text = s(content);
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error("연월은 YYYY-MM 형식이어야 합니다.");
  if (!text) throw new Error("연혁 내용을 입력하세요.");
  await withDbWrite(async (txn) => {
    await txn.run("UPDATE company_history SET event_ym = $2, content = $3 WHERE history_id = $1", [historyId, ym, text]);
  });
}

export async function deleteHistory(historyId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run("DELETE FROM company_history WHERE history_id = $1", [historyId]);
  });
}

// ---------- 면허/인증 ----------

function mapCredential(r: Record<string, unknown>): CompanyCredential {
  return {
    credentialId: String(r.credential_id ?? ""),
    kind: (String(r.kind ?? "license") === "certification" ? "certification" : "license") as CredentialKind,
    name: s(r.name),
    credentialNo: s(r.credential_no),
    issuedAt: s(r.issued_at),
    validUntil: s(r.valid_until),
    issuer: s(r.issuer),
    note: s(r.note),
  };
}

export async function listCredentials(): Promise<CompanyCredential[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT * FROM company_credentials ORDER BY kind ASC, issued_at ASC NULLS FIRST, credential_id ASC")
  );
  return rows.map(mapCredential);
}

export async function saveCredential(input: {
  credentialId?: string | null;
  kind: CredentialKind;
  name: string;
  credentialNo?: string;
  issuedAt?: string;
  validUntil?: string;
  issuer?: string;
  note?: string;
}): Promise<CompanyCredential> {
  const name = s(input.name);
  if (!name) throw new Error("면허/인증 명칭을 입력하세요.");
  const kind: CredentialKind = input.kind === "certification" ? "certification" : "license";
  const now = new Date().toISOString();
  const credentialId = s(input.credentialId) || "ccr_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO company_credentials
         (credential_id, kind, name, credential_no, issued_at, valid_until, issuer, note, display_order, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $9)
       ON CONFLICT (credential_id) DO UPDATE SET
         kind = EXCLUDED.kind,
         name = EXCLUDED.name,
         credential_no = EXCLUDED.credential_no,
         issued_at = EXCLUDED.issued_at,
         valid_until = EXCLUDED.valid_until,
         issuer = EXCLUDED.issuer,
         note = EXCLUDED.note,
         updated_at = EXCLUDED.updated_at`,
      [
        credentialId,
        kind,
        name,
        s(input.credentialNo),
        s(input.issuedAt),
        s(input.validUntil),
        s(input.issuer),
        s(input.note),
        now,
      ]
    );
  });
  return {
    credentialId,
    kind,
    name,
    credentialNo: s(input.credentialNo),
    issuedAt: s(input.issuedAt),
    validUntil: s(input.validUntil),
    issuer: s(input.issuer),
    note: s(input.note),
  };
}

export async function deleteCredential(credentialId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run("DELETE FROM company_credentials WHERE credential_id = $1", [credentialId]);
  });
}
