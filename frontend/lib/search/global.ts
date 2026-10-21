/**
 * 상단 검색(Ctrl K)의 내용 검색 — F-13 잔여, 2026-10-21 사용자 결정 "핵심 6종".
 * 메일 · 결재 문서 · 주소록(임직원·외부 담당자) · 계약 · 사업장 · 할 일을 종류별 최대 5건씩 찾는다.
 * 원칙: 각 종류는 그 화면의 열람 규칙을 그대로 SQL 로 옮긴다 — 검색이 화면보다 넓게 보여 주면 안 된다.
 *  - 메일: 내 메일함만(휴지통·스팸 제외)
 *  - 결재: lib/approval/access.ts resolveDocAccess 와 같은 규칙 + 남의 임시저장 제외
 *  - 임직원: 전 직원(주소록과 같음) / 외부 담당자: contact.view
 *  - 계약: contract.view + 계약 범위(contract-scope) / 사업장: facility.view
 *  - 할 일: lib/todo/visibility.ts visibleItemsWhere(관리자 우회 없음)
 * 한 종류가 실패해도(표 없음 등) 나머지는 돌려준다.
 */
import { getDb, rowsToObjects } from "@/lib/db";
import { checkPermission, loadUserAccess } from "@/lib/auth/rbac";
import { contractScopeWhere, resolveContractScope } from "@/lib/auth/contract-scope";
import { listRestrictedOrgFolders } from "@/lib/approval/docs";
import { userHeadDeptIds } from "@/lib/org/posts";
import { visibleItemsWhere } from "@/lib/todo/visibility";
import type { SearchKind, SearchResultItem } from "./kinds";

const PER_KIND = 5;
const s = (v: unknown) => (v == null ? "" : String(v));

/** ILIKE 패턴 — 사용자가 친 % _ \ 는 글자 그대로 찾는다. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** "홍길동 <a@b.com>" → "홍길동" */
function senderName(fromAddr: string): string {
  const m = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(fromAddr);
  return (m ? m[1] : fromAddr).trim();
}

async function searchMail(userId: string, like: string): Promise<SearchResultItem[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT m.message_id, m.subject, m.from_addr, m.direction, m.created_at
         FROM mailboxes mb
         JOIN mail_folders f ON f.mailbox_id = mb.mailbox_id AND COALESCE(f.system_kind, '') NOT IN ('trash', 'spam')
         JOIN mail_message_state s ON s.folder_id = f.folder_id AND s.is_deleted = 0
         JOIN mail_messages m ON m.message_id = s.message_id
        WHERE mb.user_id = $1
          AND (m.subject ILIKE $2 OR m.from_addr ILIKE $2)
        ORDER BY m.created_at DESC
        LIMIT $3`,
      [userId, like, PER_KIND]
    )
  );
  return rows.map((r) => ({
    kind: "mail",
    id: s(r.message_id),
    title: s(r.subject) || "(제목 없음)",
    detail: [s(r.direction) === "out" ? "보낸 메일" : senderName(s(r.from_addr)), s(r.created_at).slice(0, 10)].filter(Boolean).join(" · "),
    href: `/mail?id=${encodeURIComponent(s(r.message_id))}`,
  }));
}

async function searchApproval(userId: string, like: string, isReader: boolean): Promise<SearchResultItem[]> {
  const [restricted, headDepts] = await Promise.all([listRestrictedOrgFolders(), userHeadDeptIds(userId)]);
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.doc_no, d.title, d.drafter_name, d.status, d.created_at
         FROM approval_docs d
         LEFT JOIN approval_forms f ON f.form_id = d.form_id
        WHERE (d.title ILIKE $2 OR COALESCE(d.doc_no, '') ILIKE $2)
          AND (d.status <> 'draft' OR d.drafter_user_id = $1)
          AND (
            $3::boolean
            OR d.drafter_user_id = $1
            OR EXISTS (SELECT 1 FROM approval_steps st WHERE st.doc_id = d.doc_id AND (st.assignee_user_id = $1 OR st.delegated_from = $1))
            OR EXISTS (SELECT 1 FROM approval_watchers w WHERE w.doc_id = d.doc_id AND w.user_id = $1)
            OR (d.status = 'approved' AND COALESCE(f.org_folder, '') <> '' AND NOT (f.org_folder = ANY($4::text[])))
            OR (d.status IN ('approved', 'rejected') AND d.dept_id = ANY($5::text[]))
          )
        ORDER BY d.created_at DESC
        LIMIT $6`,
      [userId, like, isReader, [...restricted], headDepts, PER_KIND]
    )
  );
  const STATUS: Record<string, string> = { draft: "임시저장", in_progress: "진행 중", approved: "완료", rejected: "반려", canceled: "취소" };
  return rows.map((r) => ({
    kind: "approval",
    id: s(r.doc_id),
    title: s(r.title) || "(제목 없음)",
    detail: [s(r.doc_no), s(r.drafter_name), STATUS[s(r.status)] ?? ""].filter(Boolean).join(" · "),
    href: `/approval?docId=${encodeURIComponent(s(r.doc_id))}`,
  }));
}

