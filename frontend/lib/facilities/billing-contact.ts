/**
 * 사업장 세금계산서 담당자(facility_contact_people.dept_types 에 'billing') 판정·등록.
 * 발행 요청(H10) 시 발주처 사업장에 계산서 수신 담당자가 없으면 요청자가 함께 입력하게 한다(2026-11-02).
 *
 * 등록은 사업장 담당자 화면의 replace-all 저장(PUT /api/facilities/[id]/contacts)을 거치지 않고
 * 한 행만 추가·갱신한다 — 다른 담당자의 id·명함 원본·일정 연결을 건드리지 않기 위해서다.
 */
import { rowsToObjects, type PgDatabase } from "@/lib/db";

export interface BillingContactInput {
  name: string;
  title: string;
  department: string;
  phone: string;
  email: string;
}

/** 'billing' 태그 판정식 — 187 이전 데이터(dept_type 단일 값)도 같이 본다. */
const BILLING_TAG_SQL = `'billing' = ANY(COALESCE(NULLIF(p.dept_types, '{}'), CASE WHEN p.dept_type IS NULL THEN '{}'::text[] ELSE ARRAY[p.dept_type] END))`;

/** 계산서 담당자 = 재직(active) + 'billing' 태그 + 이메일 보유(바로빌 수신처라 이메일이 없으면 쓸 수 없다). */
export const HAS_BILLING_CONTACT_SQL = (facilityExpr: string) => `EXISTS (
  SELECT 1 FROM facility_contact_people p
   WHERE p.facility_id = ${facilityExpr}
     AND p.status = 'active'
     AND ${BILLING_TAG_SQL}
     AND NULLIF(TRIM(p.email), '') IS NOT NULL)`;

/** 화면 표시용 계산서 담당자 — 요청 창에서 현재 담당자를 확인·변경할 수 있게 보여 준다. */
export interface BillingContactView {
  name: string;
  title: string | null;
  department: string | null;
  phone: string | null;
  email: string;
}

/** 사업장별 계산서 담당자(이메일 있는 재직 'billing' 태그) 목록 — 발행 모달의 대표 수신처 순서(이름순)와 맞춘다. */
export async function listBillingContacts(db: PgDatabase, facilityIds: string[]): Promise<Map<string, BillingContactView[]>> {
  const out = new Map<string, BillingContactView[]>();
  if (!facilityIds.length) return out;
  const rows = rowsToObjects(
    await db.exec(
      `SELECT p.facility_id, p.person_name, p.title, d.department_name, p.office_phone, p.mobile_phone, p.email
         FROM facility_contact_people p
         LEFT JOIN facility_contact_departments d ON d.id = p.department_id
        WHERE p.facility_id = ANY($1::text[])
          AND p.status = 'active'
          AND ${BILLING_TAG_SQL}
          AND NULLIF(TRIM(p.email), '') IS NOT NULL
        ORDER BY p.facility_id, p.person_name, p.id`,
      [facilityIds],
    ),
  );
  for (const r of rows) {
    const key = String(r.facility_id);
    const list = out.get(key) ?? [];
    list.push({
      name: String(r.person_name ?? ""),
      title: r.title != null ? String(r.title) : null,
      department: r.department_name != null ? String(r.department_name) : null,
      phone: r.mobile_phone != null ? String(r.mobile_phone) : r.office_phone != null ? String(r.office_phone) : null,
      email: String(r.email),
    });
    out.set(key, list);
  }
  return out;
}

export async function hasBillingContact(db: PgDatabase, facilityId: string): Promise<boolean> {
  const rows = rowsToObjects(await db.exec(`SELECT ${HAS_BILLING_CONTACT_SQL("$1")} AS ok`, [facilityId]));
  return rows[0]?.ok === true || rows[0]?.ok === "t";
}

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/** 입력 정규화 + 필수값 검사. 문제가 있으면 사용자에게 보일 문장을 돌려준다. */
export function parseBillingContact(raw: unknown): { value: BillingContactInput | null; error: string | null } {
  if (!raw || typeof raw !== "object") return { value: null, error: null };
  const src = raw as Record<string, unknown>;
  const pick = (key: string) => String(src[key] ?? "").trim();
  const value: BillingContactInput = {
    name: pick("name"),
    title: pick("title"),
    department: pick("department"),
    phone: pick("phone"),
    email: pick("email"),
  };
  const missing = [
    ["성명", value.name],
    ["직급", value.title],
    ["부서", value.department],
    ["연락처", value.phone],
    ["이메일", value.email],
  ]
    .filter(([, v]) => !v)
    .map(([label]) => label);
  if (missing.length) return { value: null, error: `세금계산서 담당자 정보를 모두 입력해 주세요(빠진 항목: ${missing.join("·")}).` };
  if (!isEmail(value.email)) return { value: null, error: "세금계산서 담당자 이메일 형식이 올바르지 않습니다." };
  return { value, error: null };
}

