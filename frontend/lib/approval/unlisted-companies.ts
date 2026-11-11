/**
 * 미계약 업체 정리(2026-11-11 사용자 요청) — 결재 문서에 '미계약 업체(직접 입력)'로 적힌 업체와
 * 그 문서의 접견인(자유 입력)을 모아 보여 주고, 관리자가 마스터(사업장 / 기타 업체·기관)에 등록·연결한다.
 *
 *  - 수집: 상신된 문서(임시저장 제외)의 업체 검색 항목 중 manual 값. 같은 업체는 회사 키(법인격·공백 제거)로 묶는다.
 *  - 제안: 기존 업체와 이름이 비슷하면 연결 후보로 낸다(연락처 가져오기의 matchFacilities). 확정은 사람이 한다.
 *  - 등록: 새 업체는 기본 '기타 업체·기관'(계약이 생기면 승격). 접견인은 그 업체의 담당자로 넣는다.
 *  - 문서 연결: 별도 연결 표 없이 문서 값 안에 업체·담당자 id 를 채운다(원래 적은 이름은 originalName 으로 보존).
 *  - 명함 등록 요청: 관리자가 기안자에게 접견인 상세(명함 또는 직접 입력)를 요청한다(approval_contact_requests, 351).
 *
 * ⚠ 클라이언트에서 import 금지(pg).
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { parseFields, type ApprovalFieldDef } from "@/lib/approval/fields";
import { addFacilityContact, loadFacilityRefs, registerImportedFacility } from "@/lib/contact-import/store";
import { buildFacilityIndex, companyKey, matchFacilities, suggestCategory, type MatchKind } from "@scraper/lib/contact-import/rules";
import { createItem } from "@/lib/todo/store";

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const text = (v: unknown): string => String(v ?? "").trim();
const textOrNull = (v: unknown): string | null => text(v) || null;

/** 장소 성격의 업체 항목(출장지·방문지) — 거래 상대가 아니므로 정리 대상에서 뺀다(렌더러 isPlaceField 와 같은 규칙). */
function isPlaceField(f: ApprovalFieldDef): boolean {
  return f.key === "destination" || /출장지|방문지|장소/.test(f.label ?? "");
}

export interface UnlistedReceiver {
  name: string;
  title: string | null;
}

export interface UnlistedDoc {
  docId: string;
  docNo: string | null;
  formId: string;
  formName: string;
  status: string;
  drafterUserId: string | null;
  drafterName: string | null;
  submittedAt: string | null;
  /** 문서에 적힌 업체명 그대로 */
  companyText: string;
  receivers: UnlistedReceiver[];
  request: ContactRequestSummary | null;
}

export interface UnlistedCandidate {
  facilityId: string;
  companyName: string;
  address: string | null;
  kind: MatchKind;
  /** 기타 업체·기관이면 true */
  other: boolean;
}

export interface UnlistedCompany {
  key: string;
  name: string;
  docs: UnlistedDoc[];
  /** 문서와 요청 회신을 합친 접견인(이름 기준) */
  people: ContactPersonInput[];
  candidates: UnlistedCandidate[];
  suggestedCategory: string;
}

export interface ContactPersonInput {
  name: string;
  title?: string | null;
  department?: string | null;
  mobilePhone?: string | null;
  officePhone?: string | null;
  email?: string | null;
}

export interface ContactRequestResponse {
  company?: { address?: string | null; phone?: string | null; homepage?: string | null; brn?: string | null };
  people: ContactPersonInput[];
}

export interface ContactRequestSummary {
  requestId: string;
  docId: string;
  companyName: string;
  status: "pending" | "done" | "canceled" | "closed";
  note: string | null;
  requestedTo: string;
  requestedToName: string | null;
  requestedByName: string | null;
  createdAt: string;
  respondedAt: string | null;
  response: ContactRequestResponse | null;
}

interface DocSlot {
  docId: string;
  companyFieldKey: string;
  contactFieldKeys: string[];
}

interface Group {
  company: UnlistedCompany;
  slots: DocSlot[];
}

function parseJson<T>(v: unknown, fallback: T): T {
  try {
    const o = typeof v === "string" ? JSON.parse(v) : v;
    return o && typeof o === "object" ? (o as T) : fallback;
  } catch {
    return fallback;
  }
}

