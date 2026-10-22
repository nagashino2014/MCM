import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import type { DisplayOverride } from "./appendix";
import { EXTRA_EMPLOYMENT_TYPES, type CatalogExtraPerson } from "./people-types";

/*
 * 회사소개서 인물 — 임원진(C13)·기술인력(C14·C15)·자문위원(C15). 블루프린트 §6-2·§6-6.
 * 대상은 사용자관리에 등록된 재직자(employee_profiles, status='active') — 퇴사(inactive) 즉시 초안에서 빠진다.
 * 임원 판정(사용자 확인 10-22) = 직급 서열(positions.rank_order)이 '부장'보다 높으면 임원, 부장 이하는 직원.
 *   부장의 서열은 직급표에서 읽고, 없으면 MANAGER_RANK_FALLBACK. 구획은 사람별로 수동 지정할 수 있다.
 * 고문 등 근로계약 없이 자문(촉탁) 계약을 맺은 임원은 사용자관리에 없으므로 catalog_extra_people 로 직접 입력한다.
 * 노출·사진 기본값(D5 권장값): 임원은 실명·사진 게재(사진 거부 시 제외), 직원 사진은 동의한 사람만.
 */

/** 임원 판정 기준 직급명과 직급표에 없을 때의 서열(현행 직급표의 부장 = 70) */
export const MANAGER_POSITION_NAME = "부장";
export const MANAGER_RANK_FALLBACK = 70;

export interface CatalogPersonMeta {
  displayOverride: DisplayOverride;
  sectionOverride: "exec" | "staff" | null;
  orderNo: number | null;
  roleLabel: string;
  bioShort: string;
  /** null 미확인 · true 동의 · false 거부 */
  photoConsent: boolean | null;
  /** 소개서 전용 사진(catalog_assets). null = 인사 사진 사용 */
  photoAssetId: string | null;
}

export interface CatalogPerson {
  employeeId: string;
  name: string;
  deptId: string | null;
  deptName: string;
  positionName: string;
  rankOrder: number | null;
  envGrade: string;
  engGrade: string;
  hiredAt: string;
  /** 인사 사진 공개 경로(employee_profiles.photo_public_path) */
  photoPath: string | null;
  /** 소개서 전용 사진 또는 인사 사진이 있는지 */
  hasPhoto: boolean;
  /** 규칙상 임원인지(수동 지정과 무관) */
  isExecByRule: boolean;
  /** 적용된 구획 — 수동 지정이 규칙보다 우선 */
  section: "exec" | "staff";
  /** 소개서에 싣는지(구획 규칙 + 개별 고정) */
  shown: boolean;
  /** 사진을 싣는지 */
  photoShown: boolean;
  meta: CatalogPersonMeta | null;
}

const s = (v: unknown): string => (v == null ? "" : String(v).trim());

/** 직급 서열이 부장보다 높으면 임원(부장 이하는 직원). 직급이 없으면 직원. */
export function isExecByRule(rankOrder: number | null, managerRank: number = MANAGER_RANK_FALLBACK): boolean {
  return rankOrder != null && rankOrder > managerRank;
}

/** 기술인력 판정 — 통합허가 대행업(env) 또는 엔지니어링(eng) 등급이 있는 직원. */
export function isTechnicalStaff(envGrade: string, engGrade: string): boolean {
  return Boolean(envGrade.trim() || engGrade.trim());
}

