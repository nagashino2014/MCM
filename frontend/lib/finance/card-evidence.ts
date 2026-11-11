/**
 * 법인카드 증빙 대조(2026-11-11 사용자 요청) — 카드 원장에서 결재 문서(지출 증빙)가 없는 건을 모으고,
 * 출장 문서와 견주어 ①출장 경비 누락 추정 ②그 외 사용으로 나눈다. 필요하면 부서에 소명을 요청한다.
 *
 *  - 증빙 없음 = 승인 건 · 제외 표시 없음 · 연결 문서가 없거나 임시저장·반려·취소 상태.
 *    (임시저장도 카드 건을 점유하고 반려돼도 풀리지 않으므로 문서 상태를 함께 본다)
 *  - 분석은 저장하지 않고 조회할 때마다 계산한다(판정 규칙: card-evidence-pure.ts).
 *  - 카드 지정 부서를 사용자로 단정하지 않는다 — 사용일이 겹치는 전 부서 출장을 후보로 본다.
 *  - 소명 요청은 사람이 대상을 확인하고 보낸다. 기본 대상은 추정 출장 부서의 부서장(사용자 결정:
 *    출장자 추정은 틀릴 수 있어 부서 사정을 아는 부서장이 다루는 편이 낫다).
 *  - card_transactions 에는 쓰지 않는다. 요청은 card_audit_requests(352, 외래키 없음)에만 남긴다.
 *
 * ⚠ 클라이언트에서 import 금지(pg).
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite, type PgDatabase } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { cardDeptId, cardTagLabel } from "@/lib/finance/card-dept";
import { extractTripDestination, parsePeriod } from "@/lib/approval/trip";
import { deptHeadUserIds } from "@/lib/org/posts";
import { createItem } from "@/lib/todo/store";
import {
  isSharedCard, rankTrips, verdictOf,
  type Confidence, type EvidenceTrip, type EvidenceVerdict,
} from "@/lib/finance/card-evidence-pure";

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const text = (v: unknown): string => String(v ?? "").trim();
const textOrNull = (v: unknown): string | null => text(v) || null;

const TRIP_REPORT_FORM = "frm-biz-trip-report";
const TRIP_REQUEST_FORM = "frm-biz-trip-request";

export interface EvidenceMatchView {
  docId: string;
  docNo: string | null;
  formName: string;
  drafterName: string | null;
  deptId: string | null;
  deptName: string | null;
  from: string;
  to: string;
  place: string | null;
  score: number;
  confidence: Confidence;
  reasons: string[];
}

export interface AuditRequestView {
  requestId: string;
  status: "pending" | "answered" | "canceled";
  requestedTo: string;
  requestedToName: string | null;
  deptName: string | null;
  note: string | null;
  answer: string | null;
  answeredAt: string | null;
  createdAt: string;
}

export interface EvidenceRow {
  cardTxnId: string;
  usedAt: string;
  usedOn: string;
  cardLabel: string;
  cardDeptId: string | null;
  cardShared: boolean;
  storeName: string | null;
  storeAddr: string | null;
  storeBizType: string | null;
  amount: number;
  /** none 증빙 없음 / draft 작성 중(임시저장) / rejected 반려·취소된 문서에 담김 */
  evidence: "none" | "draft" | "rejected";
  evidenceDoc: { docId: string; docNo: string | null; drafterName: string | null; formName: string | null } | null;
  verdict: EvidenceVerdict;
  matches: EvidenceMatchView[];
  /** 기본 소명 대상(부서) — 관리자가 바꿀 수 있다. 정할 수 없으면 null */
  suggestedDeptId: string | null;
  /** 제안 근거 — trip 추정 출장 부서 / card 카드 지정 부서(출장 후보가 없을 때의 출발점일 뿐, 사용자라는 뜻이 아니다) */
  suggestedBy: "trip" | "card" | null;
  request: AuditRequestView | null;
}

export interface DeptHead {
  deptId: string;
  deptName: string;
  userId: string;
  userName: string | null;
}

