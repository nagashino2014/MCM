/**
 * 전자결재 알림 디스패처(AX-P0) — 결재 이벤트를 이메일(SES)+알림톡(솔라피)로 발송.
 * 이벤트: step_pending(내 차례 도래)·delegated(대결 위임)·approved(최종 승인)·rejected(반려)·remind(리마인드, AX-P1)
 *        ·absence_skipped(부재 건너뜀)·proxy_done(대결 처리 후열)·final_absent(최종 결재자 부재)·final_approved(전결, DA-3 발송).
 * 부재·대결 설계: docs/e-approval-delegation-blueprint.md §5·§6.
 * ★결재 트랜잭션 커밋 이후(fire-and-forget) 호출한다 — 발송 실패가 결재 진행을 막지 않도록 항상 try/catch 로 격리.
 * 멱등: approval_notify_log.dedup_key UNIQUE 로 재활성/재호출 시 중복 발송을 방지한다.
 * 설계: docs/e-approval-differentiation-blueprint.md §9-1.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { sendNotifyEmail, type ChannelSendResult } from "@/lib/notify/email-ses";
import { sendAlimtalk } from "@/lib/notify/kakao-solapi";
import { sendPush, type PushEventKey } from "@/lib/notify/push-expo";
import { TICK_CACHE_APPROVAL_REMIND, invalidateTickCache, loadTickCached } from "@/lib/tick-cache";

export type ApprovalNotifyEvent =
  | "step_pending"
  | "delegated"
  | "approved"
  | "rejected"
  | "remind"
  | "cancel_requested"
  | "canceled"
  | "absence_skipped"
  | "proxy_done"
  | "final_absent"
  | "final_approved";

/** 결재 이벤트 → 모바일 푸시 이벤트 키(앱 알림 설정에서 사용자가 켜고 끄는 단위).
 *  cancel_requested/canceled 는 기존 키를 재사용한다 — 모바일 알림 설정 화면 무변경. */
const PUSH_EVENT_BY_APPROVAL: Record<ApprovalNotifyEvent, PushEventKey> = {
  step_pending: "approval.step_pending",
  delegated: "approval.delegated",
  approved: "approval.result",
  rejected: "approval.result",
  remind: "approval.remind",
  cancel_requested: "approval.step_pending",
  canceled: "approval.result",
  // 부재·대결 안내(301·DA-2) — 진행 상황 통지라 결과 알림 키를 재사용(모바일 알림 설정 화면 무변경).
  absence_skipped: "approval.result",
  proxy_done: "approval.result",
  final_absent: "approval.result",
  final_approved: "approval.result",
};

interface NotifySettingRow {
  emailEnabled: boolean;
  alimtalkEnabled: boolean;
  /** 모바일 푸시(M1). 컬럼은 마이그 109 에서 추가 — 미적용 DB 에서도 죽지 않게 기본 on 폴백. */
  pushEnabled: boolean;
  remindAfterHours: number | null;
}

/** 결재함으로 이동하는 링크(알림 본문용). 배포 도메인은 env, 미설정 시 staging 기본. */
function appLink(path = "/approval"): string {
  const base = (process.env.APP_PUBLIC_URL ?? "https://koensain.app").replace(/\/+$/, "");
  return `${base}${path}`;
}

/** 이벤트별 채널 설정 조회(미설정 이벤트는 둘 다 on 으로 간주). */
export async function getNotifySetting(event: ApprovalNotifyEvent): Promise<NotifySettingRow> {
  const db = await getDb();
  // push_enabled 는 마이그 109 에서 추가된 컬럼이라 `SELECT *` 로 읽는다
  // (미적용 DB 에서 컬럼 미존재로 쿼리 전체가 깨지지 않게).
  // 테이블 자체가 없는 환경도 있다(091 미적용 staging 실측) → 그때도 기본값으로 동작시킨다.
  let rows: Record<string, unknown>[] = [];
  try {
    rows = rowsToObjects(await db.exec(`SELECT * FROM approval_notify_settings WHERE event = $1`, [event]));
  } catch {
    return { emailEnabled: true, alimtalkEnabled: true, pushEnabled: true, remindAfterHours: null };
  }
  const r = rows[0];
  if (!r) return { emailEnabled: true, alimtalkEnabled: true, pushEnabled: true, remindAfterHours: null };
  return {
    emailEnabled: Number(r.email_enabled ?? 1) === 1,
    alimtalkEnabled: Number(r.alimtalk_enabled ?? 1) === 1,
    pushEnabled: Number(r.push_enabled ?? 1) === 1,
    remindAfterHours: r.remind_after_hours != null ? Number(r.remind_after_hours) : null,
  };
}