function normalizePeople(list: unknown): ContactPersonInput[] {
  if (!Array.isArray(list)) return [];
  const out: ContactPersonInput[] = [];
  for (const raw of list) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const name = text(o.name).slice(0, 60);
    if (!name) continue;
    out.push({
      name,
      title: textOrNull(o.title)?.slice(0, 80) ?? null,
      department: textOrNull(o.department)?.slice(0, 80) ?? null,
      mobilePhone: textOrNull(o.mobilePhone)?.slice(0, 40) ?? null,
      officePhone: textOrNull(o.officePhone)?.slice(0, 40) ?? null,
      email: textOrNull(o.email)?.slice(0, 120) ?? null,
    });
  }
  return out;
}

function normalizeResponse(v: unknown): ContactRequestResponse | null {
  const o = parseJson<Record<string, unknown> | null>(v, null);
  if (!o) return null;
  const c = (o.company ?? {}) as Record<string, unknown>;
  return {
    company: {
      address: textOrNull(c.address),
      phone: textOrNull(c.phone),
      homepage: textOrNull(c.homepage),
      brn: textOrNull(c.brn),
    },
    people: normalizePeople(o.people),
  };
}

function toRequest(r: Record<string, unknown>): ContactRequestSummary {
  return {
    requestId: String(r.request_id),
    docId: String(r.doc_id),
    companyName: String(r.company_name ?? ""),
    status: String(r.status) as ContactRequestSummary["status"],
    note: textOrNull(r.note),
    requestedTo: String(r.requested_to ?? ""),
    requestedToName: textOrNull(r.requested_to_name),
    requestedByName: textOrNull(r.requested_by_name),
    createdAt: String(r.created_at ?? ""),
    respondedAt: textOrNull(r.responded_at),
    response: normalizeResponse(r.response),
  };
}

const REQUEST_SELECT = `
  SELECT r.*, tu.name AS requested_to_name, bu.name AS requested_by_name
    FROM approval_contact_requests r
    LEFT JOIN users tu ON tu.user_id = r.requested_to
    LEFT JOIN users bu ON bu.user_id = r.requested_by`;

/** 351 미적용 환경에서도 목록은 열리게 한다 — 요청 표가 없으면 null. */
async function requestTableReady(db: PgDatabase): Promise<boolean> {
  // 트랜잭션 안에서도 쓰므로 오류를 내지 않는 방식으로 확인한다(없는 표를 조회하면 트랜잭션이 깨진다).
  const r = rowsToObjects(await db.exec(`SELECT to_regclass('approval_contact_requests') IS NOT NULL AS ok`))[0];
  return r?.ok === true || r?.ok === "t";
}

async function loadRequests(db: PgDatabase, where: string, params: unknown[]): Promise<ContactRequestSummary[] | null> {
  if (!(await requestTableReady(db))) return null;
  return rowsToObjects(await db.exec(`${REQUEST_SELECT} ${where} ORDER BY r.created_at DESC`, params)).map(toRequest);
}

/** 이름 기준으로 사람을 합친다 — 뒤에 오는 값은 빈 칸만 채운다. */
function mergePeople(lists: ContactPersonInput[][]): ContactPersonInput[] {
  const byName = new Map<string, ContactPersonInput>();
  for (const list of lists) {
    for (const p of list) {
      const cur = byName.get(p.name);
      if (!cur) {
        byName.set(p.name, { ...p });
        continue;
      }
      cur.title = cur.title || p.title || null;
      cur.department = cur.department || p.department || null;
      cur.mobilePhone = cur.mobilePhone || p.mobilePhone || null;
      cur.officePhone = cur.officePhone || p.officePhone || null;
      cur.email = cur.email || p.email || null;
    }
  }
  return [...byName.values()];
}

