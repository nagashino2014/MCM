import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";

export const POSITION_OPTIONS = [
  "대표이사",
  "상무",
  "전무",
  "총괄본부장",
  "이사",
  "연구소장",
  "울산지사장",
  "전문위원",
  "부장",
  "차장",
  "과장",
  "대리",
  "사원",
  "선임연구원",
  "주임연구원",
] as const;

export const CERTIFICATION_OPTIONS = [
  "대기관리기술사",
  "수질관리기술사",
  "대기환경기사",
  "수질환경기사",
  "폐기물처리기사",
  "온실가스관리기사",
  "토양환경기사",
  "소음진동기사",
  "화공기사",
  "산업안전기사",
] as const;

// 엔지니어링협회 기술등급 (수행인력 명단의 '기술등급' 칸에 사용)
export const ENG_GRADE_OPTIONS = ["기술사", "특급", "고급", "중급", "초급"] as const;
// 환경부 통합허가 대행업 등급 base (전문분야=대기관리면 표시 시 '(대기)' 부착)
export const ENV_GRADE_OPTIONS = ["고급인력", "일반인력", "미구분"] as const;
// 전문분야
export const SPECIALTY_OPTIONS = ["대기관리", "수질관리"] as const;

/** 환경부 등급 표시 라벨: 전문분야가 대기관리면 '(대기)'를 부착한다. */
export function envGradeLabel(
  envGrade?: string | null,
  specialtyField?: string | null
): string {
  const base = (envGrade ?? "").trim();
  if (!base) return "";
  return specialtyField === "대기관리" ? `${base}(대기)` : base;
}

export type Gender = "male" | "female";
export type DegreeLevel = "bachelor" | "master" | "doctor";

export interface EmployeeListItem {
  employeeId: string;
  userId: string | null;
  name: string;
  deptId: string | null;
  deptName: string | null;
  positionId: string | null;
  positionName: string | null;
  email: string | null;
  mobilePhone: string | null;
  status: "active" | "inactive";
}

export interface EmployeeEducation {
  educationId?: string;
  degreeLevel: DegreeLevel;
  schoolName: string;
  major?: string | null;
  degreeName?: string | null;
  admissionDate?: string | null;
  graduationDate?: string | null;
  displayOrder?: number;
}

export interface EmployeeCertification {
  certificationId?: string;
  certificationName: string;
  passedAt?: string | null;
  issuedAt?: string | null;
  certificationNo?: string | null;
  displayOrder?: number;
}

export interface EmployeeCareer {
  careerId?: string;
  workedFrom?: string | null;
  workedTo?: string | null;
  companyName?: string | null;
  finalPosition?: string | null;
  responsibilities?: string | null;
  displayOrder?: number;
}

export interface EmployeeHousingSupport {
  housingId?: string;
  leaseStartedAt?: string | null;
  leaseEndedAt?: string | null;
  monthlyRent?: number | null;
  depositAmount?: number | null;
  address?: string | null;
  landlordName?: string | null;
  memo?: string | null;
}

export interface EmployeeDocumentRow {
  documentId: string;
  employeeId: string;
  targetTable: string;
  targetId: string | null;
  documentType: string;
  displayName: string;
  originalFilename: string | null;
  contentType: string | null;
  byteSize: number | null;
  storageKey: string;
  publicPath: string | null;
  createdAt: string;
}

export interface EmployeeDetail extends EmployeeListItem {
  employeeNo: string | null;
  hiredAt: string | null;
  jobDuties: string | null;
  agentRegisteredAt: string | null;
  engGrade: string | null;
  envGrade: string | null;
  specialtyField: string | null;
  address: string | null;
  residentRegistrationMasked: string | null;
  birthDate: string | null;
  gender: Gender | null;
  nationalityKind: "domestic" | "foreign";
  companyPhone: string | null;
  memo: string | null;
  educations: Required<EmployeeEducation>[];
  certifications: Required<EmployeeCertification>[];
  careers: Required<EmployeeCareer>[];
  housingSupports: Required<EmployeeHousingSupport>[];
  documents: EmployeeDocumentRow[];
}

export interface SaveEmployeeInput {
  employeeId?: string;
  userId?: string | null;
  employeeNo?: string | null;
  name: string;
  deptId?: string | null;
  positionId?: string | null;
  hiredAt?: string | null;
  jobDuties?: string | null;
  agentRegisteredAt?: string | null;
  engGrade?: string | null;
  envGrade?: string | null;
  specialtyField?: string | null;
  address?: string | null;
  residentRegistrationNo?: string | null;
  mobilePhone?: string | null;
  email?: string | null;
  companyPhone?: string | null;
  status?: "active" | "inactive";
  memo?: string | null;
  educations?: EmployeeEducation[];
  certifications?: EmployeeCertification[];
  careers?: EmployeeCareer[];
  housingSupports?: EmployeeHousingSupport[];
}

