/*
 * 할 일 주간 리포트(§29-3, 보강 7, 2026-10-19) — remind-tick 이 5분마다 호출하는 디스패처.
 *   대상: 활성 사용자 중 prefs.weekly_digest_time 이 켜져 있고(행 없으면 기본 월 08:40) 오늘 요일·시각이 도래했으며 오늘 아직 보내지 않은 사람.
 *   내용: 지난주 완료 N(주요 3건) · 이번 주 예정 N(기간·마일스톤 포함, 5건) · 지연 N(3건) · 맡긴 일(진행/지연) · 프로젝트 보드별 하위 진행율 평균.
 *   채널: 인앱 알림 todo.weekly + 푸시(dedup todo-weekly:<user>:<date>) + 사내 메일함 내부 배달(weekly_digest_mail=1, noreply@MAIL_DOMAIN,
 *   inbound 적재와 같은 구조 — SES 외부 발송 아님, rfc_message_id 로 멱등). 0건이면 미발송(아침 요약과 같은 규칙), 평가 기록은 남긴다.
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { sendPush } from "@/lib/notify/push-expo";
import { MAIL_DOMAIN, ensureMailbox, getSystemFolderId } from "@/lib/mail/mailbox";
import { cleanSnippet } from "@/lib/mail/mime";
import { recordTodoNotifications } from "./inbox";
import { TODO_DEFAULT_WEEKLY_DOW, TODO_DEFAULT_WEEKLY_TIME } from "./types";

const nowIso = () => new Date().toISOString();
const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000);
const kstToday = () => kstNow().toISOString().slice(0, 10);
const kstHhmm = () => {
  const d = kstNow();
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};
const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const mondayOf = (ymd: string): string => addDays(ymd, -((new Date(`${ymd}T12:00:00Z`).getUTCDay() + 6) % 7));
const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

export interface WeeklySummary {
  lastStart: string;
  lastEnd: string;
  thisStart: string;
  thisEnd: string;
  doneN: number;
  doneTitles: string[];
  planN: number;
  planItems: { title: string; when: string }[];
  overdueN: number;
  overdueTitles: string[];
  delegatedOpenN: number;
  delegatedLateN: number;
  boards: { name: string; project: string | null; avg: number }[];
}

/** 한 사용자의 주간 집계(상위 할 일 기준, 본인 담당·작성). */
export async function buildWeeklySummary(userId: string, today: string): Promise<WeeklySummary> {
  const db = await getDb();
  const thisStart = mondayOf(today);
  const thisEnd = addDays(thisStart, 6);
  const lastStart = addDays(thisStart, -7);
  const lastEnd = addDays(thisStart, -1);
  const mine = `(i.assignee_user_id = $1 OR i.owner_user_id = $1) AND i.parent_item_id IS NULL`;
  const cnt = rowsToObjects(
    await db.exec(
      `SELECT
         COUNT(*) FILTER (WHERE i.status = 'done' AND left(i.completed_at, 10) BETWEEN $2 AND $3)::int AS done_n,
         COUNT(*) FILTER (WHERE i.status <> 'done' AND i.archived_at IS NULL
                            AND ((i.do_date BETWEEN $4 AND $5) OR (i.do_date IS NULL AND i.due_date BETWEEN $4 AND $5)
                                 OR (i.do_date IS NOT NULL AND i.end_date IS NOT NULL AND i.do_date <= $5 AND i.end_date >= $4)))::int AS plan_n,
         COUNT(*) FILTER (WHERE i.status <> 'done' AND i.archived_at IS NULL AND COALESCE(i.do_date, i.due_date) < $4)::int AS overdue_n,
         COUNT(*) FILTER (WHERE i.status <> 'done' AND i.archived_at IS NULL AND i.owner_user_id = $1 AND i.assignee_user_id IS NOT NULL AND i.assignee_user_id <> $1)::int AS deleg_open_n,
         COUNT(*) FILTER (WHERE i.status <> 'done' AND i.archived_at IS NULL AND i.owner_user_id = $1 AND i.assignee_user_id IS NOT NULL AND i.assignee_user_id <> $1
                            AND COALESCE(i.do_date, i.due_date) < $4)::int AS deleg_late_n
       FROM todo_items i WHERE ${mine}`,
      [userId, lastStart, lastEnd, thisStart, thisEnd]
    )
  )[0];
  const doneTitles = rowsToObjects(
    await db.exec(`SELECT i.title FROM todo_items i WHERE ${mine} AND i.status = 'done' AND left(i.completed_at, 10) BETWEEN $2 AND $3 ORDER BY i.completed_at DESC LIMIT 3`, [userId, lastStart, lastEnd])
  ).map((r) => String(r.title));
  const planItems = rowsToObjects(
    await db.exec(
      `SELECT i.title, i.do_date, i.due_date, i.end_date FROM todo_items i
        WHERE ${mine} AND i.status <> 'done' AND i.archived_at IS NULL
          AND ((i.do_date BETWEEN $2 AND $3) OR (i.do_date IS NULL AND i.due_date BETWEEN $2 AND $3)
               OR (i.do_date IS NOT NULL AND i.end_date IS NOT NULL AND i.do_date <= $3 AND i.end_date >= $2))
        ORDER BY COALESCE(i.do_date, i.due_date), i.title LIMIT 5`,
      [userId, thisStart, thisEnd]
    )
  ).map((r) => {
    const d = r.do_date != null ? String(r.do_date) : r.due_date != null ? String(r.due_date) : "";
    const e = r.end_date != null ? String(r.end_date) : null;
    return { title: String(r.title), when: e && e > d ? `${md(d)}~${md(e)}` : r.do_date == null && r.due_date != null ? `마감 ${md(d)}` : md(d) };
  });
  const overdueTitles = rowsToObjects(
    await db.exec(`SELECT i.title FROM todo_items i WHERE ${mine} AND i.status <> 'done' AND i.archived_at IS NULL AND COALESCE(i.do_date, i.due_date) < $2 ORDER BY COALESCE(i.do_date, i.due_date) LIMIT 3`, [userId, thisStart])
  ).map((r) => String(r.title));
  const boards = rowsToObjects(
    await db.exec(
      `SELECT b.name, b.project_name, ROUND(AVG(CASE WHEN s.status = 'done' THEN 100 ELSE COALESCE(s.progress_pct, 0) END))::int AS avg
         FROM todo_items p
         JOIN todo_boards b ON b.board_id = p.board_id AND b.kind <> 'personal'
         JOIN todo_items s ON s.parent_item_id = p.item_id AND s.archived_at IS NULL
        WHERE p.parent_item_id IS NULL AND p.archived_at IS NULL AND p.status <> 'done' AND (p.assignee_user_id = $1 OR p.owner_user_id = $1)
        GROUP BY b.board_id, b.name, b.project_name ORDER BY b.name LIMIT 8`,
      [userId]
    )
  ).map((r) => ({ name: String(r.name), project: r.project_name != null ? String(r.project_name) : null, avg: Number(r.avg ?? 0) }));
  return {
    lastStart,
    lastEnd,
    thisStart,
    thisEnd,
    doneN: Number(cnt?.done_n ?? 0),
    doneTitles,
    planN: Number(cnt?.plan_n ?? 0),
    planItems,
    overdueN: Number(cnt?.overdue_n ?? 0),
    overdueTitles,
    delegatedOpenN: Number(cnt?.deleg_open_n ?? 0),
    delegatedLateN: Number(cnt?.deleg_late_n ?? 0),
    boards,
  };
}