/**
 * 계산서 담당자 변경 — 새 담당자를 등록하고, 다른 담당자에게서는 'billing' 태그만 뗀다
 * (담당자 자체·다른 업무 분류는 그대로 남는다). 발행 모달은 'billing' 태그 담당자를 기본 수신처로 쓴다.
 */
export async function replaceBillingContact(
  db: PgDatabase,
  facilityId: string,
  input: BillingContactInput,
  now: string,
): Promise<number> {
  const id = await upsertBillingContact(db, facilityId, input, now);
  await db.run(
    `UPDATE facility_contact_people p
        SET dept_types = array_remove(COALESCE(NULLIF(p.dept_types, '{}'), CASE WHEN p.dept_type IS NULL THEN '{}'::text[] ELSE ARRAY[p.dept_type] END), 'billing'),
            dept_type = CASE WHEN p.dept_type = 'billing'
                             THEN (array_remove(COALESCE(NULLIF(p.dept_types, '{}'), ARRAY[p.dept_type]), 'billing'))[1]
                             ELSE p.dept_type END,
            updated_at = $3
      WHERE p.facility_id = $1 AND p.id <> $2 AND ${BILLING_TAG_SQL}`,
    [facilityId, id, now],
  );
  return id;
}

/**
 * 계산서 담당자 등록 — 같은 이름·이메일의 재직 담당자가 있으면 'billing' 태그만 더하고,
 * 없으면 새 담당자로 추가한다. 부서는 이름으로 찾고 없으면 새로 만든다. 반환: 담당자 id.
 */
export async function upsertBillingContact(
  db: PgDatabase,
  facilityId: string,
  input: BillingContactInput,
  now: string,
): Promise<number> {
  const existingDept = rowsToObjects(
    await db.exec(
      `SELECT id FROM facility_contact_departments
        WHERE facility_id = $1 AND LOWER(TRIM(department_name)) = LOWER($2)
        ORDER BY id LIMIT 1`,
      [facilityId, input.department],
    ),
  )[0];
  const departmentId = existingDept
    ? Number(existingDept.id)
    : Number(
        (
          await db.exec(
            `INSERT INTO facility_contact_departments (facility_id, department_name, created_at, updated_at)
             VALUES ($1, $2, $3, $3) RETURNING id`,
            [facilityId, input.department, now],
          )
        )[0]?.values[0]?.[0] ?? 0,
      );

  // 010·011 등 휴대전화는 mobile_phone, 그 외는 사무실 전화로 둔다(발행 모달은 tel → mobile 순으로 쓴다).
  const isMobile = /^01[016789]/.test(input.phone.replace(/[^0-9]/g, ""));

  const same = rowsToObjects(
    await db.exec(
      `SELECT id, dept_type, dept_types FROM facility_contact_people
        WHERE facility_id = $1 AND status = 'active'
          AND TRIM(person_name) = $2 AND LOWER(TRIM(COALESCE(email, ''))) = LOWER($3)
        ORDER BY id LIMIT 1`,
      [facilityId, input.name, input.email],
    ),
  )[0];
  if (same) {
    const current = Array.isArray(same.dept_types) && same.dept_types.length
      ? (same.dept_types as unknown[]).map(String)
      : same.dept_type != null ? [String(same.dept_type)] : [];
    const tags = current.includes("billing") ? current : [...current, "billing"];
    await db.run(
      `UPDATE facility_contact_people
          SET dept_types = $2, dept_type = COALESCE(dept_type, $3),
              title = COALESCE(NULLIF(title, ''), $4),
              department_id = COALESCE(department_id, $5),
              ${isMobile ? "mobile_phone = COALESCE(NULLIF(mobile_phone, ''), $6)" : "office_phone = COALESCE(NULLIF(office_phone, ''), $6)"},
              updated_at = $7
        WHERE id = $1`,
      [Number(same.id), tags, tags[0], input.title, departmentId || null, input.phone, now],
    );
    return Number(same.id);
  }

  const inserted = await db.exec(
    `INSERT INTO facility_contact_people
       (facility_id, department_id, person_name, title, office_phone, mobile_phone, email,
        status, dept_type, dept_types, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', 'billing', $8, $9, $9)
     RETURNING id`,
    [
      facilityId,
      departmentId || null,
      input.name,
      input.title,
      isMobile ? null : input.phone,
      isMobile ? input.phone : null,
      input.email,
      ["billing"],
      now,
    ],
  );
  return Number(inserted[0]?.values[0]?.[0] ?? 0);
}