export interface NotifyEventSetting {
  event: ApprovalNotifyEvent;
  emailEnabled: boolean;
  alimtalkEnabled: boolean;
  remindAfterHours: number | null;
}

const EVENT_ORDER: ApprovalNotifyEvent[] = [
  "step_pending",
  "delegated",
  "approved",
  "rejected",
  "remind",
  "absence_skipped",
  "proxy_done",
  "final_absent",
  "final_approved",
];

/** 이벤트별 알림 설정 전체 조회(관리 화면). */
export async function listNotifySettings(): Promise<NotifyEventSetting[]> {
  const db = await getDb();
  const rows = rowsToObjects(await db.exec(`SELECT event, email_enabled, alimtalk_enabled, remind_after_hours FROM approval_notify_settings`));
  const map = new Map(rows.map((r) => [String(r.event), r]));
  return EVENT_ORDER.map((event) => {
    const r = map.get(event);
    return {
      event,
      emailEnabled: r ? Number(r.email_enabled ?? 1) === 1 : true,
      alimtalkEnabled: r ? Number(r.alimtalk_enabled ?? 1) === 1 : true,
      remindAfterHours: r && r.remind_after_hours != null ? Number(r.remind_after_hours) : event === "remind" ? 24 : null,
    };
  });
}

/** 알림 설정 저장(전체 upsert). */
export async function saveNotifySettings(items: NotifyEventSetting[]): Promise<void> {
  const now = new Date().toISOString();
  await withDbWrite(async (db) => {
    for (const it of items) {
      if (!EVENT_ORDER.includes(it.event)) continue;
      await db.run(
        `INSERT INTO approval_notify_settings (event, email_enabled, alimtalk_enabled, remind_after_hours, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (event) DO UPDATE SET email_enabled = EXCLUDED.email_enabled,
           alimtalk_enabled = EXCLUDED.alimtalk_enabled, remind_after_hours = EXCLUDED.remind_after_hours, updated_at = EXCLUDED.updated_at`,
        [
          it.event,
          it.emailEnabled ? 1 : 0,
          it.alimtalkEnabled ? 1 : 0,
          it.event === "remind" ? (it.remindAfterHours != null ? Math.max(1, Math.round(it.remindAfterHours)) : 24) : null,
          now,
        ]
      );
    }
  });
  invalidateTickCache(TICK_CACHE_APPROVAL_REMIND);
}

interface Contact {
  email: string;
  phone: string;
  name: string;
}

