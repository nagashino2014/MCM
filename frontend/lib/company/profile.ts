import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";

/*
 * 회사 프로필(079) — 자사 일반현황·연혁·면허/인증 보유현황.
 * 입찰 증빙서류 패키지(docs/bid-package-blueprint.md)의 자사 데이터 공급원.
 * 프로필은 단일 행(profile_id='default').
 */

/** 재정상황 — 홈택스 표준재무제표 LLM 추출(원 단위 숫자 문자열). equity=표준재무상태표의 자본총계. */
export interface CompanyFinanceRow {
  year: string;
  capital: string; // 자본금
  totalAssets: string; // 자산총계
  totalLiabilities: string; // 부채총계
  equity: string; // 자기자본(자본총계)
  revenue: string; // 매출액
  operatingProfit: string; // 영업이익
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
  /** 회사소개서용(310) — 홈페이지·대표 메일. 비전·슬로건은 소개서 콘텐츠로 쓴다. */
  website: string;
  email: string;
  vision: string;
  slogan: string;
  credit: CompanyCreditRow[];
  /** 등급 확인서 이미지(등급 표시부) — 입찰 패키지 신용평가 서식에 삽입. */
  creditImage: { storageKey: string; fileName: string } | null;
  finance: CompanyFinanceRow[];
  updatedAt: string | null;
}

/** 신용평가 등급 — 민간(CLIP)·공공 등 평가 종류별 복수 행. */
export interface CompanyCreditRow {
  agency: string;
  ratingType: string;
  creditGrade: string;
  ratedAt: string;
}

/** 연혁 분류(310) — 회사소개서 연혁 쪽의 묶음·아이콘에 쓴다. */
export const HISTORY_CATEGORIES = ["설립", "등록", "인증", "특허", "수상", "조직", "사업"] as const;

export interface CompanyHistoryItem {
  historyId: string;
  eventYm: string; // YYYY-MM
  content: string;
  category: string;
  /** 자동 생성 줄의 출처(company_credentials) — 원본을 고치면 함께 바뀌므로 화면에서 직접 고치지 않는다. */
  sourceTable: string | null;
  sourceId: string | null;
  isPublic: boolean;
  highlight: boolean;
}

export type CredentialKind = "license" | "certification" | "patent" | "award";

export const CREDENTIAL_KINDS: CredentialKind[] = ["license", "certification", "patent", "award"];

export function normalizeCredentialKind(value: unknown): CredentialKind {
  const v = String(value ?? "");
  return (CREDENTIAL_KINDS as string[]).includes(v) ? (v as CredentialKind) : "license";
}

export interface CompanyCredential {
  credentialId: string;
  kind: CredentialKind;
  name: string;
  credentialNo: string;
  issuedAt: string;
  validUntil: string;
  issuer: string;
  note: string;
  isPublic: boolean;
  /** 증빙 파일(문서 분석 때 올린 원본) — 회사소개서 인증 쪽 썸네일·입찰 패키지에 쓴다. */
  file: { storageKey: string; fileName: string } | null;
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
  // credit: 배열(현행). 과거 단일 객체 저장분은 1행 배열로 승격.
  const creditRaw = parseJson<unknown>(r.credit, []);
  const creditList = Array.isArray(creditRaw) ? creditRaw : [creditRaw];
  const credit: CompanyCreditRow[] = creditList
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      return { agency: s(o.agency), ratingType: s(o.ratingType), creditGrade: s(o.creditGrade), ratedAt: s(o.ratedAt) };
    })
    .filter((c) => c.agency || c.ratingType || c.creditGrade || c.ratedAt);
  const financeRaw = parseJson<unknown>(r.finance, []);
  const finance: CompanyFinanceRow[] = Array.isArray(financeRaw)
    ? financeRaw.map((f) => {
        const o = (f ?? {}) as Record<string, unknown>;
        return {
          year: s(o.year),
          capital: s(o.capital),
          totalAssets: s(o.totalAssets),
          totalLiabilities: s(o.totalLiabilities),
          equity: s(o.equity),
          revenue: s(o.revenue),
          operatingProfit: s(o.operatingProfit),
        };
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
    website: s(r.website),
    email: s(r.email),
    vision: s(r.vision),
    slogan: s(r.slogan),
    credit,
    creditImage: s(r.credit_image_key)
      ? { storageKey: s(r.credit_image_key), fileName: s(r.credit_image_name) || "credit-image" }
      : null,
    finance,
    updatedAt: r.updated_at != null ? String(r.updated_at) : null,
  };
}