async function searchPeople(like: string, canContacts: boolean): Promise<SearchResultItem[]> {
  const db = await getDb();
  const employees = rowsToObjects(
    await db.exec(
      `SELECT e.employee_id, e.name, d.dept_name, p.position_name
         FROM employee_profiles e
         JOIN users u ON u.user_id = e.user_id AND u.status = 'active'
         LEFT JOIN departments d ON d.dept_id = e.dept_id
         LEFT JOIN positions p ON p.position_id = e.position_id
        WHERE e.status = 'active'
          AND (e.name ILIKE $1 OR COALESCE(d.dept_name, '') ILIKE $1)
        ORDER BY e.name ASC
        LIMIT $2`,
      [like, PER_KIND]
    )
  );
  const out: SearchResultItem[] = employees.map((r) => ({
    kind: "people",
    id: `emp:${s(r.employee_id)}`,
    title: s(r.name),
    detail: ["임직원", s(r.dept_name), s(r.position_name)].filter(Boolean).join(" · "),
    href: "/directory",
  }));
  if (canContacts && out.length < PER_KIND) {
    const contacts = rowsToObjects(
      await db.exec(
        `SELECT cp.id AS contact_person_id, cp.person_name, cp.title, f.facility_id, f.company_name
           FROM facility_contact_people cp
           LEFT JOIN facilities f ON f.facility_id = cp.facility_id
          WHERE COALESCE(cp.status, 'active') <> 'inactive'
            AND (cp.person_name ILIKE $1 OR COALESCE(f.company_name, '') ILIKE $1)
          ORDER BY cp.person_name ASC
          LIMIT $2`,
        [like, PER_KIND - out.length]
      )
    );
    for (const r of contacts)
      out.push({
        kind: "people",
        id: `cp:${s(r.contact_person_id)}`,
        title: s(r.person_name),
        detail: ["외부 담당자", s(r.company_name), s(r.title)].filter(Boolean).join(" · "),
        href: r.facility_id ? `/facilities?focus=${encodeURIComponent(s(r.facility_id))}` : "/directory",
      });
  }
  return out;
}