/** user_id → employee_profiles(email/mobile_phone/name). 발송 시점에 조회(bid 디스패처와 동일 소스). */
async function resolveContacts(userIds: string[]): Promise<Map<string, Contact>> {
  const out = new Map<string, Contact>();
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return out;
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT u.user_id, ep.email, ep.mobile_phone, COALESCE(ep.name, u.email) AS name
         FROM users u LEFT JOIN employee_profiles ep ON ep.employee_id = u.employee_id
        WHERE u.user_id = ANY($1::text[])`,
      [ids]
    )
  );
  for (const r of rows) {
    out.set(String(r.user_id), {
      email: r.email != null ? String(r.email) : "",
      phone: r.mobile_phone != null ? String(r.mobile_phone) : "",
      name: r.name != null ? String(r.name) : "",
    });
  }
  return out;
}

/**
 * dedup_key 로 발송을 1회 선점(claim)한다. 새로 선점하면 true, 이미 있으면 false(중복 → 스킵).
 * 커밋 후 호출이라 별도 withDbWrite 로 원자 INSERT.
 */
async function claimDedup(dedupKey: string, docId: string, stepId: string | null, event: string, userId: string | null): Promise<string | null> {
  let notifyId: string | null = null;
  await withDbWrite(async (db) => {
    const rows = rowsToObjects(
      await db.exec(
        `INSERT INTO approval_notify_log (notify_id, doc_id, step_id, event, recipient_user_id, dedup_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (dedup_key) DO NOTHING
         RETURNING notify_id`,
        ["antf-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14), docId, stepId, event, userId, dedupKey, new Date().toISOString()]
      )
    );
    notifyId = rows.length ? String(rows[0].notify_id) : null;
  });
  return notifyId;
}

async function finalizeLog(notifyId: string, channels: Record<string, ChannelSendResult>): Promise<void> {
  const anySent = Object.values(channels).some((c) => c.ok);
  const anyTried = Object.values(channels).some((c) => c.ok || c.error);
  const detail = anySent ? "sent" : anyTried ? "failed" : "skipped";
  await withDbWrite(async (db) => {
    await db.run(`UPDATE approval_notify_log SET channels = $2::jsonb, ok = $3, detail = $4 WHERE notify_id = $1`, [
      notifyId,
      JSON.stringify(channels),
      anySent ? 1 : 0,
      detail,
    ]);
  });
}

/** 단일 수신자 발송(멱등) — 설정된 채널로 이메일/알림톡 전송 후 로그 확정. */
async function deliver(params: {
  event: ApprovalNotifyEvent;
  docId: string;
  stepId: string | null;
  dedupKey: string;
  userId: string;
  contact: Contact | undefined;
  subject: string;
  text: string;
  /** 푸시 본문(짧게 — 보통 문서 제목). 미지정 시 subject 를 쓴다. */
  pushBody?: string;
}): Promise<void> {
  const notifyId = await claimDedup(params.dedupKey, params.docId, params.stepId, params.event, params.userId);
  if (!notifyId) return; // 이미 발송됨
  const setting = await getNotifySetting(params.event);
  const channels: Record<string, ChannelSendResult> = {};
  if (setting.emailEnabled && params.contact?.email) {
    channels.email = await sendNotifyEmail({ to: [params.contact.email], subject: params.subject, text: params.text });
  }
  if (setting.alimtalkEnabled && params.contact?.phone) {
    channels.alimtalk = await sendAlimtalk({ to: [params.contact.phone], text: params.text });
  }
  // 모바일 푸시(M1) — 상위에서 이미 dedup 을 선점했으므로 여기서는 dedupKey 를 넘기지 않는다.
  if (setting.pushEnabled) {
    channels.push = await sendPush([params.userId], {
      event: PUSH_EVENT_BY_APPROVAL[params.event],
      title: params.subject.replace(/^\[전자결재\]\s*/, "전자결재 · "),
      body: params.pushBody ?? params.subject,
      link: `/approval?docId=${params.docId}`,
      targetRef: params.docId,
    });
  }
  if (!Object.keys(channels).length) channels.none = { ok: false, skipped: "수신 채널·연락처 없음" };
  await finalizeLog(notifyId, channels);
}

interface DocHeader {
  docId: string;
  docNo: string | null;
  title: string;
  formName: string;
  drafterName: string | null;
  drafterUserId: string | null;
  urgent: boolean;
}

async function loadDocHeader(docId: string): Promise<DocHeader | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT d.doc_id, d.doc_no, d.title, d.urgent, d.drafter_name, d.drafter_user_id, f.name AS form_name
         FROM approval_docs d JOIN approval_forms f ON f.form_id = d.form_id WHERE d.doc_id = $1`,
      [docId]
    )
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    docId: String(r.doc_id),
    docNo: r.doc_no != null ? String(r.doc_no) : null,
    title: String(r.title ?? ""),
    formName: String(r.form_name ?? ""),
    drafterName: r.drafter_name != null ? String(r.drafter_name) : null,
    drafterUserId: r.drafter_user_id != null ? String(r.drafter_user_id) : null,
    urgent: Number(r.urgent ?? 0) === 1,
  };
}

function commonFooter(doc: DocHeader): string {
  return `\n문서번호: ${doc.docNo ?? "미채번"}\n양식: ${doc.formName}\n기안자: ${doc.drafterName ?? "-"}\n\n▶ 결재함에서 확인: ${appLink()}`;
}

/**
 * 진행 중 문서의 현재 pending 결재자들에게 '내 차례' 알림(대결 위임 단계는 delegated 이벤트).
 * 상신 직후·다음 결재선 활성화 후 호출. 단계별 dedup 이라 재활성/중복 호출에 안전하다.
 */