/** 신용평가 등급 확인서 이미지 저장(교체) — 계약 문서 저장소의 company/ 프리픽스 사용. */
export async function saveCreditImage(params: {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  actorUserId: string | null;
}): Promise<{ storageKey: string; fileName: string }> {
  const { putContractDocument, sanitizeFilename } = await import("@/lib/storage/contract-document-storage");
  const fileName = sanitizeFilename(params.fileName) || "credit-image.png";
  const storageKey = ["company", "credit-rating", fileName].join("/");
  const stored = await putContractDocument(storageKey, Buffer.from(params.bytes), params.contentType);
  await withDbWrite(async (txn) => {
    await txn.run(
      "UPDATE company_profile SET credit_image_key = $1, credit_image_name = $2, updated_by = $3, updated_at = $4 WHERE profile_id = 'default'",
      [stored.storageKey, fileName, params.actorUserId, new Date().toISOString()]
    );
  });
  return { storageKey: stored.storageKey, fileName };
}

export async function saveCompanyProfile(
  // creditImage 는 saveCreditImage 가 따로 저장한다(여기서는 쓰지 않음).
  input: Omit<CompanyProfile, "updatedAt" | "creditImage" | "website" | "email" | "vision" | "slogan"> &
    Partial<Pick<CompanyProfile, "website" | "email" | "vision" | "slogan">>,
  actorUserId: string | null
): Promise<void> {
  const now = new Date().toISOString();
  // 회사소개서 필드(310)는 보낸 값만 바꾼다 — 값을 모르는 호출이 빈 문자열로 덮지 않게 NULL 이면 기존 값 유지.
  const optional = (v: string | undefined) => (v === undefined ? null : s(v));
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
        JSON.stringify(Array.isArray(input.credit) ? input.credit : []),
        JSON.stringify(Array.isArray(input.finance) ? input.finance : []),
        actorUserId,
        now,
      ]
    );
    await txn.run(
      `UPDATE company_profile
          SET website = COALESCE($1, website), email = COALESCE($2, email),
              vision = COALESCE($3, vision), slogan = COALESCE($4, slogan)
        WHERE profile_id = 'default'`,
      [optional(input.website), optional(input.email), optional(input.vision), optional(input.slogan)]
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

const normCategory = (v: unknown): string => {
  const c = s(v);
  return (HISTORY_CATEGORIES as readonly string[]).includes(c) ? c : "";
};

function mapHistory(r: Record<string, unknown>): CompanyHistoryItem {
  return {
    historyId: String(r.history_id ?? ""),
    eventYm: s(r.event_ym),
    content: s(r.content),
    category: s(r.category),
    sourceTable: r.source_table != null ? String(r.source_table) : null,
    sourceId: r.source_id != null ? String(r.source_id) : null,
    isPublic: Number(r.is_public ?? 1) === 1,
    highlight: Number(r.highlight ?? 0) === 1,
  };
}

export async function listHistory(): Promise<CompanyHistoryItem[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT * FROM company_history ORDER BY event_ym DESC, display_order DESC, history_id DESC")
  );
  return rows.map(mapHistory);
}

