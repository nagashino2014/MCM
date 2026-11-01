/**
 * 주소록·조직도(G6-A) — 사내 임직원 디렉터리 조회 + 메일 수신자 자동완성 소스.
 * 재직(active) 인원의 이름·부서·직급·회사메일(mailbox)·휴대폰·사내전화·사진만 노출한다
 * (주민번호·생일·주소·메모 등 인사 민감정보는 포함하지 않는다 — 전 직원 열람 화면).
 * 설계: docs/groupware-ux-overhaul-blueprint.md §7 (메일 자동완성·결재선과 공유).
 */
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { MAIL_DOMAIN } from "@/lib/mail/mailbox";
import type { OrgCategory } from "@/lib/directory-categories";

export { ORG_CATEGORIES, isOrgCategory, type OrgCategory } from "@/lib/directory-categories";

export interface DirectoryDepartment {
  deptId: string;
  deptName: string;
  parentDeptId: string | null;
  displayOrder: number;
  accentColor: string | null;
}

export interface DirectoryPerson {
  employeeId: string;
  /** 연결된 계정 user_id — 메신저 새 대화 등 계정 단위 기능용(계정 없는 직원은 null). */
  userId: string | null;
  name: string;
  deptId: string | null;
  deptName: string | null;
  positionName: string | null;
  positionRankOrder: number | null;
  companyEmail: string | null;
  mobilePhone: string | null;
  companyPhone: string | null;
  photoPath: string | null;
  hiredAt: string | null;
  jobDuties: string | null;
}