export async function notifyPendingSteps(docId: string): Promise<void> {
  try {
    const doc = await loadDocHeader(docId);
    if (!doc) return;
    const db = await getDb();
    const steps = rowsToObjects(
      await db.exec(
        `SELECT s.step_id, s.assignee_user_id, s.delegated_from, s.step_type
           FROM approval_steps s JOIN approval_docs d ON d.doc_id = s.doc_id
          WHERE s.doc_id = $1 AND s.status = 'pending' AND d.status = 'in_progress'`,
        [docId]
      )
    );
    if (!steps.length) return;
    const contacts = await resolveContacts(steps.map((s) => String(s.assignee_user_id)));
    for (const s of steps) {
      const stepId = String(s.step_id);
      const userId = String(s.assignee_user_id);
      const delegated = s.delegated_from != null && String(s.delegated_from) !== "";
      const event: ApprovalNotifyEvent = delegated ? "delegated" : "step_pending";
      const urgentTag = doc.urgent ? "[긴급] " : "";
      const kindLabel = String(s.step_type) === "agree" ? "합의" : "승인";
      const subject = delegated
        ? `[전자결재] ${urgentTag}대결 결재 요청: ${doc.title}`
        : `[전자결재] ${urgentTag}${kindLabel} 요청: ${doc.title}`;
      const head = delegated
        ? `대결자로 지정되어 결재 요청이 도착했습니다.`
        : `${kindLabel} 결재 요청이 도착했습니다.`;
      await deliver({
        event,
        docId,
        stepId,
        // 대결은 연쇄 재라우팅으로 같은 단계의 수신자가 바뀔 수 있어 수신자까지 키에 넣는다(DA-1).
        dedupKey: delegated ? `${event}:${stepId}:${userId}` : `${event}:${stepId}`,
        userId,
        contact: contacts.get(userId),
        subject,
        text: `${head}\n\n제목: ${doc.title}${commonFooter(doc)}`,
        pushBody: doc.title,
      });
    }
    await notifyAbsenceOutcomes(doc);
  } catch (err) {
    console.error("[approval-notify] notifyPendingSteps 실패", docId, err);
  }
}

/**
 * 부재 처리 결과를 기안자에게 안내(DA-2) — notifyPendingSteps 끝에서 호출(상신·결재·재라우팅 공통 경로).
 *  - absence_skipped: 부재(건너뛰기)로 생략된 단계 — 단계별 1회.
 *  - final_absent: 최종 결재자가 지금 부재 중인데 그 차례가 됨 — 대결·건너뛰기 없이 복귀 후 결재(D-2). 단계별 1회.
 */