export async function addHistory(eventYm: string, content: string, category?: string): Promise<CompanyHistoryItem> {
  const ym = s(eventYm);
  const text = s(content);
  if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error("연월은 YYYY-MM 형식이어야 합니다.");
  if (!text) throw new Error("연혁 내용을 입력하세요.");
  const historyId = "chs_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const cat = normCategory(category);
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO company_history (history_id, event_ym, content, display_order, created_at, category, is_public, highlight, updated_at)
       VALUES ($1, $2, $3, 0, $4, $5, 1, 0, $4)`,
      [historyId, ym, text, now, cat || null]
    );
  });
  return { historyId, eventYm: ym, content: text, category: cat, sourceTable: null, sourceId: null, isPublic: true, highlight: false };
}

/**
 * 연혁 수정. 자동 생성 줄(source_table 있음)은 연월·내용·분류를 원본(면허·인증)에서만 고치고,
 * 여기서는 공개·강조만 바꾼다 — 원본을 다시 저장하면 덮이기 때문이다.
 */
export async function updateHistory(
  historyId: string,
  patch: { eventYm?: string; content?: string; category?: string; isPublic?: boolean; highlight?: boolean }
): Promise<void> {
  const db = await getDb();
  const cur = rowsToObjects(await db.exec("SELECT source_table FROM company_history WHERE history_id = $1", [historyId]))[0];
  if (!cur) throw Object.assign(new Error("연혁 항목을 찾을 수 없습니다."), { status: 404 });
  const auto = cur.source_table != null;
  const sets: string[] = [];
  const params: unknown[] = [historyId];
  const push = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (!auto && (patch.eventYm !== undefined || patch.content !== undefined)) {
    const ym = s(patch.eventYm);
    const text = s(patch.content);
    if (!/^\d{4}-\d{2}$/.test(ym)) throw new Error("연월은 YYYY-MM 형식이어야 합니다.");
    if (!text) throw new Error("연혁 내용을 입력하세요.");
    push("event_ym", ym);
    push("content", text);
  }
  if (!auto && patch.category !== undefined) push("category", normCategory(patch.category) || null);
  if (patch.isPublic !== undefined) push("is_public", patch.isPublic ? 1 : 0);
  if (patch.highlight !== undefined) push("highlight", patch.highlight ? 1 : 0);
  if (sets.length === 0) return;
  push("updated_at", new Date().toISOString());
  await withDbWrite(async (txn) => {
    await txn.run(`UPDATE company_history SET ${sets.join(", ")} WHERE history_id = $1`, params);
  });
}

export async function deleteHistory(historyId: string): Promise<void> {
  const db = await getDb();
  const cur = rowsToObjects(await db.exec("SELECT source_table FROM company_history WHERE history_id = $1", [historyId]))[0];
  if (cur?.source_table != null) {
    throw Object.assign(
      new Error("면허·인증에서 자동으로 만든 연혁입니다. 연혁에서 빼려면 비공개로 바꾸고, 지우려면 원본 면허·인증을 삭제하세요."),
      { status: 400 }
    );
  }
  await withDbWrite(async (txn) => {
    await txn.run("DELETE FROM company_history WHERE history_id = $1", [historyId]);
  });
}

// ---------- 연혁 자동 후보(면허·인증·특허·수상 → 연혁, 회사소개서 블루프린트 §6-3) ----------

const CREDENTIAL_HISTORY_CATEGORY: Record<CredentialKind, string> = {
  license: "등록",
  certification: "인증",
  patent: "특허",
  award: "수상",
};

/** 연혁 문구 규칙 — 310 백필 SQL 과 같은 규칙(바꾸면 둘 다 고친다). */
export function credentialHistoryText(kind: CredentialKind, name: string): string {
  const n = s(name);
  switch (kind) {
    case "license":
      return n.endsWith("등록") ? n : `${n} 등록`;
    case "certification":
      return n.endsWith("인증") ? `${n} 취득` : `${n} 인증 취득`;
    case "patent":
      if (/특허.*등록$/.test(n)) return n;
      return n.includes("특허") ? `${n} 등록` : `${n} 특허 등록`;
    default:
      return n.endsWith("수상") ? n : `${n} 수상`;
  }
}

/** 취득일 → YYYY-MM (2021-08-05·2021.8.5·202108 등). 못 읽으면 "". */
export function credentialHistoryYm(issuedAt: string): string {
  const m = s(issuedAt).match(/(\d{4})\D?(\d{1,2})/);
  if (!m) return "";
  const month = Number(m[2]);
  if (month < 1 || month > 12) return "";
  return `${m[1]}-${String(month).padStart(2, "0")}`;
}

/**
 * 면허·인증 저장·삭제 시 연혁 자동 줄을 맞춘다(같은 출처는 1줄). 취득일이 없으면 줄을 지운다.
 * 새 줄은 공개로 만든다(D6 권장값 — 인증·특허·등록은 자동 게재). 공개·강조는 사용자가 바꾼 값을 유지한다.
 */
async function syncCredentialHistory(
  txn: { run: (sql: string, params?: unknown[]) => Promise<void> },
  credential: { credentialId: string; kind: CredentialKind; name: string; issuedAt: string } | { credentialId: string; deleted: true }
): Promise<void> {
  const ym = "deleted" in credential ? "" : credentialHistoryYm(credential.issuedAt);
  if ("deleted" in credential || !ym || !s(credential.name)) {
    await txn.run("DELETE FROM company_history WHERE source_table = 'company_credentials' AND source_id = $1", [credential.credentialId]);
    return;
  }
  const now = new Date().toISOString();
  await txn.run(
    `INSERT INTO company_history
       (history_id, event_ym, content, display_order, created_at, category, source_table, source_id, is_public, highlight, updated_at)
     VALUES ($1, $2, $3, 0, $4, $5, 'company_credentials', $6, 1, 0, $4)
     ON CONFLICT (source_table, source_id) WHERE source_table IS NOT NULL DO UPDATE SET
       event_ym = EXCLUDED.event_ym,
       content = EXCLUDED.content,
       category = EXCLUDED.category,
       updated_at = EXCLUDED.updated_at`,
    [
      "chs_cred_" + credential.credentialId,
      ym,
      credentialHistoryText(credential.kind, credential.name),
      now,
      CREDENTIAL_HISTORY_CATEGORY[credential.kind],
      credential.credentialId,
    ]
  );
}

// ---------- 면허/인증 ----------

function mapCredential(r: Record<string, unknown>): CompanyCredential {
  return {
    credentialId: String(r.credential_id ?? ""),
    kind: normalizeCredentialKind(r.kind),
    name: s(r.name),
    credentialNo: s(r.credential_no),
    issuedAt: s(r.issued_at),
    validUntil: s(r.valid_until),
    issuer: s(r.issuer),
    note: s(r.note),
    isPublic: Number(r.is_public ?? 1) === 1,
    file: s(r.storage_key) ? { storageKey: s(r.storage_key), fileName: s(r.file_name) || "credential" } : null,
  };
}

export async function listCredentials(): Promise<CompanyCredential[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT * FROM company_credentials ORDER BY kind ASC, issued_at ASC NULLS FIRST, credential_id ASC")
  );
  return rows.map(mapCredential);
}

export async function getCredential(credentialId: string): Promise<CompanyCredential | null> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec("SELECT * FROM company_credentials WHERE credential_id = $1", [credentialId]));
  return rows[0] ? mapCredential(rows[0]) : null;
}

/** 면허·인증 증빙 원본 보관 — 계약 문서 저장소의 company/credentials/ 프리픽스. 저장 키만 돌려주고 DB 기록은 saveCredential 이 한다. */
export async function storeCredentialFile(params: {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}): Promise<{ storageKey: string; fileName: string }> {
  const { putContractDocument, sanitizeFilename } = await import("@/lib/storage/contract-document-storage");
  const fileName = sanitizeFilename(params.fileName) || "credential.pdf";
  const storageKey = ["company", "credentials", crypto.randomUUID().replace(/-/g, "").slice(0, 16), fileName].join("/");
  const stored = await putContractDocument(storageKey, Buffer.from(params.bytes), params.contentType);
  return { storageKey: stored.storageKey, fileName };
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
  /** 생략 = 기존 값 유지(신규는 공개). */
  isPublic?: boolean;
  /** 문서 분석 때 보관한 증빙(storeCredentialFile). 생략 = 기존 파일 유지. */
  file?: { storageKey: string; fileName: string } | null;
}): Promise<CompanyCredential> {
  const name = s(input.name);
  if (!name) throw new Error("면허/인증 명칭을 입력하세요.");
  const kind = normalizeCredentialKind(input.kind);
  const now = new Date().toISOString();
  const credentialId = s(input.credentialId) || "ccr_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  // 증빙 키는 서버가 만든 company/credentials/ 키만 받는다(임의 저장소 키로 다른 문서를 묶지 못하게).
  const fileKey = input.file && s(input.file.storageKey).startsWith("company/credentials/") ? s(input.file.storageKey) : null;
  const fileName = fileKey ? s(input.file?.fileName) || "credential" : null;
  await withDbWrite(async (txn) => {
    // 079 이후 INSERT 에 storage_key 가 빠져 있어 분석한 증빙이 저장되지 않았다 — 보관 키를 함께 기록한다.
    await txn.run(
      `INSERT INTO company_credentials
         (credential_id, kind, name, credential_no, issued_at, valid_until, issuer, note, display_order, created_at, updated_at,
          storage_key, file_name, is_public)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $9, $10, $11, COALESCE($12, 1))
       ON CONFLICT (credential_id) DO UPDATE SET
         kind = EXCLUDED.kind,
         name = EXCLUDED.name,
         credential_no = EXCLUDED.credential_no,
         issued_at = EXCLUDED.issued_at,
         valid_until = EXCLUDED.valid_until,
         issuer = EXCLUDED.issuer,
         note = EXCLUDED.note,
         updated_at = EXCLUDED.updated_at,
         storage_key = COALESCE($10, company_credentials.storage_key),
         file_name = CASE WHEN $10::text IS NULL THEN company_credentials.file_name ELSE $11 END,
         is_public = COALESCE($12, company_credentials.is_public)`,
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
        fileKey,
        fileName,
        input.isPublic === undefined ? null : input.isPublic ? 1 : 0,
      ]
    );
    await syncCredentialHistory(txn, { credentialId, kind, name, issuedAt: s(input.issuedAt) });
  });
  const saved = await getCredential(credentialId);
  if (!saved) throw new Error("면허/인증 저장 결과를 읽지 못했습니다.");
  return saved;
}

/** 공개 여부만 바꾼다(회사소개서 인증 쪽 게재). */
export async function setCredentialPublic(credentialId: string, isPublic: boolean): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run("UPDATE company_credentials SET is_public = $2, updated_at = $3 WHERE credential_id = $1", [
      credentialId,
      isPublic ? 1 : 0,
      new Date().toISOString(),
    ]);
  });
}

export async function deleteCredential(credentialId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run("DELETE FROM company_credentials WHERE credential_id = $1", [credentialId]);
    await syncCredentialHistory(txn, { credentialId, deleted: true });
  });
}