async function collectGroups(db: PgDatabase): Promise<{ groups: Group[]; requestsReady: boolean }> {
  const forms = rowsToObjects(await db.exec(`SELECT form_id, name, fields FROM approval_forms`));
  const formInfo = new Map<string, { name: string; companyKeys: string[]; contactKeys: string[] }>();
  for (const f of forms) {
    const fields = parseFields(f.fields);
    const companyKeys = fields.filter((x) => x.type === "company_select" && !isPlaceField(x)).map((x) => x.key);
    if (!companyKeys.length) continue;
    formInfo.set(String(f.form_id), {
      name: String(f.name ?? ""),
      companyKeys,
      contactKeys: fields.filter((x) => x.type === "contact_select").map((x) => x.key),
    });
  }
  if (!formInfo.size) return { groups: [], requestsReady: true };

  const docs = rowsToObjects(
    await db.exec(
      `SELECT doc_id, doc_no, form_id, status, drafter_user_id, drafter_name, submitted_at, field_values
         FROM approval_docs
        WHERE status <> 'draft' AND form_id = ANY($1::text[]) AND field_values::text LIKE '%"manual"%'
        ORDER BY submitted_at DESC NULLS LAST`,
      [[...formInfo.keys()]]
    )
  );
  const requests = await loadRequests(db, `WHERE r.status IN ('pending','done')`, []);
  const requestByDoc = new Map<string, ContactRequestSummary>();
  for (const r of requests ?? []) if (!requestByDoc.has(r.docId)) requestByDoc.set(r.docId, r);

  const groups = new Map<string, Group>();
  for (const d of docs) {
    const info = formInfo.get(String(d.form_id));
    if (!info) continue;
    const fv = parseJson<Record<string, unknown>>(d.field_values, {});
    for (const companyFieldKey of info.companyKeys) {
      const cv = fv[companyFieldKey];
      if (!cv || typeof cv !== "object" || Array.isArray(cv)) continue;
      const o = cv as Record<string, unknown>;
      const companyText = text(o.name);
      if (o.manual !== true || o.facilityId || !companyText) continue;
      const receivers: UnlistedReceiver[] = [];
      for (const k of info.contactKeys) {
        const arr = fv[k];
        if (!Array.isArray(arr)) continue;
        for (const p of arr) {
          const po = (p ?? {}) as Record<string, unknown>;
          if (po.id != null || !text(po.name)) continue;
          receivers.push({ name: text(po.name), title: textOrNull(po.title) });
        }
      }
      const key = companyKey(companyText) || companyText;
      let g = groups.get(key);
      if (!g) {
        g = {
          company: { key, name: companyText, docs: [], people: [], candidates: [], suggestedCategory: suggestCategory(companyText) },
          slots: [],
        };
        groups.set(key, g);
      }
      const docId = String(d.doc_id);
      g.company.docs.push({
        docId,
        docNo: textOrNull(d.doc_no),
        formId: String(d.form_id),
        formName: info.name,
        status: String(d.status ?? ""),
        drafterUserId: textOrNull(d.drafter_user_id),
        drafterName: textOrNull(d.drafter_name),
        submittedAt: textOrNull(d.submitted_at),
        companyText,
        receivers,
        request: requestByDoc.get(docId) ?? null,
      });
      g.slots.push({ docId, companyFieldKey, contactFieldKeys: info.contactKeys });
    }
  }
  for (const g of groups.values()) {
    g.company.people = mergePeople([
      // 회신(명함)이 더 자세하므로 먼저 둔다
      ...g.company.docs.map((x) => (x.request?.status === "done" ? x.request.response?.people ?? [] : [])),
      ...g.company.docs.map((x) => x.receivers.map((r) => ({ name: r.name, title: r.title }))),
    ]);
  }
  return { groups: [...groups.values()], requestsReady: requests != null };
}

export async function listUnlistedCompanies(): Promise<{ companies: UnlistedCompany[]; requestsReady: boolean }> {
  const db = await getDb();
  const { groups, requestsReady } = await collectGroups(db);
  if (!groups.length) return { companies: [], requestsReady };
  const index = buildFacilityIndex(await loadFacilityRefs(db));
  const otherIds = new Set(
    rowsToObjects(await db.exec(`SELECT facility_id FROM facilities WHERE listing = 'other' AND deleted_at IS NULL`)).map((r) => String(r.facility_id))
  );
  for (const g of groups) {
    g.company.candidates = matchFacilities(g.company.name, null, index)
      .slice(0, 8)
      .map((c) => ({ facilityId: c.facilityId, companyName: c.companyName, address: c.address, kind: c.kind, other: otherIds.has(c.facilityId) }));
  }
  return {
    companies: groups.map((g) => g.company).sort((a, b) => b.docs.length - a.docs.length || a.name.localeCompare(b.name, "ko")),
    requestsReady,
  };
}