export function weeklyOneLiner(s: WeeklySummary): string {
  const parts = [`지난주 완료 ${s.doneN}건`, `이번 주 예정 ${s.planN}건`];
  if (s.overdueN > 0) parts.push(`지연 ${s.overdueN}건`);
  if (s.delegatedOpenN > 0) parts.push(`맡긴 일 ${s.delegatedOpenN}건${s.delegatedLateN ? `(지연 ${s.delegatedLateN})` : ""}`);
  return parts.join(" · ");
}

export function weeklyMailHtml(s: WeeklySummary, name: string, origin: string): string {
  const li = (xs: string[]) => (xs.length ? `<ul style="margin:4px 0 0 18px;padding:0">${xs.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : "");
  const row = (label: string, value: string, extra = "") =>
    `<tr><td style="padding:6px 10px;color:#6b7280;white-space:nowrap;vertical-align:top">${label}</td><td style="padding:6px 10px">${value}${extra}</td></tr>`;
  const boards = s.boards.length
    ? `<table style="border-collapse:collapse;margin-top:4px">${s.boards.map((b) => `<tr><td style="padding:2px 8px 2px 0">${esc(b.name)}${b.project ? ` <span style="color:#9ca3af">${esc(b.project)}</span>` : ""}</td><td style="padding:2px 0"><b>${b.avg}%</b></td></tr>`).join("")}</table>`
    : "";
  return `<div style="font-family:'Malgun Gothic',Apple SD Gothic Neo,sans-serif;font-size:14px;color:#111827;line-height:1.5">
<p>${esc(name)}님, 이번 주 할 일 요약입니다 (${md(s.thisStart)} ~ ${md(s.thisEnd)}).</p>
<table style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;min-width:360px">
${row(`지난주 완료 (${md(s.lastStart)}~${md(s.lastEnd)})`, `<b>${s.doneN}건</b>`, li(s.doneTitles))}
${row("이번 주 예정", `<b>${s.planN}건</b>`, li(s.planItems.map((p) => `${p.title} — ${p.when}`)))}
${row("지연", `<b style="color:${s.overdueN ? "#b91c1c" : "#111827"}">${s.overdueN}건</b>`, li(s.overdueTitles))}
${row("맡긴 일", s.delegatedOpenN ? `진행 ${s.delegatedOpenN}건${s.delegatedLateN ? ` · <span style="color:#b91c1c">지연 ${s.delegatedLateN}건</span>` : ""}` : "없음")}
${s.boards.length ? row("프로젝트 진척(하위 평균)", boards) : ""}
</table>
<p style="margin-top:12px"><a href="${origin}/todo" style="color:#4a63d8">할 일 열기</a> · <a href="${origin}/todo?view=timeline" style="color:#4a63d8">타임라인</a></p>
<p style="color:#9ca3af;font-size:12px">이 메일은 매주 자동 발송됩니다. 할 일 설정에서 주간 요약을 끌 수 있습니다.</p>
</div>`;
}

/** 사내 메일함 내부 배달(noreply@MAIL_DOMAIN → 받은편지함). rfc_message_id 로 멱등. 메일함이 없으면(email_local 없음) 건너뛴다. */
async function deliverInternalMail(userId: string, name: string, subject: string, html: string, dedupId: string): Promise<boolean> {
  let mailbox: Awaited<ReturnType<typeof ensureMailbox>>;
  try {
    mailbox = await ensureMailbox(userId);
  } catch {
    return false;
  }
  const inboxFolderId = await getSystemFolderId(mailbox.mailboxId, "inbox");
  const rfcId = `<${dedupId}@${MAIL_DOMAIN}>`;
  const msgId = "mm-" + crypto.randomUUID().replace(/-/g, "").slice(0, 14);
  const now = nowIso();
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  let stored = false;
  await withDbWrite(async (db) => {
    const ins = rowsToObjects(
      await db.exec(
        `INSERT INTO mail_messages
           (message_id, mailbox_id, direction, rfc_message_id, thread_id, in_reply_to, references_json,
            from_addr, to_addrs, cc_addrs, bcc_addrs, reply_to, subject, snippet, body_text, body_html,
            raw_s3_key, size_bytes, has_attachments, ses_message_id, received_at, created_at)
         VALUES ($1,$2,'in',$3,$3,NULL,'[]'::jsonb,$4,$5::jsonb,'[]'::jsonb,'[]'::jsonb,NULL,$6,$7,$8,$9,NULL,NULL,0,NULL,$10,$10)
         ON CONFLICT (mailbox_id, rfc_message_id) DO NOTHING
         RETURNING message_id`,
        [msgId, mailbox.mailboxId, rfcId, `noreply@${MAIL_DOMAIN}`, JSON.stringify([{ address: mailbox.address, name }]), subject, cleanSnippet(text), text, html, now]
      )
    );
    if (!ins.length) return;
    await db.run(
      `INSERT INTO mail_message_state (message_id, folder_id, mailbox_id, is_read, created_at) VALUES ($1,$2,$3,0,$4) ON CONFLICT (message_id, folder_id) DO NOTHING`,
      [msgId, inboxFolderId, mailbox.mailboxId, now]
    );
    stored = true;
  });
  return stored;
}

export async function dispatchTodoWeekly(): Promise<{ weeklySent: number; weeklyEvaluated: number }> {
  const today = kstToday();
  const hhmm = kstHhmm();
  const dow = kstNow().getUTCDay();
  const db = await getDb();
  const users = rowsToObjects(
    await db.exec(
      `SELECT u.user_id, u.name,
              COALESCE(p.weekly_digest_mail, 1) AS mail_on
         FROM users u
         LEFT JOIN todo_user_prefs p ON p.user_id = u.user_id
        WHERE u.status = 'active'
          AND (CASE WHEN p.user_id IS NULL THEN $2 ELSE p.weekly_digest_time END) IS NOT NULL
          AND (CASE WHEN p.user_id IS NULL THEN $2 ELSE p.weekly_digest_time END) <= $3
          AND COALESCE(p.weekly_digest_dow, $4) = $4
          AND (p.weekly_sent_on IS NULL OR p.weekly_sent_on <> $1)`,
      [today, TODO_DEFAULT_WEEKLY_TIME, hhmm, dow]
    )
  );
  const origin = (process.env.NEXTAUTH_URL ?? process.env.APP_ORIGIN ?? "https://koensain.app").replace(/\/$/, "");
  let sent = 0;
  for (const u of users) {
    const userId = String(u.user_id);
    const name = String(u.name ?? "");
    try {
      const s = await buildWeeklySummary(userId, today);
      await withDbWrite(async (tx) => {
        await tx.run(
          `INSERT INTO todo_user_prefs (user_id, weekly_sent_on, updated_at) VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET weekly_sent_on = EXCLUDED.weekly_sent_on, updated_at = EXCLUDED.updated_at`,
          [userId, today, nowIso()]
        );
      });
      if (s.doneN + s.planN + s.overdueN + s.delegatedOpenN === 0) continue;
      const title = `이번 주 할 일 요약 ${md(s.thisStart)}~${md(s.thisEnd)}`;
      const body = weeklyOneLiner(s);
      await recordTodoNotifications([userId], { event: "todo.weekly", title, body, link: "/todo?view=timeline" });
      const res = await sendPush([userId], { event: "todo.weekly", title, body, link: "/todo", targetRef: `weekly:${today}`, dedupKey: `todo-weekly:${userId}:${today}` });
      if (Number(u.mail_on ?? 1) === 1) {
        await deliverInternalMail(userId, name, `[MCM] ${title}`, weeklyMailHtml(s, name, origin), `todo-weekly-${userId}-${s.thisStart}`).catch((e) => console.error("[todo-weekly] 메일 배달 실패", userId, e));
      }
      if (res.ok) sent += 1;
    } catch (e) {
      console.error("[todo-weekly] 발송 실패", userId, e);
    }
  }
  return { weeklySent: sent, weeklyEvaluated: users.length };
}