async function notifyAbsenceOutcomes(doc: DocHeader): Promise<void> {
  if (!doc.drafterUserId) return;
  const db = await getDb();
  const today = kstDate();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT s.step_id, s.status, s.skip_reason, s.assignee_user_id, s.assignee_name,
              s.step_order >= (SELECT max(x.step_order) FROM approval_steps x WHERE x.doc_id = s.doc_id) AS is_final,
              (SELECT max(a.end_date) FROM approval_absences a
                WHERE a.user_id = s.assignee_user_id AND a.canceled_at IS NULL AND a.start_date <= $2 AND a.end_date >= $2) AS absent_until,
              (SELECT max(ld.field_values->'leave_period'->>'to') FROM approval_docs ld
                WHERE ld.form_id = 'frm-leave-request' AND ld.status = 'approved' AND ld.drafter_user_id = s.assignee_user_id
                  AND ld.field_values->'leave_period'->>'from' <= $2 AND ld.field_values->'leave_period'->>'to' >= $2) AS leave_until
         FROM approval_steps s
        WHERE s.doc_id = $1 AND ((s.status = 'skipped' AND s.skip_reason = 'absence') OR s.status = 'pending')`,
      [doc.docId, today]
    )
  );
  if (!rows.length) return;
  const contacts = await resolveContacts([doc.drafterUserId]);
  for (const r of rows) {
    const stepId = String(r.step_id);
    const name = String(r.assignee_name ?? r.assignee_user_id ?? "-");
    if (String(r.status) === "skipped") {
      await deliver({
        event: "absence_skipped",
        docId: doc.docId,
        stepId,
        dedupKey: `absence_skipped:${stepId}`,
        userId: doc.drafterUserId,
        contact: contacts.get(doc.drafterUserId),
        subject: `[전자결재] 결재자 부재로 다음 단계 진행: ${doc.title}`,
        text: `${name}님이 부재 중이라 해당 결재 단계를 건너뛰고 다음 결재자에게 넘어갔습니다.\n\n제목: ${doc.title}${commonFooter(doc)}`,
        pushBody: `${name}님 부재 — 다음 결재자로 넘어감`,
      });
      continue;
    }
    const until = r.absent_until != null ? String(r.absent_until) : r.leave_until != null ? String(r.leave_until) : null;
    if (!r.is_final || !until) continue;
    await deliver({
      event: "final_absent",
      docId: doc.docId,
      stepId,
      dedupKey: `final_absent:${stepId}`,
      userId: doc.drafterUserId,
      contact: contacts.get(doc.drafterUserId),
      subject: `[전자결재] 최종 결재자 부재 안내: ${doc.title}`,
      text:
        `최종 결재자 ${name}님이 ${until}까지 부재 중입니다. 최종 결재는 대결·건너뛰기 없이 복귀 후 직접 처리되며, 그때 결재가 완료됩니다.` +
        `\n\n제목: ${doc.title}${commonFooter(doc)}`,
      pushBody: `최종 결재자 ${name}님 부재(~${until}) — 복귀 후 결재`,
    });
  }
}

/** 대결 처리 후열 통지(DA-2) — 대결자가 승인·반려하면 원결재자에게 1회 알린다. 커밋 후 호출. */
export async function notifyProxyDone(docId: string, stepId: string): Promise<void> {
  try {
    const doc = await loadDocHeader(docId);
    if (!doc) return;
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(`SELECT delegated_from, assignee_name, status, comment, act_type FROM approval_steps WHERE step_id = $1`, [stepId])
    );
    const r = rows[0];
    if (!r || String(r.act_type ?? "") !== "proxy" || r.delegated_from == null) return;
    const original = String(r.delegated_from);
    const contacts = await resolveContacts([original]);
    const verb = String(r.status) === "rejected" ? "반려" : "승인";
    const note = String(r.comment ?? "").trim() ? `\n의견: ${String(r.comment).trim()}` : "";
    await deliver({
      event: "proxy_done",
      docId,
      stepId,
      dedupKey: `proxy_done:${stepId}`,
      userId: original,
      contact: contacts.get(original),
      subject: `[전자결재] 대결 처리 안내: ${doc.title}`,
      text: `부재 중 대결자 ${r.assignee_name ?? "-"}님이 회원님 대신 ${verb}했습니다.${note}\n\n제목: ${doc.title}${commonFooter(doc)}`,
      pushBody: `${r.assignee_name ?? "대결자"}님이 대결 ${verb}`,
    });
  } catch (err) {
    console.error("[approval-notify] notifyProxyDone 실패", docId, err);
  }
}

/**
 * 다른 사람(결재 관리자)이 내 부재를 등록·취소했을 때 본인에게 알린다(DA-2 관리자 대리 등록).
 * 문서와 무관한 알림이라 발송 로그(approval_notify_log, doc_id 필수) 없이 이메일·푸시만 보낸다.
 */
export async function notifyAbsenceChangedByOther(params: {
  userId: string;
  actorName: string;
  action: "created" | "canceled";
  startDate: string;
  endDate: string;
  modeLabel: string;
}): Promise<void> {
  try {
    const contacts = await resolveContacts([params.userId]);
    const contact = contacts.get(params.userId);
    const verb = params.action === "created" ? "등록" : "취소";
    const subject = `[전자결재] 부재 설정 ${verb} 안내`;
    const text =
      `${params.actorName}님이 회원님의 결재 부재 설정을 ${verb}했습니다.\n\n기간: ${params.startDate} ~ ${params.endDate}\n처리 방식: ${params.modeLabel}` +
      `\n\n▶ 부재·대결 설정에서 확인: ${appLink("/approval/absence")}`;
    if (contact?.email) await sendNotifyEmail({ to: [contact.email], subject, text });
    await sendPush([params.userId], {
      event: "approval.delegated",
      title: `전자결재 · 부재 설정 ${verb}`,
      body: `${params.startDate} ~ ${params.endDate} · ${params.modeLabel}`,
      link: "/approval/absence",
    });
  } catch (err) {
    console.error("[approval-notify] notifyAbsenceChangedByOther 실패", params.userId, err);
  }
}

/** KST(UTC+9) 기준 YYYY-MM-DD. */
function kstDate(now = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export interface RemindResult {
  reminded: number;
  skipped?: string;
}

/**
 * 미결재 리마인드 배치(AX-P1) — pending 단계가 activated_at 이후 remind_after_hours 시간 넘게
 * 대기 중이면 결재자에게 재알림한다. 스텝×일자 dedup(remind:{stepId}:{KST date})으로 1일 1회.
 * instrumentation 타이머가 내부 라우트로 위임 호출한다(next 상시 태스크 = 스케줄 배치).
 */
export async function dispatchDueReminders(now = new Date()): Promise<RemindResult> {
  // 리마인드가 꺼져 있으면 DB 를 열지 않고 끝낸다 — 유휴 시간대 Aurora auto-pause 유지
  // (배경은 lib/tick-cache.ts). 설정 저장 시 캐시가 무효화되므로 켠 직후부터 바로 돈다.
  const setting = await loadTickCached(TICK_CACHE_APPROVAL_REMIND, () => getNotifySetting("remind"));
  if (!setting.emailEnabled && !setting.alimtalkEnabled) return { reminded: 0, skipped: "remind-disabled" };
  const hours = setting.remindAfterHours ?? 24;
  const cutoff = new Date(now.getTime() - hours * 3600 * 1000).toISOString();
  const today = kstDate(now);
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT s.step_id, s.doc_id, s.assignee_user_id, s.step_type
         FROM approval_steps s JOIN approval_docs d ON d.doc_id = s.doc_id
        WHERE s.status = 'pending' AND d.status = 'in_progress'
          AND s.activated_at IS NOT NULL AND s.activated_at < $1
          AND NOT EXISTS (
            SELECT 1 FROM approval_notify_log l WHERE l.dedup_key = 'remind:' || s.step_id || ':' || $2
          )
          -- 부재 등록 기간 중인 결재자(주로 부재와 무관하게 남는 최종 결재자, D-2)는 리마인드 보류(DA-2).
          AND NOT EXISTS (
            SELECT 1 FROM approval_absences a
             WHERE a.user_id = s.assignee_user_id AND a.canceled_at IS NULL AND a.start_date <= $2 AND a.end_date >= $2
          )
        LIMIT 500`,
      [cutoff, today]
    )
  );
  if (!rows.length) return { reminded: 0, skipped: "none-due" };

  const docIds = [...new Set(rows.map((r) => String(r.doc_id)))];
  const headers = new Map<string, DocHeader>();
  for (const id of docIds) {
    const h = await loadDocHeader(id);
    if (h) headers.set(id, h);
  }
  const contacts = await resolveContacts(rows.map((r) => String(r.assignee_user_id)));
  let reminded = 0;
  for (const r of rows) {
    const doc = headers.get(String(r.doc_id));
    if (!doc) continue;
    const stepId = String(r.step_id);
    const userId = String(r.assignee_user_id);
    const kindLabel = String(r.step_type) === "agree" ? "합의" : "승인";
    await deliver({
      event: "remind",
      docId: doc.docId,
      stepId,
      dedupKey: `remind:${stepId}:${today}`,
      userId,
      contact: contacts.get(userId),
      subject: `[전자결재] 미결재 알림: ${doc.title}`,
      text: `${hours}시간 이상 처리되지 않은 ${kindLabel} 결재가 있습니다.\n\n제목: ${doc.title}${commonFooter(doc)}`,
      pushBody: doc.title,
    });
    reminded++;
  }
  return { reminded };
}