export interface ResolveInput {
  key: string;
  action: "link" | "create";
  /** link — 연결할 기존 업체 */
  facilityId?: string | null;
  /** create — 등록 위치(기본 기타 업체·기관) */
  listing?: "other" | "master";
  /** 접견인을 그 업체의 담당자로 등록하고 문서에 연결한다 */
  addContacts: boolean;
  userId: string;
}

export interface ResolveResult {
  facilityId: string;
  companyName: string;
  created: boolean;
  docs: number;
  contacts: number;
}

/** 한 업체(묶음)를 마스터에 연결한다 — 관리자 확정 한 번에 그 업체의 문서를 모두 처리한다. */
export async function resolveUnlistedCompany(input: ResolveInput): Promise<ResolveResult> {
  return withDbWrite(async (db) => {
    const { groups } = await collectGroups(db);
    const g = groups.find((x) => x.company.key === input.key);
    if (!g) throw fail("정리할 문서가 없습니다. 이미 처리됐을 수 있습니다 — 목록을 새로 고치세요.", 404);
    const now = new Date().toISOString();

    let facilityId: string;
    let created = false;
    if (input.action === "link") {
      facilityId = text(input.facilityId);
      if (!facilityId) throw fail("연결할 업체를 고르세요.");
    } else {
      const answer = g.company.docs.map((d) => (d.request?.status === "done" ? d.request.response?.company : null)).find(Boolean);
      const reg = await registerImportedFacility(db, {
        companyName: g.company.name,
        brn: answer?.brn ?? null,
        address: answer?.address ?? null,
        phone: answer?.phone ?? null,
        homepage: answer?.homepage ?? null,
        orgCategory: g.company.suggestedCategory,
        tradeRoles: [],
        listing: input.listing === "master" ? "master" : "other",
        userId: input.userId,
        now,
      });
      facilityId = reg.facilityId;
      created = reg.created;
    }
    const fac = rowsToObjects(
      await db.exec(`SELECT facility_id, company_name FROM facilities WHERE facility_id = $1 AND deleted_at IS NULL`, [facilityId])
    )[0];
    if (!fac) throw fail("업체를 찾을 수 없습니다.", 404);
    const companyName = String(fac.company_name ?? "");

    // 접견인 → 담당자 마스터. 같은 사람(이름 + 휴대폰)은 addFacilityContact 가 빈 칸만 채운다.
    const idByName = new Map<string, number>();
    let contacts = 0;
    if (input.addContacts && g.company.people.length) {
      for (const p of g.company.people) {
        await addFacilityContact(
          db,
          facilityId,
          { person_name: p.name, title: p.title ?? null, department: p.department ?? null, office_phone: p.officePhone ?? null, mobile_phone: p.mobilePhone ?? null, fax_number: null, email: p.email ?? null },
          now
        );
        contacts += 1;
      }
      const rows = rowsToObjects(
        await db.exec(
          `SELECT id, person_name FROM facility_contact_people WHERE facility_id = $1 AND status <> 'inactive' ORDER BY id DESC`,
          [facilityId]
        )
      );
      for (const r of rows) idByName.set(String(r.person_name), Number(r.id));
    }

    // 문서 값에 id 를 채운다 — 업체·접견인 항목만 바꾸고 나머지 값은 건드리지 않는다.
    let docs = 0;
    for (const slot of g.slots) {
      const cur = rowsToObjects(await db.exec(`SELECT field_values FROM approval_docs WHERE doc_id = $1 FOR UPDATE`, [slot.docId]))[0];
      if (!cur) continue;
      const fv = parseJson<Record<string, unknown>>(cur.field_values, {});
      const cv = (fv[slot.companyFieldKey] ?? {}) as Record<string, unknown>;
      if (cv.manual !== true || cv.facilityId) continue;
      await db.run(
        `UPDATE approval_docs SET field_values = jsonb_set(field_values::jsonb, ARRAY[$2::text], $3::jsonb, true), updated_at = $4 WHERE doc_id = $1`,
        [slot.docId, slot.companyFieldKey, JSON.stringify({ name: companyName, facilityId, originalName: text(cv.name) }), now]
      );
      if (idByName.size) {
        for (const k of slot.contactFieldKeys) {
          const arr = fv[k];
          if (!Array.isArray(arr)) continue;
          let changed = false;
          const next = arr.map((p) => {
            const po = (p ?? {}) as Record<string, unknown>;
            const id = po.id == null ? idByName.get(text(po.name)) : undefined;
            if (id == null) return p;
            changed = true;
            return { id, name: text(po.name), title: po.title ?? null, facilityName: companyName };
          });
          if (changed) {
            await db.run(
              `UPDATE approval_docs SET field_values = jsonb_set(field_values::jsonb, ARRAY[$2::text], $3::jsonb, true) WHERE doc_id = $1`,
              [slot.docId, k, JSON.stringify(next)]
            );
          }
        }
      }
      docs += 1;
    }
    // 열린 요청은 닫는다(등록이 끝났으므로 더 받을 것이 없다). 표가 없으면(351 미적용) 건너뛴다.
    const docIds = g.slots.map((s) => s.docId);
    if (await requestTableReady(db)) {
      await db.run(
        `UPDATE approval_contact_requests SET status = 'closed', updated_at = $2 WHERE doc_id = ANY($1::text[]) AND status IN ('pending','done')`,
        [docIds, now]
      );
    }
    await recordAuditLogInline(db, {
      actorUserId: input.userId,
      action: "approval_unlisted_company_resolve",
      targetTable: "facilities",
      targetId: facilityId,
      before: { manualName: g.company.name, docIds },
      after: { action: input.action, created, listing: input.action === "create" ? input.listing ?? "other" : undefined, docs, contacts },
    });
    return { facilityId, companyName, created, docs, contacts };
  });
}

