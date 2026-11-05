/**
 * 비상 연락망 — 표 행 구성·정렬·소속 묶음 순수 함수(DB 없음, 화면·내보내기 공용).
 * 원천: 직원 마스터 + 표시 설정(emergency_contact_entries, 340). 설계는 lib/emergency-contacts.ts 머리말 참고.
 */

export interface EmergencyEmployeeFact {
  employeeId: string;
  name: string;
  deptName: string | null;
  deptOrder: number | null;
  positionName: string | null;
  rankOrder: number | null;
  mobilePhone: string | null;
  companyPhone: string | null;
  /** 인사카드 이메일. 비어 있으면 회사 메일을 쓴다. */
  email: string | null;
  companyEmail: string | null;
  postTitle: string | null;
  postKind: string | null;
}

export interface EmergencyEntryFact {
  entryId: string;
  employeeId: string | null;
  /** 겸직 줄 — 이 직원을 다른 소속에도 올린다. */
  sameAsEmployeeId: string | null;
  groupLabel: string | null;
  title: string | null;
  displayOrder: number | null;
  hidden: boolean;
  name: string | null;
  positionName: string | null;
  mobilePhone: string | null;
  directPhone: string | null;
  email: string | null;
}

export interface EmergencyContactRow {
  /** 직원 `emp:<employeeId>` / 직접 입력·겸직 줄 `entry:<entryId>` */
  key: string;
  employeeId: string | null;
  /** 겸직 줄이면 원본 직원. 이름·번호는 그 직원의 인사카드를 따른다. */
  sameAsEmployeeId: string | null;
  entryId: string | null;
  groupLabel: string;
  /** 소속을 비웠을 때 쓰는 기본값 — 수정 창 안내용 */
  defaultGroupLabel: string;
  name: string;
  title: string;
  /** 직책을 비웠을 때 쓰는 기본값 — 수정 창 안내용 */
  defaultTitle: string;
  positionName: string;
  mobilePhone: string;
  directPhone: string;
  email: string;
  displayOrder: number | null;
  hidden: boolean;
}

export interface EmergencyContactGroup {
  label: string;
  rows: EmergencyContactRow[];
}

/** 재직 직원 조회 — 앱과 일회성 이관 스크립트(scripts/emergency-contacts-import.mjs)가 같은 기준을 쓴다. */
export const EMERGENCY_EMPLOYEE_SQL = `SELECT e.employee_id, e.name, e.email, e.mobile_phone, e.company_phone,
              d.dept_name, d.display_order AS dept_order, p.position_name, p.rank_order,
              (SELECT mb.address FROM mailboxes mb WHERE mb.user_id = e.user_id AND mb.status = 'active' LIMIT 1) AS company_email,
              u.email_local, post.title AS post_title, post.post_kind
         FROM employee_profiles e
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions p ON p.position_id = e.position_id
         LEFT JOIN users u ON u.user_id = e.user_id
         LEFT JOIN LATERAL (
           SELECT t.title, t.post_kind FROM employee_dept_posts t
            WHERE t.employee_id = e.employee_id AND t.dept_id = e.dept_id AND t.revoked_at IS NULL
              AND (t.effective_to IS NULL OR t.effective_to >= to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD'))
            ORDER BY t.is_primary DESC LIMIT 1
         ) post ON TRUE
        WHERE e.status = 'active'`;

const str = (v: unknown) => (v != null ? String(v) : null);

export function emergencyEmployeeFromRow(r: Record<string, unknown>, mailDomain: string): EmergencyEmployeeFact {
  return {
    employeeId: String(r.employee_id),
    name: String(r.name),
    deptName: str(r.dept_name),
    deptOrder: r.dept_order != null ? Number(r.dept_order) : null,
    positionName: str(r.position_name),
    rankOrder: r.rank_order != null ? Number(r.rank_order) : null,
    mobilePhone: str(r.mobile_phone),
    companyPhone: str(r.company_phone),
    email: str(r.email),
    companyEmail:
      r.company_email != null
        ? String(r.company_email)
        : r.email_local != null && String(r.email_local).trim() !== ""
          ? `${String(r.email_local).trim().toLowerCase()}@${mailDomain}`
          : null,
    postTitle: str(r.post_title),
    postKind: str(r.post_kind),
  };
}

const CEO_POSITION = "대표이사";
const EXECUTIVE_RANK = 80;
const OTHER_GROUP = "기타";
const text = (v: string | null | undefined) => String(v ?? "").trim();

function defaultTitleOf(e: EmergencyEmployeeFact): string {
  if (text(e.postTitle)) return text(e.postTitle);
  // 이사 이상·연구소장·지사장은 직급이 곧 직책이다(positions.rank_order 80 이상).
  if ((e.rankOrder ?? 0) >= EXECUTIVE_RANK) return text(e.positionName);
  if (e.postKind === "head") return "부서장";
  return e.deptName ? "팀원" : "";
}

function defaultGroupOf(e: EmergencyEmployeeFact): string {
  if (e.positionName === CEO_POSITION) return CEO_POSITION;
  return text(e.deptName) || OTHER_GROUP;
}