async function searchContracts(userId: string, like: string): Promise<SearchResultItem[]> {
  const scope = await resolveContractScope(userId, "contract.view");
  if (scope.kind === "none") return [];
  const params: unknown[] = [like];
  const addParam = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const scopeSql = contractScopeWhere(scope, "c", addParam);
  const limitP = addParam(PER_KIND);
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT c.contract_id, c.contract_title, cp.company_name,
              SUBSTRING(COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at), 1, 4) AS year
         FROM contracts c
         LEFT JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
        WHERE c.deleted_at IS NULL
          AND (c.contract_title ILIKE $1 OR COALESCE(cp.company_name, '') ILIKE $1)
          ${scopeSql ? `AND ${scopeSql}` : ""}
        ORDER BY COALESCE(NULLIF(c.contract_date, ''), c.started_at, c.created_at) DESC
        LIMIT ${limitP}`,
      params
    )
  );
  return rows.map((r) => {
    const year = /^\d{4}$/.test(s(r.year)) ? s(r.year) : "";
    return {
      kind: "contract",
      id: s(r.contract_id),
      title: s(r.contract_title) || "(계약명 없음)",
      detail: [s(r.company_name), year ? `${year}년` : ""].filter(Boolean).join(" · "),
      href: `/contracts?contract=${encodeURIComponent(s(r.contract_id))}${year ? `&year=${year}` : ""}`,
    };
  });
}

async function searchFacilities(like: string): Promise<SearchResultItem[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT f.facility_id, f.company_name, f.site_address
         FROM facilities f
        WHERE f.deleted_at IS NULL
          AND (f.company_name ILIKE $1 OR COALESCE(f.site_address, '') ILIKE $1
               OR EXISTS (SELECT 1 FROM facility_aliases fa WHERE fa.facility_id = f.facility_id AND fa.alias ILIKE $1))
        ORDER BY f.company_name ASC
        LIMIT $2`,
      [like, PER_KIND]
    )
  );
  return rows.map((r) => ({
    kind: "facility",
    id: s(r.facility_id),
    title: s(r.company_name),
    detail: s(r.site_address) || null,
    href: `/facilities?focus=${encodeURIComponent(s(r.facility_id))}`,
  }));
}

async function searchTodos(userId: string, like: string): Promise<SearchResultItem[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT t.item_id, t.title, t.status, t.due_date, b.name AS board_name
         FROM todo_items t
         LEFT JOIN todo_boards b ON b.board_id = t.board_id
        WHERE ${visibleItemsWhere("$1", "t")}
          AND t.archived_at IS NULL
          AND t.title ILIKE $2
        ORDER BY (t.status = 'done') ASC, t.updated_at DESC
        LIMIT $3`,
      [userId, like, PER_KIND]
    )
  );
  return rows.map((r) => ({
    kind: "todo",
    id: s(r.item_id),
    title: s(r.title),
    detail: [s(r.board_name), s(r.status) === "done" ? "완료" : s(r.due_date) ? `마감 ${s(r.due_date).slice(0, 10)}` : ""]
      .filter(Boolean)
      .join(" · ") || null,
    href: `/todo?item=${encodeURIComponent(s(r.item_id))}`,
  }));
}

export async function searchContent(userId: string, rawQuery: string): Promise<SearchResultItem[]> {
  const q = rawQuery.trim().slice(0, 60);
  if (q.length < 2) return [];
  const like = likePattern(q);
  const access = await loadUserAccess(userId);
  const can = (key: string) => checkPermission(access, key);
  const isReader = can("approval.manage") || can("approval.read_all");

  const jobs: [SearchKind, () => Promise<SearchResultItem[]>][] = [
    ["mail", () => searchMail(userId, like)],
    ["approval", () => (can("approval.view") ? searchApproval(userId, like, isReader) : Promise.resolve([]))],
    ["people", () => searchPeople(like, can("contact.view"))],
    ["contract", () => (can("contract.view") ? searchContracts(userId, like) : Promise.resolve([]))],
    ["facility", () => (can("facility.view") ? searchFacilities(like) : Promise.resolve([]))],
    ["todo", () => searchTodos(userId, like)],
  ];
  const settled = await Promise.allSettled(jobs.map(([, run]) => run()));
  const out: SearchResultItem[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") out.push(...r.value);
    else console.warn(`[search] ${jobs[i][0]} 검색 실패: ${(r.reason as Error)?.message ?? r.reason}`);
  });
  return out;
}