export async function listCatalogPeople(): Promise<CatalogPerson[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, e.name, e.dept_id, d.dept_name, p.position_name, p.rank_order,
              COALESCE(e.env_grade, '') AS env_grade, COALESCE(e.eng_grade, '') AS eng_grade,
              COALESCE(e.hired_at, '') AS hired_at, e.photo_public_path,
              (m.employee_id IS NOT NULL) AS has_meta,
              m.display_override, m.section_override, m.order_no, m.role_label, m.bio_short, m.photo_consent, m.photo_asset_id,
              (SELECT MAX(rank_order) FROM positions WHERE position_name = $1) AS manager_rank
         FROM employee_profiles e
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions p ON p.position_id = e.position_id
         LEFT JOIN catalog_people_meta m ON m.employee_id = e.employee_id
        WHERE COALESCE(e.status, 'active') = 'active'
        ORDER BY m.order_no ASC NULLS LAST, p.rank_order DESC NULLS LAST, e.hired_at ASC NULLS LAST, e.name ASC`,
      [MANAGER_POSITION_NAME]
    )
  );
  return rows.map((r) => {
    const deptId = r.dept_id != null ? String(r.dept_id) : null;
    const rankOrder = r.rank_order != null ? Number(r.rank_order) : null;
    const meta: CatalogPersonMeta | null = r.has_meta
      ? {
          displayOverride: (s(r.display_override) === "always" || s(r.display_override) === "never"
            ? s(r.display_override)
            : "auto") as DisplayOverride,
          sectionOverride: s(r.section_override) === "exec" ? "exec" : s(r.section_override) === "staff" ? "staff" : null,
          orderNo: r.order_no != null ? Number(r.order_no) : null,
          roleLabel: s(r.role_label),
          bioShort: s(r.bio_short),
          photoConsent: r.photo_consent == null ? null : Number(r.photo_consent) === 1,
          photoAssetId: r.photo_asset_id != null ? String(r.photo_asset_id) : null,
        }
      : null;
    const managerRank = r.manager_rank != null ? Number(r.manager_rank) : MANAGER_RANK_FALLBACK;
    const execRule = isExecByRule(rankOrder, managerRank);
    const section: "exec" | "staff" = meta?.sectionOverride ?? (execRule ? "exec" : "staff");
    const envGrade = s(r.env_grade);
    const engGrade = s(r.eng_grade);
    const override = meta?.displayOverride ?? "auto";
    const autoShown = section === "exec" ? true : isTechnicalStaff(envGrade, engGrade);
    const shown = override === "always" ? true : override === "never" ? false : autoShown;
    const photoPath = s(r.photo_public_path) || null;
    const hasPhoto = Boolean(meta?.photoAssetId || photoPath);
    const consent = meta?.photoConsent ?? null;
    const photoShown = shown && hasPhoto && (section === "exec" ? consent !== false : consent === true);
    return {
      employeeId: s(r.employee_id),
      name: s(r.name),
      deptId,
      deptName: s(r.dept_name),
      positionName: s(r.position_name),
      rankOrder,
      envGrade,
      engGrade,
      hiredAt: s(r.hired_at),
      photoPath,
      hasPhoto,
      isExecByRule: execRule,
      section,
      shown,
      photoShown,
      meta,
    };
  });
}

export interface PersonMetaPatch {
  displayOverride?: DisplayOverride;
  sectionOverride?: "exec" | "staff" | null;
  orderNo?: number | null;
  roleLabel?: string;
  bioShort?: string;
  photoConsent?: boolean | null;
  /** 소개서 전용 사진(catalog_assets id). null = 지우고 인사 사진 사용 */
  photoAssetId?: string | null;
}

export async function savePersonMeta(employeeId: string, patch: PersonMetaPatch, actorUserId: string | null): Promise<void> {
  const id = s(employeeId);
  if (!id) throw Object.assign(new Error("employeeId 가 필요합니다."), { status: 400 });
  const now = new Date().toISOString();
  const sets: string[] = [];
  const params: unknown[] = [id, now, actorUserId];
  const push = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.displayOverride !== undefined) {
    push("display_override", patch.displayOverride === "always" || patch.displayOverride === "never" ? patch.displayOverride : "auto");
  }
  if (patch.sectionOverride !== undefined) push("section_override", patch.sectionOverride === "exec" || patch.sectionOverride === "staff" ? patch.sectionOverride : null);
  if (patch.orderNo !== undefined) push("order_no", patch.orderNo == null || !Number.isFinite(Number(patch.orderNo)) ? null : Math.round(Number(patch.orderNo)));
  if (patch.roleLabel !== undefined) push("role_label", s(patch.roleLabel).slice(0, 100) || null);
  if (patch.bioShort !== undefined) push("bio_short", s(patch.bioShort).slice(0, 1000) || null);
  if (patch.photoConsent !== undefined) push("photo_consent", patch.photoConsent == null ? null : patch.photoConsent ? 1 : 0);
  if (patch.photoAssetId !== undefined) {
    // 없는 자산 id 는 연결하지 않는다
    params.push(s(patch.photoAssetId) || null);
    sets.push(`photo_asset_id = (SELECT asset_id FROM catalog_assets WHERE asset_id = $${params.length})`);
  }
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO catalog_people_meta (employee_id, updated_by, updated_at)
       SELECT employee_id, $3, $2 FROM employee_profiles WHERE employee_id = $1
       ON CONFLICT (employee_id) DO NOTHING`,
      params.slice(0, 3)
    );
    if (sets.length > 0) {
      await txn.run(
        `UPDATE catalog_people_meta SET ${sets.join(", ")}, updated_by = $3, updated_at = $2 WHERE employee_id = $1`,
        params
      );
    }
  });
}

// ─────────────────────────────── 직접 입력 임원(촉탁) ───────────────────────────────

export { EXTRA_EMPLOYMENT_TYPES } from "./people-types";
export type { CatalogExtraPerson } from "./people-types";

function mapExtra(r: Record<string, unknown>): CatalogExtraPerson {
  const t = s(r.employment_type);
  return {
    personId: s(r.person_id),
    name: s(r.name),
    roleLabel: s(r.role_label),
    employmentType: ((EXTRA_EMPLOYMENT_TYPES as readonly string[]).includes(t) ? t : "촉탁") as CatalogExtraPerson["employmentType"],
    bioShort: s(r.bio_short),
    career: s(r.career),
    photoAssetId: r.photo_asset_id != null ? String(r.photo_asset_id) : null,
    orderNo: r.order_no != null ? Number(r.order_no) : null,
    isPublic: Number(r.is_public ?? 1) === 1,
    countInTotal: Number(r.count_in_total ?? 1) === 1,
  };
}