/**
 * 반려 요청(취소 요청) 알림 — 기안자가 휴가/출장/교육 문서의 취소·변경을 요청했을 때.
 *   in_progress → 현재 pending 결재자들(기존 반려 기능으로 처리 유도)
 *   approved   → 관리자(role='admin' 활성 계정 — tpl-system-admin 부여 대상과 동일 모집단)
 * dedup: cancel_requested:{requestId}:{userId} — 요청 1건당 수신자별 1회.
 */
export async function notifyCancelRequested(params: {
  docId: string;
  requestId: string;
  reason: string;
  docStatus: "in_progress" | "approved";
}): Promise<void> {
  try {
    const doc = await loadDocHeader(params.docId);
    if (!doc) return;
    const db = await getDb();
    let userIds: string[] = [];
    if (params.docStatus === "in_progress") {
      const rows = rowsToObjects(
        await db.exec(`SELECT assignee_user_id FROM approval_steps WHERE doc_id = $1 AND status = 'pending'`, [params.docId])
      );
      userIds = rows.map((r) => String(r.assignee_user_id));
    } else {
      const rows = rowsToObjects(await db.exec(`SELECT user_id FROM users WHERE role = 'admin' AND status = 'active'`));
      userIds = rows.map((r) => String(r.user_id));
    }
    if (!userIds.length) return;
    const contacts = await resolveContacts(userIds);
    const action = params.docStatus === "in_progress" ? "반려 처리해 주시기 바랍니다." : "결재 취소 처리해 주시기 바랍니다.";
    for (const userId of userIds) {
      await deliver({
        event: "cancel_requested",
        docId: params.docId,
        stepId: null,
        dedupKey: `cancel_requested:${params.requestId}:${userId}`,
        userId,
        contact: contacts.get(userId),
        subject: `[전자결재] 반려 요청: ${doc.title}`,
        text: `기안자가 문서의 반려(취소)를 요청했습니다. 내용 확인 후 ${action}\n\n제목: ${doc.title}\n요청 사유: ${params.reason}${commonFooter(doc)}`,
        pushBody: doc.title,
      });
    }
  } catch (err) {
    console.error("[approval-notify] notifyCancelRequested 실패", params.docId, err);
  }
}