interface RrnInfo {
  masked: string;
  encrypted: string;
  birthDate: string;
  gender: Gender;
  nationalityKind: "domestic" | "foreign";
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function nullable(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function encryptionKey(): Buffer {
  const source =
    process.env.EMPLOYEE_PII_ENCRYPTION_KEY ||
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    "mcm-local-development-key";
  return crypto.createHash("sha256").update(source).digest();
}

function encrypt(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function parseResidentRegistrationNo(value: string): RrnInfo {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 13) {
    throw new Error("주민번호는 13자리 숫자여야 합니다.");
  }
  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  const genderCode = digits[6];
  const codeMap: Record<string, { century: number; gender: Gender; nationalityKind: "domestic" | "foreign" }> = {
    "1": { century: 1900, gender: "male", nationalityKind: "domestic" },
    "2": { century: 1900, gender: "female", nationalityKind: "domestic" },
    "3": { century: 2000, gender: "male", nationalityKind: "domestic" },
    "4": { century: 2000, gender: "female", nationalityKind: "domestic" },
    "5": { century: 1900, gender: "male", nationalityKind: "foreign" },
    "6": { century: 1900, gender: "female", nationalityKind: "foreign" },
    "7": { century: 2000, gender: "male", nationalityKind: "foreign" },
    "8": { century: 2000, gender: "female", nationalityKind: "foreign" },
    "9": { century: 1800, gender: "male", nationalityKind: "domestic" },
    "0": { century: 1800, gender: "female", nationalityKind: "domestic" },
  };
  const meta = codeMap[genderCode];
  if (!meta) throw new Error("주민번호 성별 코드가 올바르지 않습니다.");
  const year = meta.century + yy;
  const date = new Date(Date.UTC(year, mm - 1, dd));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== mm - 1 || date.getUTCDate() !== dd) {
    throw new Error("주민번호 생년월일이 올바르지 않습니다.");
  }
  return {
    masked: `${digits.slice(0, 6)}-${genderCode}******`,
    encrypted: encrypt(digits),
    birthDate: `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`,
    gender: meta.gender,
    nationalityKind: meta.nationalityKind,
  };
}

function rowToListItem(row: Record<string, unknown>): EmployeeListItem {
  return {
    employeeId: String(row.employee_id ?? ""),
    userId: row.user_id != null ? String(row.user_id) : null,
    name: String(row.name ?? ""),
    deptId: row.dept_id != null ? String(row.dept_id) : null,
    deptName: row.dept_name != null ? String(row.dept_name) : null,
    positionId: row.position_id != null ? String(row.position_id) : null,
    positionName: row.position_name != null ? String(row.position_name) : null,
    email: row.email != null ? String(row.email) : null,
    mobilePhone: row.mobile_phone != null ? String(row.mobile_phone) : null,
    status: String(row.status ?? "active") as "active" | "inactive",
  };
}

export async function listEmployees(): Promise<EmployeeListItem[]> {
  const db = await getDb();
  const result = await db.exec(
    `SELECT e.employee_id, e.user_id, e.name, e.dept_id, d.dept_name, e.position_id, p.position_name,
            e.email, e.mobile_phone, e.status
       FROM employee_profiles e
       LEFT JOIN departments d ON d.dept_id = e.dept_id
       LEFT JOIN positions p ON p.position_id = e.position_id
      ORDER BY COALESCE(d.display_order, 999), p.rank_order DESC NULLS LAST, e.name ASC`
  );
  return rowsToObjects(result).map(rowToListItem);
}

export async function getEmployeeDetail(employeeId: string): Promise<EmployeeDetail | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.*, d.dept_name, p.position_name
         FROM employee_profiles e
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions p ON p.position_id = e.position_id
        WHERE e.employee_id = $1
        LIMIT 1`,
      [employeeId]
    )
  );
  if (!rows.length) return null;
  const row = rows[0];
  const [educations, certifications, careers, housingSupports, documents] = await Promise.all([
    db.exec(
      "SELECT * FROM employee_educations WHERE employee_id = $1 ORDER BY display_order ASC",
      [employeeId]
    ),
    db.exec(
      "SELECT * FROM employee_certifications WHERE employee_id = $1 ORDER BY display_order ASC",
      [employeeId]
    ),
    db.exec("SELECT * FROM employee_careers WHERE employee_id = $1 ORDER BY display_order ASC", [
      employeeId,
    ]),
    db.exec(
      "SELECT * FROM employee_housing_supports WHERE employee_id = $1 ORDER BY created_at ASC",
      [employeeId]
    ),
    db.exec(
      "SELECT * FROM employee_documents WHERE employee_id = $1 ORDER BY created_at DESC",
      [employeeId]
    ),
  ]);

  return {
    ...rowToListItem(row),
    employeeNo: row.employee_no != null ? String(row.employee_no) : null,
    hiredAt: row.hired_at != null ? String(row.hired_at) : null,
    jobDuties: row.job_duties != null ? String(row.job_duties) : null,
    agentRegisteredAt: row.agent_registered_at != null ? String(row.agent_registered_at) : null,
    engGrade: row.eng_grade != null ? String(row.eng_grade) : null,
    envGrade: row.env_grade != null ? String(row.env_grade) : null,
    specialtyField: row.specialty_field != null ? String(row.specialty_field) : null,
    address: row.address != null ? String(row.address) : null,
    residentRegistrationMasked:
      row.resident_registration_masked != null ? String(row.resident_registration_masked) : null,
    birthDate: row.birth_date != null ? String(row.birth_date) : null,
    gender: row.gender != null ? (String(row.gender) as Gender) : null,
    nationalityKind: String(row.nationality_kind ?? "domestic") as "domestic" | "foreign",
    companyPhone: row.company_phone != null ? String(row.company_phone) : null,
    memo: row.memo != null ? String(row.memo) : null,
    educations: rowsToObjects(educations).map((item) => ({
      educationId: String(item.education_id ?? ""),
      degreeLevel: String(item.degree_level ?? "bachelor") as DegreeLevel,
      schoolName: String(item.school_name ?? ""),
      major: nullable(item.major),
      degreeName: nullable(item.degree_name),
      admissionDate: nullable(item.admission_date),
      graduationDate: nullable(item.graduation_date),
      displayOrder: Number(item.display_order ?? 100),
    })),
    certifications: rowsToObjects(certifications).map((item) => ({
      certificationId: String(item.certification_id ?? ""),
      certificationName: String(item.certification_name ?? ""),
      passedAt: nullable(item.passed_at),
      issuedAt: nullable(item.issued_at),
      certificationNo: nullable(item.certification_no),
      displayOrder: Number(item.display_order ?? 100),
    })),
    careers: rowsToObjects(careers).map((item) => ({
      careerId: String(item.career_id ?? ""),
      workedFrom: nullable(item.worked_from),
      workedTo: nullable(item.worked_to),
      companyName: nullable(item.company_name),
      finalPosition: nullable(item.final_position),
      responsibilities: nullable(item.responsibilities),
      displayOrder: Number(item.display_order ?? 100),
    })),
    housingSupports: rowsToObjects(housingSupports).map((item) => ({
      housingId: String(item.housing_id ?? ""),
      leaseStartedAt: nullable(item.lease_started_at),
      leaseEndedAt: nullable(item.lease_ended_at),
      monthlyRent: numOrNull(item.monthly_rent),
      depositAmount: numOrNull(item.deposit_amount),
      address: nullable(item.address),
      landlordName: nullable(item.landlord_name),
      memo: nullable(item.memo),
    })),
    documents: rowsToObjects(documents).map((item) => ({
      documentId: String(item.document_id ?? ""),
      employeeId: String(item.employee_id ?? ""),
      targetTable: String(item.target_table ?? ""),
      targetId: nullable(item.target_id),
      documentType: String(item.document_type ?? ""),
      displayName: String(item.display_name ?? ""),
      originalFilename: nullable(item.original_filename),
      contentType: nullable(item.content_type),
      byteSize: numOrNull(item.byte_size),
      storageKey: String(item.storage_key ?? ""),
      publicPath: nullable(item.public_path),
      createdAt: String(item.created_at ?? ""),
    })),
  };
}

export async function saveEmployeeDetail(
  actorUserId: string,
  input: SaveEmployeeInput
): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error("성명이 필요합니다.");
  const employeeId = input.employeeId?.trim() || id("emp");
  const now = new Date().toISOString();
  const rrn = input.residentRegistrationNo?.trim()
    ? parseResidentRegistrationNo(input.residentRegistrationNo)
    : null;

  await withDbWrite(async (db) => {
    const before = rowsToObjects(
      await db.exec("SELECT * FROM employee_profiles WHERE employee_id = $1 LIMIT 1", [
        employeeId,
      ])
    )[0];
    await db.run(
      `INSERT INTO employee_profiles
        (employee_id, user_id, employee_no, name, dept_id, position_id, hired_at, job_duties,
         agent_registered_at, eng_grade, env_grade, specialty_field, address,
         resident_registration_encrypted, resident_registration_masked, birth_date, gender,
         nationality_kind, mobile_phone, email, company_phone, status, memo, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $25)
       ON CONFLICT (employee_id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         employee_no = EXCLUDED.employee_no,
         name = EXCLUDED.name,
         dept_id = EXCLUDED.dept_id,
         position_id = EXCLUDED.position_id,
         hired_at = EXCLUDED.hired_at,
         job_duties = EXCLUDED.job_duties,
         agent_registered_at = EXCLUDED.agent_registered_at,
         eng_grade = EXCLUDED.eng_grade,
         env_grade = EXCLUDED.env_grade,
         specialty_field = EXCLUDED.specialty_field,
         address = EXCLUDED.address,
         resident_registration_encrypted = COALESCE(EXCLUDED.resident_registration_encrypted, employee_profiles.resident_registration_encrypted),
         resident_registration_masked = COALESCE(EXCLUDED.resident_registration_masked, employee_profiles.resident_registration_masked),
         birth_date = COALESCE(EXCLUDED.birth_date, employee_profiles.birth_date),
         gender = COALESCE(EXCLUDED.gender, employee_profiles.gender),
         nationality_kind = COALESCE(EXCLUDED.nationality_kind, employee_profiles.nationality_kind),
         mobile_phone = EXCLUDED.mobile_phone,
         email = EXCLUDED.email,
         company_phone = EXCLUDED.company_phone,
         status = EXCLUDED.status,
         memo = EXCLUDED.memo,
         updated_at = EXCLUDED.updated_at`,
      [
        employeeId,
        input.userId || null,
        nullable(input.employeeNo),
        name,
        input.deptId || null,
        input.positionId || null,
        nullable(input.hiredAt),
        nullable(input.jobDuties),
        nullable(input.agentRegisteredAt),
        nullable(input.engGrade),
        nullable(input.envGrade),
        nullable(input.specialtyField),
        nullable(input.address),
        rrn?.encrypted ?? null,
        rrn?.masked ?? null,
        rrn?.birthDate ?? null,
        rrn?.gender ?? null,
        rrn?.nationalityKind ?? "domestic",
        nullable(input.mobilePhone),
        nullable(input.email),
        nullable(input.companyPhone),
        input.status || "active",
        nullable(input.memo),
        actorUserId,
        now,
      ]
    );

    await replaceChildren(db, employeeId, input, now);

    if (input.userId) {
      await db.run(
        `UPDATE users
            SET name = $1,
                email = COALESCE($2, email),
                dept_id = $3,
                position_id = $4,
                employee_id = $5,
                hired_at = $6,
                company_phone = $7,
                updated_at = $8
          WHERE user_id = $9`,
        [
          name,
          nullable(input.email),
          input.deptId || null,
          input.positionId || null,
          employeeId,
          nullable(input.hiredAt),
          nullable(input.companyPhone),
          now,
          input.userId,
        ]
      );
    }

    await recordAuditLogInline(db, {
      actorUserId,
      action: "employee_update",
      targetTable: "employee_profiles",
      targetId: employeeId,
      before,
      after: { ...input, residentRegistrationNo: rrn ? rrn.masked : undefined },
    });
  });

  return employeeId;
}

async function replaceChildren(
  db: { run: (sql: string, params?: unknown[]) => Promise<void> },
  employeeId: string,
  input: SaveEmployeeInput,
  now: string
): Promise<void> {
  if (input.educations) {
    await db.run("DELETE FROM employee_educations WHERE employee_id = $1", [employeeId]);
    for (const [index, item] of input.educations.entries()) {
      if (!item.schoolName?.trim()) continue;
      await db.run(
        `INSERT INTO employee_educations
          (education_id, employee_id, degree_level, school_name, major, degree_name, admission_date, graduation_date, display_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
        [
          item.educationId || id("edu"),
          employeeId,
          item.degreeLevel || "bachelor",
          item.schoolName.trim(),
          nullable(item.major),
          nullable(item.degreeName),
          nullable(item.admissionDate),
          nullable(item.graduationDate),
          item.displayOrder ?? index,
          now,
        ]
      );
    }
  }
  if (input.certifications) {
    await db.run("DELETE FROM employee_certifications WHERE employee_id = $1", [employeeId]);
    for (const [index, item] of input.certifications.entries()) {
      if (!item.certificationName?.trim()) continue;
      await db.run(
        `INSERT INTO employee_certifications
          (certification_id, employee_id, certification_name, passed_at, issued_at, certification_no, display_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          item.certificationId || id("cert"),
          employeeId,
          item.certificationName.trim(),
          nullable(item.passedAt),
          nullable(item.issuedAt),
          nullable(item.certificationNo),
          item.displayOrder ?? index,
          now,
        ]
      );
    }
  }
  if (input.careers) {
    await db.run("DELETE FROM employee_careers WHERE employee_id = $1", [employeeId]);
    for (const [index, item] of input.careers.entries()) {
      if (!item.companyName?.trim() && !item.responsibilities?.trim()) continue;
      await db.run(
        `INSERT INTO employee_careers
          (career_id, employee_id, worked_from, worked_to, company_name, final_position, responsibilities, display_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
        [
          item.careerId || id("career"),
          employeeId,
          nullable(item.workedFrom),
          nullable(item.workedTo),
          nullable(item.companyName),
          nullable(item.finalPosition),
          nullable(item.responsibilities),
          item.displayOrder ?? index,
          now,
        ]
      );
    }
  }
  if (input.housingSupports) {
    await db.run("DELETE FROM employee_housing_supports WHERE employee_id = $1", [employeeId]);
    for (const item of input.housingSupports) {
      if (!item.address?.trim() && !item.leaseStartedAt && !item.monthlyRent) continue;
      await db.run(
        `INSERT INTO employee_housing_supports
          (housing_id, employee_id, lease_started_at, lease_ended_at, monthly_rent, deposit_amount, address, landlord_name, memo, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
        [
          item.housingId || id("housing"),
          employeeId,
          nullable(item.leaseStartedAt),
          nullable(item.leaseEndedAt),
          numOrNull(item.monthlyRent),
          numOrNull(item.depositAmount),
          nullable(item.address),
          nullable(item.landlordName),
          nullable(item.memo),
          now,
        ]
      );
    }
  }
}

export async function findEmployeeDocumentByKey(storageKey: string): Promise<EmployeeDocumentRow | null> {
  const db = await getDb();
  const row = rowsToObjects(
    await db.exec("SELECT * FROM employee_documents WHERE storage_key = $1 LIMIT 1", [storageKey])
  )[0];
  if (!row) return null;
  return {
    documentId: String(row.document_id ?? ""),
    employeeId: String(row.employee_id ?? ""),
    targetTable: String(row.target_table ?? ""),
    targetId: nullable(row.target_id),
    documentType: String(row.document_type ?? ""),
    displayName: String(row.display_name ?? ""),
    originalFilename: nullable(row.original_filename),
    contentType: nullable(row.content_type),
    byteSize: numOrNull(row.byte_size),
    storageKey: String(row.storage_key ?? ""),
    publicPath: nullable(row.public_path),
    createdAt: String(row.created_at ?? ""),
  };
}

export async function recordEmployeeDocument(params: {
  actorUserId: string;
  employeeId: string;
  targetTable: string;
  targetId?: string | null;
  documentType: string;
  displayName: string;
  originalFilename: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  storageProvider: "local" | "s3";
  storageBucket: string | null;
  storageKey: string;
  publicPath: string;
}): Promise<EmployeeDocumentRow> {
  const documentId = id("doc");
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO employee_documents
        (document_id, employee_id, target_table, target_id, document_type, display_name, original_filename,
         content_type, byte_size, sha256, storage_provider, storage_bucket, storage_key, public_path, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)`,
      [
        documentId,
        params.employeeId,
        params.targetTable,
        params.targetId || null,
        params.documentType,
        params.displayName,
        params.originalFilename,
        params.contentType,
        params.byteSize,
        params.sha256,
        params.storageProvider,
        params.storageBucket,
        params.storageKey,
        params.publicPath,
        params.actorUserId,
        now,
      ]
    );
    await recordAuditLogInline(db, {
      actorUserId: params.actorUserId,
      action: "employee_document_upload",
      targetTable: "employee_documents",
      targetId: documentId,
      after: { employeeId: params.employeeId, documentType: params.documentType },
    });
  });
  return {
    documentId,
    employeeId: params.employeeId,
    targetTable: params.targetTable,
    targetId: params.targetId || null,
    documentType: params.documentType,
    displayName: params.displayName,
    originalFilename: params.originalFilename,
    contentType: params.contentType,
    byteSize: params.byteSize,
    storageKey: params.storageKey,
    publicPath: params.publicPath,
    createdAt: now,
  };
}