export async function listExtraPeople(): Promise<CatalogExtraPerson[]> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec("SELECT * FROM catalog_extra_people ORDER BY order_no ASC NULLS LAST, name ASC"));
  return rows.map(mapExtra);
}

export async function saveExtraPerson(input: Partial<CatalogExtraPerson> & { name: string }, actorUserId: string | null): Promise<string> {
  const name = s(input.name);
  if (!name) throw Object.assign(new Error("이름을 입력하세요."), { status: 400 });
  const personId = s(input.personId) || "cxp_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const type = (EXTRA_EMPLOYMENT_TYPES as readonly string[]).includes(s(input.employmentType)) ? s(input.employmentType) : "촉탁";
  const orderNo = input.orderNo == null || !Number.isFinite(Number(input.orderNo)) ? null : Math.round(Number(input.orderNo));
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO catalog_extra_people
         (person_id, name, role_label, employment_type, bio_short, career, photo_asset_id, order_no, is_public, count_in_total,
          created_at, created_by, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, (SELECT asset_id FROM catalog_assets WHERE asset_id = $7), $8, $9, $10, $11, $12, $11, $12)
       ON CONFLICT (person_id) DO UPDATE SET
         name = EXCLUDED.name, role_label = EXCLUDED.role_label, employment_type = EXCLUDED.employment_type,
         bio_short = EXCLUDED.bio_short, career = EXCLUDED.career, photo_asset_id = EXCLUDED.photo_asset_id,
         order_no = EXCLUDED.order_no, is_public = EXCLUDED.is_public, count_in_total = EXCLUDED.count_in_total,
         updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [
        personId,
        name.slice(0, 50),
        s(input.roleLabel).slice(0, 100) || null,
        type,
        s(input.bioShort).slice(0, 1000) || null,
        s(input.career).slice(0, 4000) || null,
        s(input.photoAssetId) || null,
        orderNo,
        input.isPublic === false ? 0 : 1,
        input.countInTotal === false ? 0 : 1,
        now,
        actorUserId,
      ]
    );
  });
  return personId;
}

export async function deleteExtraPerson(personId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run("DELETE FROM catalog_extra_people WHERE person_id = $1", [s(personId)]);
  });
}

// ─────────────────────────────── 자문위원 ───────────────────────────────

export interface CatalogAdvisor {
  advisorId: string;
  name: string;
  field: string;
  org: string;
  title: string;
  career: string;
  orderNo: number;
  isPublic: boolean;
}

function mapAdvisor(r: Record<string, unknown>): CatalogAdvisor {
  return {
    advisorId: s(r.advisor_id),
    name: s(r.name),
    field: s(r.field),
    org: s(r.org),
    title: s(r.title),
    career: s(r.career),
    orderNo: Number(r.order_no ?? 0),
    isPublic: Number(r.is_public ?? 1) === 1,
  };
}

export async function listAdvisors(): Promise<CatalogAdvisor[]> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec("SELECT * FROM catalog_advisors ORDER BY order_no ASC, name ASC"));
  return rows.map(mapAdvisor);
}

export async function saveAdvisor(
  input: Partial<CatalogAdvisor> & { name: string },
  actorUserId: string | null
): Promise<CatalogAdvisor> {
  const name = s(input.name);
  if (!name) throw Object.assign(new Error("자문위원 이름을 입력하세요."), { status: 400 });
  const advisorId = s(input.advisorId) || "cad_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const now = new Date().toISOString();
  await withDbWrite(async (txn) => {
    await txn.run(
      `INSERT INTO catalog_advisors (advisor_id, name, field, org, title, career, order_no, is_public, created_at, updated_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10)
       ON CONFLICT (advisor_id) DO UPDATE SET
         name = EXCLUDED.name, field = EXCLUDED.field, org = EXCLUDED.org, title = EXCLUDED.title,
         career = EXCLUDED.career, order_no = EXCLUDED.order_no, is_public = EXCLUDED.is_public,
         updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
      [
        advisorId,
        name.slice(0, 50),
        s(input.field).slice(0, 100) || null,
        s(input.org).slice(0, 200) || null,
        s(input.title).slice(0, 100) || null,
        s(input.career).slice(0, 2000) || null,
        Number.isFinite(Number(input.orderNo)) ? Math.round(Number(input.orderNo)) : 0,
        input.isPublic === false ? 0 : 1,
        now,
        actorUserId,
      ]
    );
  });
  return (await listAdvisors()).find((a) => a.advisorId === advisorId)!;
}

export async function deleteAdvisor(advisorId: string): Promise<void> {
  await withDbWrite(async (txn) => {
    await txn.run("DELETE FROM catalog_advisors WHERE advisor_id = $1", [s(advisorId)]);
  });
}
