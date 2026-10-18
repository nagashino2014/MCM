/*
 * 할 일 → 업무 보고 초안(§25-3, 2026-10-18 사용자 확정 B·C·F).
 *   관련이 계약(contract) 또는 업무추진계획 Task(work_task)인 할 일에서 saveReport(status draft) 를 만든다.
 *   - 기간: 그 대상의 마지막 제출 보고 다음 날 ~ 오늘(없으면 이번 주 월~금). 보고일 오늘.
 *   - stages: 공정 단계가 매핑된 하위 작업만 → 같은 단계는 최대 %, 100→done, 0<→in_progress, 0→pending.
 *   - progressText/planText: 규칙 직렬화(StructuredNote 포맷) → Haiku 가 핵심만 추려 다듬는다(실패·키 없음이면 규칙 직안).
 *   - 같은 할 일에서 만든 미제출 초안이 있으면(활동 work_report 의 reportId) 그 초안을 갱신한다.
 *   제출은 사용자가 /work-plan/[reportId] 에서 검토 후 직접 한다(자동 제출 없음).
 */
import crypto from "node:crypto";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { claudeMessages } from "@/lib/ai/claude-client";
import { saveReport, type ReportStageInput } from "@/lib/work-plan/workspace";
import { getItemDetail } from "./store";
import type { TodoItem, TodoItemDetail } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const kstToday = (): string => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (ymd: string, n: number): string => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const md = (ymd: string | null): string => (ymd ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}` : "");

export interface WorkReportDraftResult {
  reportId: string;
  href: string;
  /** 기존 초안을 갱신했는지 */
  updated: boolean;
  /** Haiku 다듬기 적용 여부(false = 규칙 직안) */
  aiUsed: boolean;
  periodStart: string;
  periodEnd: string;
}

/** 할 일이 보고할 수 있는 대상인지 — subject 와 id. */
function subjectOf(detail: TodoItemDetail): { kind: "contract" | "task"; id: string } | null {
  if (!detail.reportSubject || !detail.linkId) return null;
  return { kind: detail.reportSubject, id: detail.linkId };
}

/** 기간 기본값(§25 결정 C) — 마지막 제출 보고 다음 날 ~ 오늘, 없으면 이번 주 월~금. */
async function defaultPeriod(kind: "contract" | "task", id: string): Promise<{ start: string; end: string }> {
  const db = await getDb();
  const col = kind === "task" ? "task_id" : "contract_id";
  const rows = rowsToObjects(
    await db.exec(
      `SELECT period_end FROM work_plan_reports WHERE ${col} = $1 AND status = 'submitted' ORDER BY period_end DESC, created_at DESC LIMIT 1`,
      [id]
    )
  );
  const today = kstToday();
  const last = rows.length && DATE_RE.test(String(rows[0].period_end ?? "")) ? String(rows[0].period_end) : null;
  if (last && last < today) return { start: addDays(last, 1), end: today };
  // 이번 주 월~금(KST). 일요일이면 지난 월요일.
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0=일
  const monday = addDays(today, dow === 0 ? -6 : 1 - dow);
  return { start: monday, end: addDays(monday, 4) };
}

/** 이 할 일이 전에 만든 미제출 초안 — 활동 로그 work_report 의 reportId 중 아직 draft 인 것. */
async function existingDraft(detail: TodoItemDetail, kind: "contract" | "task", id: string): Promise<string | null> {
  const ids = detail.activity
    .filter((a) => a.action === "work_report")
    .map((a) => (a.detail as { reportId?: unknown })?.reportId)
    .filter((v): v is string => typeof v === "string" && !!v);
  if (!ids.length) return null;
  const db = await getDb();
  const col = kind === "task" ? "task_id" : "contract_id";
  const rows = rowsToObjects(
    await db.exec(
      `SELECT report_id FROM work_plan_reports WHERE report_id = ANY($1::text[]) AND ${col} = $2 AND status = 'draft' ORDER BY created_at DESC LIMIT 1`,
      [ids, id]
    )
  );
  return rows.length ? String(rows[0].report_id) : null;
}

/** 하위 작업 → 공정 단계 델타(같은 단계는 최대 %). */
function stageDelta(detail: TodoItemDetail): ReportStageInput[] {
  const byOrder = new Map<number, number>();
  for (const s of detail.subtasks) {
    if (s.stageOrder == null) continue;
    const pct = s.status === "done" ? 100 : s.progressPct ?? 0;
    byOrder.set(s.stageOrder, Math.max(byOrder.get(s.stageOrder) ?? 0, pct));
  }
  const out: ReportStageInput[] = [];
  for (const st of detail.stages) {
    const pct = byOrder.get(st.stageOrder);
    if (pct == null) continue;
    out.push({
      stageOrder: st.stageOrder,
      stageName: st.stageName,
      status: pct >= 100 ? "done" : pct > 0 ? "in_progress" : "pending",
      progressPct: pct,
      actualDate: pct >= 100 ? kstToday() : null,
    });
  }
  return out;
}

/** 할 일 내용을 StructuredNote 포맷(소제목 `[..]`, 글머리 `①`/`-`)으로 직렬화 — AI 폴백이자 AI 입력 재료. */
export function serializeDraft(detail: TodoItemDetail, today = kstToday()): { progressText: string; planText: string } {
  const circled = (n: number) => (n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `${n}.`);
  const stageName = (s: TodoItem) => detail.stages.find((st) => st.stageOrder === s.stageOrder)?.stageName ?? null;
  const progress: string[] = [`[${detail.title}]`];
  const active = detail.subtasks.filter((s) => s.status === "done" || (s.progressPct ?? 0) > 0 || (s.progressNote ?? "").trim());
  active.forEach((s, i) => {
    const pct = s.status === "done" ? 100 : s.progressPct ?? 0;
    const parts = [`${s.title} — ${pct}%`];
    const sn = stageName(s);
    if (sn) parts.push(sn);
    if (s.progressNote?.trim()) parts.push(s.progressNote.trim());
    progress.push(`${circled(i + 1)} ${parts.join(" · ")}`);
  });
  if (!active.length && detail.progressAvg == null) progress.push("- 진행 내용 없음");
  const note = (detail.note ?? "").trim();
  if (note) {
    progress.push("[메모]");
    for (const line of note.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 30)) progress.push(line.startsWith("-") ? line : `- ${line}`);
  }
  const open = detail.subtasks.filter((s) => s.status !== "done");
  const plan: string[] = [];
  if (open.length) {
    plan.push("[다음 기간]");
    for (const s of open) {
      const when = s.doDate ?? s.dueDate;
      plan.push(`- ${s.title}${when ? `(${when < today ? "지연 " : ""}${md(when)})` : ""}`);
    }
  } else if (detail.status !== "done") {
    plan.push("[다음 기간]", `- ${detail.title} 마무리${detail.dueDate ? `(마감 ${md(detail.dueDate)})` : ""}`);
  }
  return { progressText: progress.join("\n"), planText: plan.join("\n") };
}

/** Haiku 로 핵심만 추려 StructuredNote 포맷으로 다듬는다(결정 F). 실패·키 없음이면 null. */
async function polishWithAi(
  userId: string,
  detail: TodoItemDetail,
  raw: { progressText: string; planText: string },
  period: { start: string; end: string }
): Promise<{ progressText: string; planText: string } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const comments = detail.comments.slice(-5).map((c) => `- ${c.userName ?? "동료"}: ${c.body.replace(/\s+/g, " ").slice(0, 160)}`);
  const system =
    "당신은 회사 업무 보고 초안을 다듬는 도우미입니다. 아래 '재료'에 있는 사실만 사용하고 없는 내용을 지어내지 마세요. " +
    "출력은 반드시 두 블록으로만 구성합니다:\n" +
    "<<이번 기간>>\n(StructuredNote 포맷: 소제목은 [텍스트] 한 줄, 항목은 '① 텍스트' 처럼 원문자 번호 + 공백, 부연은 '- 텍스트')\n" +
    "<<다음 기간>>\n(같은 포맷, 항목은 '- 텍스트')\n" +
    "규칙: 항목당 한 줄, 명사형 종결(…완료/…진행/…예정), 공백 포함 60자 이내, 진행율(%)과 공정 단계명은 유지, 전체 12줄 이내. 인사말·설명문 금지.";
  const user =
    `보고 기간: ${period.start} ~ ${period.end}\n대상: ${detail.projectName ?? detail.linkLabel ?? ""}${detail.clientName ? ` / ${detail.clientName}` : ""}\n\n` +
    `[재료 — 이번 기간 추진내역(규칙 직안)]\n${raw.progressText}\n\n[재료 — 다음 기간 계획(규칙 직안)]\n${raw.planText || "(없음)"}\n\n` +
    (comments.length ? `[참고 — 최근 댓글]\n${comments.join("\n")}\n` : "");
  try {
    const r = await claudeMessages({
      feature: "todo.work_report_draft",
      max_tokens: 800,
      system,
      messages: [{ role: "user", content: user }],
      timeoutMs: 20000,
      userId,
      subject: { type: "todo_item", id: detail.itemId },
    });
    if (!r.ok || !r.text) return null;
    const text = r.text.replace(/\r/g, "");
    const m = /<<이번 기간>>\s*([\s\S]*?)\s*<<다음 기간>>\s*([\s\S]*)$/.exec(text);
    if (!m) return null;
    const clean = (s: string) =>
      s
        .split("\n")
        .map((l) => l.replace(/^\s*[•*]\s*/, "- ").trimEnd())
        .filter((l) => l.trim())
        .join("\n")
        .trim();
    const progressText = clean(m[1]);
    const planText = clean(m[2]);
    if (!progressText) return null;
    return { progressText, planText: planText || raw.planText };
  } catch (e) {
    console.warn("[todo] 업무 보고 초안 AI 다듬기 실패 — 규칙 직안 사용", (e as Error).message);
    return null;
  }
}

/** 초안 생성(또는 기존 초안 갱신). 권한(work_plan.edit)은 라우트에서 검사한다. */
export async function createWorkReportDraft(userId: string, itemId: string, opts?: { ai?: boolean }): Promise<WorkReportDraftResult> {
  const detail = await getItemDetail(userId, itemId);
  const subject = subjectOf(detail);
  if (!subject) {
    const err = new Error("관련 항목이 계약(용역) 또는 업무추진계획(Task)일 때만 업무 보고를 만들 수 있습니다.") as Error & { status?: number };
    err.status = 400;
    throw err;
  }
  const period = await defaultPeriod(subject.kind, subject.id);
  const raw = serializeDraft(detail);
  const polished = opts?.ai === false ? null : await polishWithAi(userId, detail, raw, period);
  const text = polished ?? raw;
  const stages = stageDelta(detail);
  const top = stages.reduce<ReportStageInput | null>((acc, s) => (acc == null || (s.progressPct ?? 0) >= (acc.progressPct ?? 0) ? s : acc), null);
  const prior = await existingDraft(detail, subject.kind, subject.id);
  const reportId = await saveReport(userId, {
    reportId: prior ?? undefined,
    subjectKind: subject.kind,
    subjectId: subject.id,
    periodStart: period.start,
    periodEnd: period.end,
    reportDate: kstToday(),
    status: "draft",
    progressText: text.progressText,
    planText: text.planText,
    currentStageName: top?.stageName ?? null,
    currentStagePct: top?.progressPct ?? null,
    stages,
  });
  await withDbWrite(async (db) => {
    await db.run(
      `INSERT INTO todo_activity (activity_id, item_id, user_id, action, detail, created_at) VALUES ($1, $2, $3, 'work_report', $4::jsonb, $5)`,
      ["ta" + crypto.randomUUID().replace(/-/g, "").slice(0, 16), itemId, userId, JSON.stringify({ reportId, updated: !!prior, ai: !!polished, period }), new Date().toISOString()]
    );
  });
  return { reportId, href: `/work-plan/${encodeURIComponent(reportId)}`, updated: !!prior, aiUsed: !!polished, periodStart: period.start, periodEnd: period.end };
}