export interface CardEvidenceResult {
  from: string;
  to: string;
  rows: EvidenceRow[];
  deptHeads: DeptHead[];
  requestsReady: boolean;
  /** 가맹점 주소가 없는 건수(지역 대조 불가) */
  noAddressCount: number;
}

function parseJson(v: unknown): Record<string, unknown> {
  try {
    const o = typeof v === "string" ? JSON.parse(v) : v;
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function requestTableReady(db: PgDatabase): Promise<boolean> {
  const r = rowsToObjects(await db.exec(`SELECT to_regclass('card_audit_requests') IS NOT NULL AS ok`))[0];
  return r?.ok === true || r?.ok === "t";
}

function toRequest(r: Record<string, unknown>): AuditRequestView {
  return {
    requestId: String(r.request_id),
    status: String(r.status) as AuditRequestView["status"],
    requestedTo: String(r.requested_to ?? ""),
    requestedToName: textOrNull(r.requested_to_name),
    deptName: textOrNull(r.dept_name),
    note: textOrNull(r.note),
    answer: textOrNull(r.answer),
    answeredAt: textOrNull(r.answered_at),
    createdAt: String(r.created_at ?? ""),
  };
}

const REQUEST_SELECT = `
  SELECT r.*, u.name AS requested_to_name, dp.dept_name
    FROM card_audit_requests r
    LEFT JOIN users u ON u.user_id = r.requested_to
    LEFT JOIN departments dp ON dp.dept_id = r.dept_id`;

/** 출장 문서에서 장소 글자와 연결 업체 id 를 모은다 — 출장지·방문지·업체 검색 값·일정 표의 방문지. */
function tripPlaces(fv: Record<string, unknown>): { places: string[]; facilityIds: string[] } {
  const places = new Set<string>();
  const facilityIds = new Set<string>();
  const dest = extractTripDestination(fv);
  if (dest) places.add(dest);
  for (const v of Object.values(fv)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if (typeof o.name === "string" && o.name.trim() && ("facilityId" in o || "manual" in o)) {
        places.add(o.name.trim());
        if (o.facilityId) facilityIds.add(String(o.facilityId));
      }
    } else if (Array.isArray(v)) {
      for (const row of v) {
        const place = row && typeof row === "object" ? text((row as Record<string, unknown>).place) : "";
        if (place) places.add(place);
      }
    }
  }
  return { places: [...places], facilityIds: [...facilityIds] };
}

const dayShift = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

interface TripInfo extends EvidenceTrip {
  docNo: string | null;
  formName: string;
  drafterName: string | null;
  deptName: string | null;
  place: string | null;
}

async function loadTrips(db: PgDatabase, from: string, to: string): Promise<TripInfo[]> {
  // 진행 중·승인 문서만. 보고서가 있는 출장은 신청서를 빼서 같은 출장이 두 번 후보로 나오지 않게 한다.
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.doc_no, d.form_id, d.ref_doc_id, d.drafter_name, d.dept_id, d.dept_name, d.field_values, f.name AS form_name
         FROM approval_docs d LEFT JOIN approval_forms f ON f.form_id = d.form_id
        WHERE d.form_id IN ($1, $2) AND d.status IN ('in_progress', 'approved')`,
      [TRIP_REPORT_FORM, TRIP_REQUEST_FORM]
    )
  );
  const reported = new Set(rows.filter((r) => r.form_id === TRIP_REPORT_FORM && r.ref_doc_id).map((r) => String(r.ref_doc_id)));
  const lo = dayShift(from, -1);
  const hi = dayShift(to, 1);
  const staged: { info: TripInfo; facilityIds: string[] }[] = [];
  for (const r of rows) {
    if (r.form_id === TRIP_REQUEST_FORM && reported.has(String(r.doc_id))) continue;
    const fv = parseJson(r.field_values);
    const period = parsePeriod(fv.trip_period);
    if (!period || period.to < lo || period.from > hi) continue;
    const { places, facilityIds } = tripPlaces(fv);
    staged.push({
      facilityIds,
      info: {
        docId: String(r.doc_id),
        docNo: textOrNull(r.doc_no),
        formName: text(r.form_name) || (r.form_id === TRIP_REPORT_FORM ? "출장보고서" : "출장신청서"),
        drafterName: textOrNull(r.drafter_name),
        deptId: textOrNull(r.dept_id),
        deptName: textOrNull(r.dept_name),
        from: period.from,
        to: period.to,
        places,
        regions: [],
        place: places[0] ?? null,
      },
    });
  }
  const ids = [...new Set(staged.flatMap((s) => s.facilityIds))];
  if (ids.length) {
    const regionById = new Map(
      rowsToObjects(await db.exec(`SELECT facility_id, region_sido, region_sigungu FROM facilities WHERE facility_id = ANY($1::text[])`, [ids])).map((f) => [
        String(f.facility_id),
        { sido: textOrNull(f.region_sido), sigungu: textOrNull(f.region_sigungu) },
      ])
    );
    for (const s of staged) s.info.regions = s.facilityIds.map((id) => regionById.get(id)).filter((x): x is { sido: string | null; sigungu: string | null } => !!x);
  }
  return staged.map((s) => s.info);
}

export async function listDeptHeads(db?: PgDatabase): Promise<DeptHead[]> {
  const conn = db ?? (await getDb());
  const depts = rowsToObjects(await conn.exec(`SELECT dept_id, dept_name FROM departments WHERE is_active = 1 ORDER BY display_order, dept_name`));
  const out: DeptHead[] = [];
  for (const d of depts) {
    const ids = await deptHeadUserIds(String(d.dept_id), null, conn);
    if (!ids.length) continue;
    const names = new Map(
      rowsToObjects(await conn.exec(`SELECT user_id, name FROM users WHERE user_id = ANY($1::text[])`, [ids])).map((u) => [String(u.user_id), textOrNull(u.name)])
    );
    // 부서장이 여럿이면 첫 사람을 기본으로 둔다(화면에서 다른 부서를 고를 수 있다)
    out.push({ deptId: String(d.dept_id), deptName: String(d.dept_name ?? ""), userId: ids[0], userName: names.get(ids[0]) ?? null });
  }
  return out;
}

export async function loadCardEvidence(range: { from: string; to: string }): Promise<CardEvidenceResult> {
  const db = await getDb();
  const txns = rowsToObjects(
    await db.exec(
      `SELECT t.card_txn_id, t.card_id, t.approved_at, t.amount_total, t.store_name, t.store_addr, t.store_biz_type, t.doc_id,
              c.card_alias, c.card_company_name, c.card_num,
              d.status AS doc_status, d.doc_no, d.drafter_name AS doc_drafter, f.name AS doc_form_name
         FROM card_transactions t
         JOIN card_registry c ON c.card_id = t.card_id
         LEFT JOIN approval_docs d ON d.doc_id = t.doc_id
         LEFT JOIN approval_forms f ON f.form_id = d.form_id
        WHERE t.approval_type = '승인' AND t.excluded = 0
          AND t.approved_at >= $1 AND t.approved_at <= $2
          AND (t.doc_id IS NULL OR d.doc_id IS NULL OR d.status IN ('draft', 'rejected', 'canceled'))
        ORDER BY t.approved_at DESC`,
      [`${range.from} 00:00:00`, `${range.to} 23:59:59`]
    )
  );

  // 카드별 실제 사용 부서 분포(증빙된 건의 기안 부서) — 지정 부서 외 사용이 많으면 공용 카드로 본다
  const usage = new Map<string, Record<string, number>>();
  for (const r of rowsToObjects(
    await db.exec(
      `SELECT t.card_id, d.dept_id, count(*)::int AS n
         FROM card_transactions t JOIN approval_docs d ON d.doc_id = t.doc_id
        WHERE d.status IN ('in_progress', 'approved') AND d.dept_id IS NOT NULL
        GROUP BY t.card_id, d.dept_id`
    )
  )) {
    const cur = usage.get(String(r.card_id)) ?? {};
    cur[String(r.dept_id)] = Number(r.n);
    usage.set(String(r.card_id), cur);
  }

  const trips = txns.length ? await loadTrips(db, range.from, range.to) : [];
  const tripById = new Map(trips.map((t) => [t.docId, t]));
  const deptHeads = await listDeptHeads(db);
  const headDepts = new Set(deptHeads.map((h) => h.deptId));

  const requestsReady = await requestTableReady(db);
  const requestByTxn = new Map<string, AuditRequestView>();
  if (requestsReady && txns.length) {
    for (const r of rowsToObjects(
      await db.exec(`${REQUEST_SELECT} WHERE r.card_txn_id = ANY($1::text[]) AND r.status <> 'canceled' ORDER BY r.created_at DESC`, [
        txns.map((t) => String(t.card_txn_id)),
      ])
    )) {
      const id = String(r.card_txn_id);
      if (!requestByTxn.has(id)) requestByTxn.set(id, toRequest(r));
    }
  }

  let noAddressCount = 0;
  const rows: EvidenceRow[] = txns.map((t) => {
    const usedAt = String(t.approved_at ?? "");
    const deptId = cardDeptId(textOrNull(t.card_alias));
    const cardShared = isSharedCard(deptId, usage.get(String(t.card_id)) ?? {});
    const storeAddr = textOrNull(t.store_addr);
    if (!storeAddr) noAddressCount += 1;
    const matches = rankTrips(
      { usedOn: usedAt.slice(0, 10), storeName: textOrNull(t.store_name), storeAddr, storeBizType: textOrNull(t.store_biz_type), cardDeptId: deptId, cardShared },
      trips
    );
    const views: EvidenceMatchView[] = matches.map((m) => {
      const trip = tripById.get(m.docId)!;
      return {
        docId: m.docId, docNo: trip.docNo, formName: trip.formName, drafterName: trip.drafterName, deptId: trip.deptId, deptName: trip.deptName,
        from: trip.from, to: trip.to, place: trip.place, score: m.score, confidence: m.confidence, reasons: m.reasons,
      };
    });
    // 기본 소명 대상 — 최고 후보 출장의 부서, 후보가 없으면 카드 지정 부서(공용 카드는 제외). 부서장이 없으면 비운다.
    const tripDept = views[0]?.deptId ?? null;
    const fallback = !cardShared ? deptId : null;
    const suggested = [tripDept, fallback].find((d) => !!d && headDepts.has(d)) ?? null;
    const suggestedBy = !suggested ? null : suggested === tripDept ? "trip" : "card";
    const docStatus = textOrNull(t.doc_status);
    return {
      cardTxnId: String(t.card_txn_id),
      usedAt,
      usedOn: usedAt.slice(0, 10),
      cardLabel: cardTagLabel(textOrNull(t.card_alias), text(t.card_num).slice(-4), textOrNull(t.card_company_name)),
      cardDeptId: deptId,
      cardShared,
      storeName: textOrNull(t.store_name),
      storeAddr,
      storeBizType: textOrNull(t.store_biz_type),
      amount: Number(t.amount_total ?? 0),
      evidence: docStatus === "draft" ? "draft" : docStatus ? "rejected" : "none",
      evidenceDoc: docStatus
        ? { docId: String(t.doc_id), docNo: textOrNull(t.doc_no), drafterName: textOrNull(t.doc_drafter), formName: textOrNull(t.doc_form_name) }
        : null,
      verdict: verdictOf(matches),
      matches: views,
      suggestedDeptId: suggested,
      suggestedBy,
      request: requestByTxn.get(String(t.card_txn_id)) ?? null,
    };
  });

  return { from: range.from, to: range.to, rows, deptHeads, requestsReady, noAddressCount };
}

export interface AuditRequestItem {
  cardTxnId: string;
  /** 소명 대상 부서 — 그 부서의 부서장에게 보낸다 */
  deptId: string;
  /** 추정 근거로 본 출장 문서(없으면 null) */
  tripDocId?: string | null;
}

/**
 * 소명 요청 발송 — 관리자가 고른 건·대상만 보낸다(자동 발송 없음).
 * 받는 사람별로 할 일 한 건을 만들고(할 일 모듈이 배정 알림을 보낸다) 카드 건마다 요청 행을 남긴다.
 */
export async function createCardAuditRequests(input: {
  items: AuditRequestItem[];
  note: string | null;
  requestedBy: string;
}): Promise<{ created: number; skipped: number; recipients: number; todoFailed: number }> {
  if (!input.items.length) throw fail("소명을 요청할 카드 건을 고르세요.");
  const heads = new Map((await listDeptHeads()).map((h) => [h.deptId, h]));
  const byUser = new Map<string, { head: DeptHead; ids: string[] }>();
  let skipped = 0;

  await withDbWrite(async (db) => {
    if (!(await requestTableReady(db))) throw fail("소명 요청 기능이 아직 준비되지 않았습니다(마이그레이션 352 미적용).", 503);
    const now = new Date().toISOString();
    for (const item of input.items) {
      const head = heads.get(item.deptId);
      if (!head) throw fail("부서장이 지정되지 않은 부서가 있습니다. 대상을 다시 고르세요.");
      const txn = rowsToObjects(await db.exec(`SELECT card_txn_id FROM card_transactions WHERE card_txn_id = $1`, [item.cardTxnId]))[0];
      if (!txn) throw fail("카드 건을 찾을 수 없습니다.", 404);
      const open = rowsToObjects(
        await db.exec(`SELECT 1 FROM card_audit_requests WHERE card_txn_id = $1 AND status = 'pending' LIMIT 1`, [item.cardTxnId])
      )[0];
      if (open) {
        skipped += 1;
        continue;
      }
      const requestId = "car_" + crypto.randomBytes(8).toString("hex");
      await db.run(
        `INSERT INTO card_audit_requests
           (request_id, card_txn_id, dept_id, requested_to, requested_by, trip_doc_id, note, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$8)`,
        [requestId, item.cardTxnId, item.deptId, head.userId, input.requestedBy, item.tripDocId ?? null, input.note, now]
      );
      const group = byUser.get(head.userId) ?? { head, ids: [] };
      group.ids.push(requestId);
      byUser.set(head.userId, group);
    }
    const created = [...byUser.values()].reduce((n, g) => n + g.ids.length, 0);
    if (created) {
      await recordAuditLogInline(db, {
        actorUserId: input.requestedBy,
        action: "card_audit_request_create",
        targetTable: "card_audit_requests",
        targetId: [...byUser.values()][0].ids[0],
        after: { count: created, recipients: [...byUser.keys()] },
      });
    }
  });

  let todoFailed = 0;
  for (const g of byUser.values()) {
    try {
      const item = await createItem(input.requestedBy, {
        title: `법인카드 사용 내역 소명 요청 ${g.ids.length}건`,
        note:
          "증빙(결재 문서)이 없는 법인카드 사용 건입니다. 누가 어떤 용도로 썼는지 확인해 회신해 주세요.\n" +
          "출장 경비라면 출장보고서에 담아 올리면 됩니다." +
          (input.note ? `\n\n요청 메모: ${input.note}` : ""),
        assigneeUserId: g.head.userId,
        linkKind: "url",
        linkId: "/approval/card-audit",
        linkLabel: "소명 화면 열기",
      });
      const db = await getDb();
      await db.run(`UPDATE card_audit_requests SET todo_item_id = $2 WHERE request_id = ANY($1::text[])`, [g.ids, item.itemId]);
    } catch (e) {
      todoFailed += 1;
      console.error("[finance] 카드 소명 요청 할 일 생성 실패", g.head.userId, e);
    }
  }
  const created = [...byUser.values()].reduce((n, g) => n + g.ids.length, 0);
  return { created, skipped, recipients: byUser.size, todoFailed };
}

export async function cancelCardAuditRequest(requestId: string, userId: string): Promise<void> {
  await withDbWrite(async (db) => {
    const res = rowsToObjects(
      await db.exec(
        `UPDATE card_audit_requests SET status = 'canceled', updated_at = $2 WHERE request_id = $1 AND status = 'pending' RETURNING request_id`,
        [requestId, new Date().toISOString()]
      )
    );
    if (!res.length) throw fail("취소할 수 있는 요청이 아닙니다(이미 회신됐거나 취소됨).", 409);
    await recordAuditLogInline(db, { actorUserId: userId, action: "card_audit_request_cancel", targetTable: "card_audit_requests", targetId: requestId });
  });
}

export interface MyAuditRequest extends AuditRequestView {
  usedAt: string;
  cardLabel: string;
  storeName: string | null;
  storeAddr: string | null;
  amount: number;
  /** 요청 뒤 결재 문서에 담겨 증빙이 생겼는지 */
  evidenced: boolean;
  trip: { docId: string; docNo: string | null; drafterName: string | null; from: string | null; to: string | null; place: string | null } | null;
}

/** 내가 받은 소명 요청 — 카드 건의 사용일·가맹점·금액만 보여 준다(재무 권한 없이 본인 요청 건에 한해). */
export async function listMyCardAuditRequests(userId: string): Promise<MyAuditRequest[]> {
  const db = await getDb();
  if (!(await requestTableReady(db))) return [];
  const rows = rowsToObjects(
    await db.exec(
      `SELECT r.*, u.name AS requested_to_name, dp.dept_name,
              t.approved_at, t.amount_total, t.store_name, t.store_addr, c.card_alias, c.card_company_name, c.card_num,
              ed.status AS evidence_status,
              td.doc_no AS trip_doc_no, td.drafter_name AS trip_drafter, td.field_values AS trip_values
         FROM card_audit_requests r
         LEFT JOIN users u ON u.user_id = r.requested_to
         LEFT JOIN departments dp ON dp.dept_id = r.dept_id
         LEFT JOIN card_transactions t ON t.card_txn_id = r.card_txn_id
         LEFT JOIN card_registry c ON c.card_id = t.card_id
         LEFT JOIN approval_docs ed ON ed.doc_id = t.doc_id
         LEFT JOIN approval_docs td ON td.doc_id = r.trip_doc_id
        WHERE r.requested_to = $1 AND r.status IN ('pending', 'answered')
        ORDER BY (r.status = 'pending') DESC, t.approved_at DESC`,
      [userId]
    )
  );
  return rows.map((r) => {
    const fv = parseJson(r.trip_values);
    const period = parsePeriod(fv.trip_period);
    return {
      ...toRequest(r),
      usedAt: String(r.approved_at ?? ""),
      cardLabel: cardTagLabel(textOrNull(r.card_alias), text(r.card_num).slice(-4), textOrNull(r.card_company_name)),
      storeName: textOrNull(r.store_name),
      storeAddr: textOrNull(r.store_addr),
      amount: Number(r.amount_total ?? 0),
      evidenced: ["in_progress", "approved"].includes(String(r.evidence_status ?? "")),
      trip: r.trip_doc_id
        ? { docId: String(r.trip_doc_id), docNo: textOrNull(r.trip_doc_no), drafterName: textOrNull(r.trip_drafter), from: period?.from ?? null, to: period?.to ?? null, place: extractTripDestination(fv) }
        : null,
    };
  });
}

/** 회신 — 받은 사람 본인만. 사유를 남기고 answered 로 바꾼다(다시 고쳐 쓸 수 있다). */
export async function answerCardAuditRequest(input: { requestId: string; userId: string; answer: string }): Promise<void> {
  const answer = input.answer.trim().slice(0, 1000);
  if (!answer) throw fail("소명 내용을 입력하세요.");
  await withDbWrite(async (db) => {
    const cur = rowsToObjects(await db.exec(`SELECT requested_to, status FROM card_audit_requests WHERE request_id = $1 FOR UPDATE`, [input.requestId]))[0];
    if (!cur) throw fail("요청을 찾을 수 없습니다.", 404);
    if (String(cur.requested_to) !== input.userId) throw fail("본인에게 온 요청만 회신할 수 있습니다.", 403);
    if (String(cur.status) === "canceled") throw fail("취소된 요청입니다.", 409);
    const now = new Date().toISOString();
    await db.run(
      `UPDATE card_audit_requests SET status = 'answered', answer = $2, answered_by = $3, answered_at = $4, updated_at = $4 WHERE request_id = $1`,
      [input.requestId, answer, input.userId, now]
    );
  });
}