/** 명함 등록 요청 — 그 문서의 기안자에게 접견인 상세를 요청한다. 같은 문서에 열린 요청이 있으면 그것을 돌려준다. */
export async function createContactRequest(input: {
  docId: string;
  note: string | null;
  requestedBy: string;
}): Promise<{ request: ContactRequestSummary; todoCreated: boolean; reused: boolean }> {
  const base = await withDbWrite(async (db) => {
    const { groups } = await collectGroups(db);
    const doc = groups.flatMap((g) => g.company.docs).find((d) => d.docId === input.docId);
    if (!doc) throw fail("미계약 업체가 적힌 문서가 아닙니다.", 404);
    if (!doc.drafterUserId) throw fail("기안자 계정을 찾을 수 없어 요청할 수 없습니다.");
    if (!(await requestTableReady(db))) throw fail("요청 기능이 아직 준비되지 않았습니다(마이그레이션 351 미적용).", 503);
    const open = rowsToObjects(
      await db.exec(`SELECT request_id FROM approval_contact_requests WHERE doc_id = $1 AND status = 'pending' LIMIT 1`, [input.docId])
    )[0];
    if (open) return { requestId: String(open.request_id), reused: true, doc };
    const requestId = "acr_" + crypto.randomBytes(8).toString("hex");
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO approval_contact_requests
         (request_id, doc_id, company_name, company_key, requested_to, requested_by, note, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$8)`,
      [requestId, input.docId, doc.companyText, companyKey(doc.companyText) || doc.companyText, doc.drafterUserId, input.requestedBy, input.note, now]
    );
    await recordAuditLogInline(db, {
      actorUserId: input.requestedBy,
      action: "approval_contact_request_create",
      targetTable: "approval_contact_requests",
      targetId: requestId,
      after: { docId: input.docId, companyName: doc.companyText, requestedTo: doc.drafterUserId },
    });
    return { requestId, reused: false, doc };
  });

  // 할 일 + 푸시 — 담당자를 기안자로 두면 할 일 모듈이 배정 알림을 보낸다. 실패해도 요청은 남긴다.
  let todoCreated = false;
  if (!base.reused) {
    try {
      const item = await createItem(input.requestedBy, {
        title: `접견인 명함 등록 요청 — ${base.doc.companyText}`,
        note:
          `${base.doc.formName}${base.doc.docNo ? ` ${base.doc.docNo}` : ""}에 적은 미계약 업체의 접견인 정보를 등록해 주세요.\n` +
          "명함 사진을 올리거나 직접 입력할 수 있습니다." +
          (input.note ? `\n\n요청 메모: ${input.note}` : ""),
        assigneeUserId: base.doc.drafterUserId,
        linkKind: "url",
        linkId: `/approval/contact-request?id=${base.requestId}`,
        linkLabel: "접견인 등록 화면 열기",
      });
      const db = await getDb();
      await db.run(`UPDATE approval_contact_requests SET todo_item_id = $2 WHERE request_id = $1`, [base.requestId, item.itemId]);
      todoCreated = true;
    } catch (e) {
      console.error("[approval] 명함 등록 요청 할 일 생성 실패", base.requestId, e);
    }
  }
  const request = await getContactRequest(base.requestId);
  if (!request) throw fail("요청을 찾을 수 없습니다.", 404);
  return { request, todoCreated, reused: base.reused };
}

export async function getContactRequest(requestId: string): Promise<ContactRequestSummary | null> {
  const db = await getDb();
  return (await loadRequests(db, `WHERE r.request_id = $1`, [requestId]))?.[0] ?? null;
}

/** 회신 화면용 — 요청과 그 문서에 적힌 접견인(입력란 초기값) */
export async function getContactRequestDetail(
  requestId: string
): Promise<{ request: ContactRequestSummary; receivers: UnlistedReceiver[]; docLabel: string | null } | null> {
  const db = await getDb();
  const request = (await loadRequests(db, `WHERE r.request_id = $1`, [requestId]))?.[0];
  if (!request) return null;
  const { groups } = await collectGroups(db);
  const doc = groups.flatMap((g) => g.company.docs).find((d) => d.docId === request.docId);
  return {
    request,
    receivers: doc?.receivers ?? [],
    docLabel: doc ? `${doc.formName}${doc.docNo ? ` ${doc.docNo}` : ""}` : null,
  };
}

/** 내가 받은 열린 요청 */
export async function listMyContactRequests(userId: string): Promise<ContactRequestSummary[]> {
  const db = await getDb();
  return (await loadRequests(db, `WHERE r.requested_to = $1 AND r.status = 'pending'`, [userId])) ?? [];
}

export async function cancelContactRequest(requestId: string, userId: string): Promise<void> {
  await withDbWrite(async (db) => {
    const now = new Date().toISOString();
    const res = rowsToObjects(
      await db.exec(
        `UPDATE approval_contact_requests SET status = 'canceled', updated_at = $2 WHERE request_id = $1 AND status = 'pending' RETURNING request_id`,
        [requestId, now]
      )
    );
    if (!res.length) throw fail("취소할 수 있는 요청이 아닙니다(이미 회신됐거나 취소됨).", 409);
    await recordAuditLogInline(db, {
      actorUserId: userId,
      action: "approval_contact_request_cancel",
      targetTable: "approval_contact_requests",
      targetId: requestId,
    });
  });
}

/** 기안자 회신 — 접견인 상세와 업체 정보를 요청에 담는다. 마스터 등록은 관리자가 정리 화면에서 확정한다. */
export async function respondContactRequest(input: {
  requestId: string;
  userId: string;
  response: unknown;
}): Promise<ContactRequestSummary> {
  const response = normalizeResponse(input.response);
  if (!response || !response.people.length) throw fail("접견인을 한 명 이상 입력하세요.");
  await withDbWrite(async (db) => {
    const cur = rowsToObjects(
      await db.exec(`SELECT requested_to, status FROM approval_contact_requests WHERE request_id = $1 FOR UPDATE`, [input.requestId])
    )[0];
    if (!cur) throw fail("요청을 찾을 수 없습니다.", 404);
    if (String(cur.requested_to) !== input.userId) throw fail("본인에게 온 요청만 회신할 수 있습니다.", 403);
    if (!["pending", "done"].includes(String(cur.status))) throw fail("이미 닫힌 요청입니다.", 409);
    const now = new Date().toISOString();
    await db.run(
      `UPDATE approval_contact_requests SET status = 'done', response = $2::jsonb, responded_at = $3, updated_at = $3 WHERE request_id = $1`,
      [input.requestId, JSON.stringify(response), now]
    );
  });
  const request = await getContactRequest(input.requestId);
  if (!request) throw fail("요청을 찾을 수 없습니다.", 404);
  return request;
}