/** 결재 취소(canceled) 완료를 기안자에게 알림. dedup: canceled:{docId}:{requestId}. */
export async function notifyDocCanceled(docId: string, requestId: string): Promise<void> {
  try {
    const doc = await loadDocHeader(docId);
    if (!doc || !doc.drafterUserId) return;
    const contacts = await resolveContacts([doc.drafterUserId]);
    await deliver({
      event: "canceled",
      docId,
      stepId: null,
      dedupKey: `canceled:${docId}:${requestId}`,
      userId: doc.drafterUserId,
      contact: contacts.get(doc.drafterUserId),
      subject: `[전자결재] 결재 취소 완료: ${doc.title}`,
      text: `요청하신 문서의 결재가 취소되었습니다. 휴가 문서는 연차 대장 사용분도 함께 회수되었습니다.\n\n제목: ${doc.title}${commonFooter(doc)}`,
      pushBody: doc.title,
    });
  } catch (err) {
    console.error("[approval-notify] notifyDocCanceled 실패", docId, err);
  }
}

/** 최종 승인/반려를 기안자에게 알림. rejected 는 반려 사유를 포함한다. */
export async function notifyDrafterResult(docId: string, result: "approved" | "rejected"): Promise<void> {
  try {
    const doc = await loadDocHeader(docId);
    if (!doc || !doc.drafterUserId) return;
    const contacts = await resolveContacts([doc.drafterUserId]);
    let rejectNote = "";
    if (result === "rejected") {
      const db = await getDb();
      const rows = rowsToObjects(
        await db.exec(
          `SELECT assignee_name, comment FROM approval_steps WHERE doc_id = $1 AND status = 'rejected' ORDER BY acted_at DESC LIMIT 1`,
          [docId]
        )
      );
      if (rows.length) rejectNote = `\n반려자: ${rows[0].assignee_name ?? "-"}\n반려 사유: ${rows[0].comment ?? "-"}`;
    }
    const subject =
      result === "approved" ? `[전자결재] 승인 완료: ${doc.title}` : `[전자결재] 반려됨: ${doc.title}`;
    const head = result === "approved" ? "상신하신 문서가 최종 승인되었습니다." : "상신하신 문서가 반려되었습니다.";
    await deliver({
      event: result,
      docId,
      stepId: null,
      dedupKey: `${result}:${docId}`,
      userId: doc.drafterUserId,
      contact: contacts.get(doc.drafterUserId),
      subject,
      text: `${head}\n\n제목: ${doc.title}${rejectNote}${commonFooter(doc)}`,
      pushBody: doc.title,
    });
  } catch (err) {
    console.error("[approval-notify] notifyDrafterResult 실패", docId, err);
  }
}