export async function listDirectory(): Promise<{ departments: DirectoryDepartment[]; people: DirectoryPerson[] }> {
  const db = await getDb();
  const deptRows = rowsToObjects(
    await db.exec(
      `SELECT dept_id, dept_name, parent_dept_id, display_order, accent_color
         FROM departments WHERE is_active = 1
        ORDER BY display_order ASC, dept_name ASC`
    )
  );
  const peopleRows = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, e.user_id, e.name, e.dept_id, d.dept_name, p.position_name, p.rank_order,
              e.mobile_phone, e.company_phone, e.photo_public_path, e.hired_at, e.job_duties,
              mb.address AS company_email, u.email_local
         FROM employee_profiles e
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions p ON p.position_id = e.position_id
         LEFT JOIN users u ON u.user_id = e.user_id
         LEFT JOIN mailboxes mb ON mb.user_id = e.user_id AND mb.status = 'active'
        WHERE e.status = 'active'
        -- 직급 서열은 rank_order 가 클수록 상위(사원 30 … 대표이사 100) → 부서 내 상위 직급이 먼저.
        ORDER BY d.display_order ASC NULLS LAST, p.rank_order DESC NULLS LAST, e.name ASC`
    )
  );
  return {
    departments: deptRows.map((r) => ({
      deptId: String(r.dept_id),
      deptName: String(r.dept_name),
      parentDeptId: r.parent_dept_id != null ? String(r.parent_dept_id) : null,
      displayOrder: Number(r.display_order ?? 0),
      accentColor: r.accent_color != null ? String(r.accent_color) : null,
    })),
    people: peopleRows.map((r) => ({
      employeeId: String(r.employee_id),
      userId: r.user_id != null ? String(r.user_id) : null,
      name: String(r.name),
      deptId: r.dept_id != null ? String(r.dept_id) : null,
      deptName: r.dept_name != null ? String(r.dept_name) : null,
      positionName: r.position_name != null ? String(r.position_name) : null,
      positionRankOrder: r.rank_order != null ? Number(r.rank_order) : null,
      // mailbox 는 최초 웹메일 사용 시 lazy 생성 — 미생성이어도 email_local 로 회사주소를 표시한다
      // (이 주소로 수신되면 inbound 가 mailbox 를 자동 생성해 배달, resolveRecipients 참조).
      companyEmail:
        r.company_email != null
          ? String(r.company_email)
          : r.email_local != null && String(r.email_local).trim() !== ""
            ? `${String(r.email_local).trim().toLowerCase()}@${MAIL_DOMAIN}`
            : null,
      mobilePhone: r.mobile_phone != null ? String(r.mobile_phone) : null,
      companyPhone: r.company_phone != null ? String(r.company_phone) : null,
      photoPath: r.photo_public_path != null ? String(r.photo_public_path) : null,
      hiredAt: r.hired_at != null ? String(r.hired_at) : null,
      jobDuties: r.job_duties != null ? String(r.job_duties) : null,
    })),
  };
}

/** 사업장의 연락처 구분 설정(같은 사업장 담당자 전원에게 함께 적용된다). */
export async function setFacilityOrgCategory(facilityId: string, category: OrgCategory): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`UPDATE facilities SET org_category = $2, updated_at = $3 WHERE facility_id = $1`, [
      facilityId,
      category,
      new Date().toISOString(),
    ]);
  });
}

/**
 * 주소록에서의 담당자 개별 수정(사업장 상세 편집과 별개 경로).
 * 2026-10-30부터 전 직원(contact.edit)이 쓰므로 변경 전·후를 감사 로그에 남긴다(actorUserId 가 있을 때).
 */
export async function updateContactPerson(
  id: number,
  patch: {
    personName?: string;
    title?: string | null;
    officePhone?: string | null;
    mobilePhone?: string | null;
    email?: string | null;
    duties?: string | null;
    status?: string;
  },
  actorUserId?: string
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const put = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.personName != null) put("person_name", patch.personName.trim());
  if (patch.title !== undefined) put("title", patch.title);
  if (patch.officePhone !== undefined) put("office_phone", patch.officePhone);
  if (patch.mobilePhone !== undefined) put("mobile_phone", patch.mobilePhone);
  if (patch.email !== undefined) put("email", patch.email);
  if (patch.duties !== undefined) put("duties", patch.duties);
  if (patch.status != null) put("status", patch.status);
  if (!sets.length) return;
  params.push(new Date().toISOString());
  sets.push(`updated_at = $${params.length}`);
  await withDbWrite(async (db) => {
    const before = rowsToObjects(await db.exec(`SELECT * FROM facility_contact_people WHERE id = $1`, [id]))[0];
    if (!before) throw new Error("담당자를 찾을 수 없습니다.");
    await db.run(`UPDATE facility_contact_people SET ${sets.join(", ")} WHERE id = $1`, params);
    if (actorUserId) {
      await recordAuditLogInline(db, {
        actorUserId,
        action: "facility_contact_person_update",
        targetTable: "facility_contact_people",
        targetId: String(id),
        before,
        after: patch,
      });
    }
  });
}

export interface NewContactPerson {
  facilityId: string;
  personName: string;
  title?: string | null;
  /** 부서명 — 같은 사업장에 같은 이름의 부서가 있으면 그 부서로, 없으면 새로 만든다. */
  departmentName?: string | null;
  officePhone?: string | null;
  mobilePhone?: string | null;
  email?: string | null;
  duties?: string | null;
}

/**
 * 사업장 담당자 1명 추가 — 출장·영업에서 만난 사람을 직원이 직접 등록한다(2026-10-30 사용자 결정, contact.edit).
 * 사업장 상세의 일괄 저장(replace-all, facility.edit)과 달리 기존 담당자를 건드리지 않는다. 새 id 를 돌려준다.
 */
export async function createContactPerson(input: NewContactPerson, actorUserId: string): Promise<number> {
  const clean = (v: string | null | undefined) => {
    const t = String(v ?? "").trim();
    return t || null;
  };
  const personName = clean(input.personName);
  if (!personName) throw new Error("이름을 입력하세요.");
  const now = new Date().toISOString();
  return withDbWrite(async (db) => {
    const fac = rowsToObjects(
      await db.exec(`SELECT facility_id FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL`, [input.facilityId])
    );
    if (!fac.length) throw new Error("기관·업체를 찾을 수 없습니다.");
    let departmentId: number | null = null;
    const deptName = clean(input.departmentName);
    if (deptName) {
      const found = rowsToObjects(
        await db.exec(
          `SELECT id FROM facility_contact_departments WHERE facility_id = $1 AND department_name = $2 ORDER BY id LIMIT 1`,
          [input.facilityId, deptName]
        )
      );
      if (found.length) departmentId = Number(found[0].id);
      else {
        const ins = rowsToObjects(
          await db.exec(
            `INSERT INTO facility_contact_departments (facility_id, department_name, created_at, updated_at)
             VALUES ($1, $2, $3, $3) RETURNING id`,
            [input.facilityId, deptName, now]
          )
        );
        departmentId = Number(ins[0].id);
      }
    }
    const row = {
      facilityId: input.facilityId,
      departmentId,
      personName,
      title: clean(input.title),
      officePhone: clean(input.officePhone),
      mobilePhone: clean(input.mobilePhone),
      email: clean(input.email),
      duties: clean(input.duties),
    };
    const inserted = rowsToObjects(
      await db.exec(
        `INSERT INTO facility_contact_people
           (facility_id, department_id, person_name, title, office_phone, mobile_phone, email, duties, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $9) RETURNING id`,
        [row.facilityId, row.departmentId, row.personName, row.title, row.officePhone, row.mobilePhone, row.email, row.duties, now]
      )
    );
    const id = Number(inserted[0].id);
    await recordAuditLogInline(db, {
      actorUserId,
      action: "facility_contact_person_create",
      targetTable: "facility_contact_people",
      targetId: String(id),
      after: row,
    });
    return id;
  });
}

export async function deleteContactPerson(id: number): Promise<void> {
  await withDbWrite(async (db) => {
    await db.run(`DELETE FROM facility_contact_people WHERE id = $1`, [id]);
  });
}

export interface RecipientSuggestion {
  /** 표시 이름(임직원명·별칭·담당자명). */
  name: string;
  address: string;
  /** employee=임직원 / alias=별칭·배포리스트 / contact=외부(사업장 담당자) */
  kind: "employee" | "alias" | "contact";
  /** 부가 설명(부서·직급, 사업장명 등). */
  detail: string | null;
  /** 직함(직급) — 수신자 표기 "이름 직함 <주소>" 에 사용. */
  title: string | null;
}

/** 메일 수신자 자동완성 — 임직원(회사메일) + 별칭/배포리스트 + 외부 담당자(이메일 보유). */
export async function suggestRecipients(q: string, limit = 12): Promise<RecipientSuggestion[]> {
  const s = q.trim().toLowerCase();
  if (s.length < 1) return [];
  const like = `%${s}%`;
  const db = await getDb();

  // mailbox 미생성 직원도 email_local 로 회사주소를 제안한다(수신 시 inbound 가 자동 생성·배달).
  const employees = rowsToObjects(
    await db.exec(
      `SELECT e.name, d.dept_name, p.position_name,
              COALESCE(mb.address, LOWER(u.email_local) || '@' || $3) AS address
         FROM employee_profiles e
         JOIN users u ON u.user_id = e.user_id AND u.status = 'active'
         LEFT JOIN mailboxes mb ON mb.user_id = e.user_id AND mb.status = 'active'
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions p ON p.position_id = e.position_id
        WHERE e.status = 'active'
          AND (mb.address IS NOT NULL OR COALESCE(u.email_local, '') <> '')
          -- 이름·주소 외에 소속(부서)로도 찾는다("영업" 처럼 부서만 아는 경우).
          AND (LOWER(e.name) LIKE $1 OR LOWER(COALESCE(mb.address, u.email_local)) LIKE $1
               OR LOWER(COALESCE(d.dept_name, '')) LIKE $1)
        ORDER BY e.name ASC LIMIT $2`,
      [like, limit, MAIL_DOMAIN]
    )
  );
  const aliases = rowsToObjects(
    await db.exec(
      `SELECT alias_local, kind FROM mail_aliases WHERE active = 1 AND LOWER(alias_local) LIKE $1 ORDER BY alias_local ASC LIMIT $2`,
      [like, limit]
    )
  );
  const contacts = rowsToObjects(
    await db.exec(
      `SELECT cp.person_name, cp.email, cp.title, f.company_name
         FROM facility_contact_people cp
         LEFT JOIN facilities f ON f.facility_id = cp.facility_id
        WHERE cp.email IS NOT NULL AND cp.email <> '' AND COALESCE(cp.status, 'active') <> 'inactive'
          AND (LOWER(cp.person_name) LIKE $1 OR LOWER(cp.email) LIKE $1 OR LOWER(COALESCE(f.company_name, '')) LIKE $1)
        ORDER BY cp.person_name ASC LIMIT $2`,
      [like, limit]
    )
  );

  const out: RecipientSuggestion[] = [
    ...employees.map((r) => ({
      name: String(r.name),
      address: String(r.address),
      kind: "employee" as const,
      detail: [r.dept_name, r.position_name].filter(Boolean).join(" · ") || null,
      title: r.position_name != null ? String(r.position_name) : null,
    })),
    ...aliases.map((r) => ({
      name: String(r.alias_local),
      address: `${r.alias_local}@${MAIL_DOMAIN}`,
      kind: "alias" as const,
      detail: String(r.kind) === "list" ? "배포리스트" : "별칭",
      title: null,
    })),
    ...contacts.map((r) => ({
      name: String(r.person_name),
      address: String(r.email),
      kind: "contact" as const,
      detail: [r.company_name, r.title].filter(Boolean).join(" · ") || null,
      title: r.title != null ? String(r.title) : null,
    })),
  ];
  // 주소 중복 제거 후 상한.
  const seen = new Set<string>();
  return out.filter((x) => {
    const key = x.address.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
}