/** 직원·직접 입력 행을 합쳐 표 순서로 돌려준다. 숨긴 행도 포함한다(호출부가 거른다). */
export function buildEmergencyRows(employees: EmergencyEmployeeFact[], entries: EmergencyEntryFact[]): EmergencyContactRow[] {
  const entryByEmployee = new Map(entries.filter((en) => en.employeeId).map((en) => [en.employeeId as string, en]));
  const employeeById = new Map(employees.map((e) => [e.employeeId, e]));
  const defaultSorted = [...employees].sort(
    (a, b) =>
      Number(b.positionName === CEO_POSITION) - Number(a.positionName === CEO_POSITION) ||
      (a.deptOrder ?? Number.MAX_SAFE_INTEGER) - (b.deptOrder ?? Number.MAX_SAFE_INTEGER) ||
      (b.rankOrder ?? -1) - (a.rankOrder ?? -1) ||
      a.name.localeCompare(b.name, "ko")
  );
  const rows: EmergencyContactRow[] = defaultSorted.map((e) => {
    const en = entryByEmployee.get(e.employeeId);
    const defaultGroupLabel = defaultGroupOf(e);
    const defaultTitle = defaultTitleOf(e);
    return {
      key: `emp:${e.employeeId}`,
      employeeId: e.employeeId,
      sameAsEmployeeId: null,
      entryId: en?.entryId ?? null,
      groupLabel: text(en?.groupLabel) || defaultGroupLabel,
      defaultGroupLabel,
      name: e.name,
      title: text(en?.title) || defaultTitle,
      defaultTitle,
      positionName: text(e.positionName),
      mobilePhone: text(e.mobilePhone),
      directPhone: text(e.companyPhone),
      email: text(e.email) || text(e.companyEmail),
      displayOrder: en?.displayOrder ?? null,
      hidden: en?.hidden ?? false,
    };
  });
  for (const en of entries) {
    if (en.employeeId) continue;
    if (en.sameAsEmployeeId) {
      const e = employeeById.get(en.sameAsEmployeeId);
      if (!e) continue; // 퇴사하면 겸직 줄도 함께 빠진다.
      const defaultTitle = defaultTitleOf(e);
      rows.push({
        key: `entry:${en.entryId}`,
        employeeId: null,
        sameAsEmployeeId: e.employeeId,
        entryId: en.entryId,
        groupLabel: text(en.groupLabel) || defaultGroupOf(e),
        defaultGroupLabel: defaultGroupOf(e),
        name: e.name,
        title: text(en.title) || defaultTitle,
        defaultTitle,
        positionName: text(e.positionName),
        mobilePhone: text(e.mobilePhone),
        directPhone: text(e.companyPhone),
        email: text(e.email) || text(e.companyEmail),
        displayOrder: en.displayOrder,
        hidden: en.hidden,
      });
      continue;
    }
    rows.push({
      key: `entry:${en.entryId}`,
      employeeId: null,
      sameAsEmployeeId: null,
      entryId: en.entryId,
      groupLabel: text(en.groupLabel) || OTHER_GROUP,
      defaultGroupLabel: OTHER_GROUP,
      name: text(en.name),
      title: text(en.title),
      defaultTitle: "",
      positionName: text(en.positionName),
      mobilePhone: text(en.mobilePhone),
      directPhone: text(en.directPhone),
      email: text(en.email),
      displayOrder: en.displayOrder,
      hidden: en.hidden,
    });
  }
  return orderEmergencyRows(rows);
}

/** 순서를 정한 행을 먼저 세우고, 정하지 않은 행(새 입사자 등)은 같은 소속의 끝에, 소속이 없으면 표의 끝에 넣는다. */
export function orderEmergencyRows(rows: EmergencyContactRow[]): EmergencyContactRow[] {
  const placed = rows
    .filter((r) => r.displayOrder != null)
    .sort((a, b) => (a.displayOrder as number) - (b.displayOrder as number));
  for (const r of rows) {
    if (r.displayOrder != null) continue;
    let at = -1;
    for (let i = placed.length - 1; i >= 0; i--) {
      if (placed[i].groupLabel === r.groupLabel) {
        at = i;
        break;
      }
    }
    if (at < 0) placed.push(r);
    else placed.splice(at + 1, 0, r);
  }
  return placed;
}

/** 총 인원 — 사람 수를 센다(겸직으로 두 줄인 사람은 1명). */
export function emergencyHeadcount(rows: EmergencyContactRow[]): number {
  return new Set(rows.map((r) => r.sameAsEmployeeId ?? r.employeeId ?? r.key)).size;
}

/** 이어진 같은 소속끼리 묶는다(표·내보내기의 소속 칸 병합 단위). */
export function groupEmergencyRows(rows: EmergencyContactRow[]): EmergencyContactGroup[] {
  const groups: EmergencyContactGroup[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.label === r.groupLabel) last.rows.push(r);
    else groups.push({ label: r.groupLabel, rows: [r] });
  }
  return groups;
}

/** 행을 소속 안에서 한 칸 옮긴 새 순서(끝에 닿으면 null). */
export function moveEmergencyRow(rows: EmergencyContactRow[], key: string, delta: -1 | 1): EmergencyContactRow[] | null {
  const groups = groupEmergencyRows(rows);
  for (const g of groups) {
    const i = g.rows.findIndex((r) => r.key === key);
    if (i < 0) continue;
    const j = i + delta;
    if (j < 0 || j >= g.rows.length) return null;
    [g.rows[i], g.rows[j]] = [g.rows[j], g.rows[i]];
    return groups.flatMap((x) => x.rows);
  }
  return null;
}

/** 소속 묶음을 통째로 한 칸 옮긴 새 순서(끝에 닿으면 null). index 는 groupEmergencyRows 기준. */
export function moveEmergencyGroup(rows: EmergencyContactRow[], index: number, delta: -1 | 1): EmergencyContactRow[] | null {
  const groups = groupEmergencyRows(rows);
  const j = index + delta;
  if (index < 0 || index >= groups.length || j < 0 || j >= groups.length) return null;
  [groups[index], groups[j]] = [groups[j], groups[index]];
  return groups.flatMap((g) => g.rows);
}
