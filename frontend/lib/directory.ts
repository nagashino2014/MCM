/**
 * 주소록·조직도(G6-A) — 사내 임직원 디렉터리 조회 + 메일 수신자 자동완성 소스.
 * 재직(active) 인원의 이름·부서·직급·회사메일(mailbox)·휴대폰·사내전화·사진만 노출한다
 * (주민번호·생일·주소·메모 등 인사 민감정보는 포함하지 않는다 — 전 직원 열람 화면).
 * 설계: docs/groupware-ux-overhaul-blueprint.md §7 (메일 자동완성·결재선과 공유).
 */
import { getDb, rowsToObjects } from "@/lib/db";
import { MAIL_DOMAIN } from "@/lib/mail/mailbox";

export interface DirectoryDepartment {
  deptId: string;
  deptName: string;
  parentDeptId: string | null;
  displayOrder: number;
  accentColor: string | null;
}

export interface DirectoryPerson {
  employeeId: string;
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
      `SELECT e.employee_id, e.name, e.dept_id, d.dept_name, p.position_name, p.rank_order,
              e.mobile_phone, e.company_phone, e.photo_public_path, e.hired_at, e.job_duties,
              mb.address AS company_email, u.email_local
         FROM employee_profiles e
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions p ON p.position_id = e.position_id
         LEFT JOIN users u ON u.user_id = e.user_id
         LEFT JOIN mailboxes mb ON mb.user_id = e.user_id AND mb.status = 'active'
        WHERE e.status = 'active'
        ORDER BY d.display_order ASC NULLS LAST, p.rank_order ASC NULLS LAST, e.name ASC`
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

export interface RecipientSuggestion {
  /** 표시 이름(임직원명·별칭·담당자명). */
  name: string;
  address: string;
  /** employee=임직원 / alias=별칭·배포리스트 / contact=외부(사업장 담당자) */
  kind: "employee" | "alias" | "contact";
  /** 부가 설명(부서·직급, 사업장명 등). */
  detail: string | null;
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
          AND (LOWER(e.name) LIKE $1 OR LOWER(COALESCE(mb.address, u.email_local)) LIKE $1)
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
    })),
    ...aliases.map((r) => ({
      name: String(r.alias_local),
      address: `${r.alias_local}@${MAIL_DOMAIN}`,
      kind: "alias" as const,
      detail: String(r.kind) === "list" ? "배포리스트" : "별칭",
    })),
    ...contacts.map((r) => ({
      name: String(r.person_name),
      address: String(r.email),
      kind: "contact" as const,
      detail: [r.company_name, r.title].filter(Boolean).join(" · ") || null,
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
