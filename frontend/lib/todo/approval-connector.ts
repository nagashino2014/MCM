/*
 * 결재 승인 → 후속 할 일 자동 생성 커넥터(docs/todo-kanban-blueprint.md §11·§13-3, 2026-10-13 확정).
 *   출장신청서 승인 → "출장보고서 작성", 교육신청서 승인 → "교육결과 보고"처럼 기안자의 개인 보드에 할 일 1건을 만든다.
 *   배선은 approval_form_actions(275 시드) — 양식 빌더에서 켜고 끌 수 있다.
 * 멱등: 같은 문서(link_kind='approval_doc', link_id=docId)로 만든 미보관 작업이 있으면 건너뛴다.
 * ⚠ docs.ts 를 import 하지 말 것(순환) — 문서 정보는 ctx 로 받는다.
 */
import { getDb, rowsToObjects } from "@/lib/db";
import type { ActionConnector, ActionRunContext } from "@/lib/approval/actions";
import { TRIP_FORM_ID, extractTripDestination } from "@/lib/approval/trip";
import { createItem, ensureDefaultBoard } from "@/lib/todo/store";
import type { TodoPriority } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface FollowupPlan {
  title: string;
  doDate: string | null;
  dueDate: string | null;
  priority: TodoPriority;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function intConfig(ctx: ActionRunContext, key: string, fallback: number): number {
  const v = Number(ctx.config[key]);
  return Number.isFinite(v) ? Math.trunc(v) : fallback;
}

/** 슬롯·문서에서 제목 보조 텍스트(출장지·교육명)를 뽑는다. */
function resolveSubject(ctx: ActionRunContext): string {
  const raw = ctx.slot("subject");
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const name = (raw as { name?: unknown }).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  if (ctx.formId === TRIP_FORM_ID) return extractTripDestination(ctx.fieldValues) ?? "";
  return "";
}

function planFollowup(ctx: ActionRunContext): FollowupPlan {
  const period = (ctx.slot("period") ?? {}) as { from?: unknown; to?: unknown };
  const from = String(period.from ?? "").slice(0, 10);
  const to = String(period.to ?? "").slice(0, 10);
  const end = DATE_RE.test(to) ? to : DATE_RE.test(from) ? from : null;
  const subject = resolveSubject(ctx);
  const template = String(ctx.config.title ?? "{{docTitle}} 후속 처리").trim() || "{{docTitle}} 후속 처리";
  let title = template
    .replace(/\{\{\s*subject\s*\}\}/g, subject)
    .replace(/\{\{\s*docTitle\s*\}\}/g, ctx.title)
    .replace(/\{\{\s*docNo\s*\}\}/g, ctx.docNo ?? "")
    .replace(/\s+—\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!title) title = `${ctx.title} 후속 처리`;
  const priorityRaw = intConfig(ctx, "priority", 2);
  const priority = (priorityRaw >= 0 && priorityRaw <= 3 ? priorityRaw : 2) as TodoPriority;
  return {
    title: title.slice(0, 200),
    doDate: end ? addDays(end, intConfig(ctx, "doOffsetDays", 1)) : null,
    dueDate: end ? addDays(end, intConfig(ctx, "dueOffsetDays", 3)) : null,
    priority,
  };
}

async function existingFollowup(docId: string, ownerUserId: string): Promise<string | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT item_id FROM todo_items
        WHERE link_kind = 'approval_doc' AND link_id = $1 AND owner_user_id = $2 AND archived_at IS NULL
        LIMIT 1`,
      [docId, ownerUserId]
    )
  );
  return rows.length ? String(rows[0].item_id) : null;
}

export const todoFollowupConnector: ActionConnector = {
  kind: "todo.create_followup",
  label: "후속 할 일 생성",
  description:
    "승인되면 기안자의 할 일(개인 보드)에 후속 작업을 만듭니다. 예: 출장 승인 → 출장보고서 작성(종료일+3일 마감). 제목·기한 간격은 config 로 조정합니다.",
  slots: [
    { key: "period", label: "기간(종료일 기준)", hint: "{from,to} 기간 필드 — 할 날·마감 계산의 기준" },
    { key: "subject", label: "제목 보조 텍스트", hint: "출장지·교육명 등. 제목 템플릿의 {{subject}} 에 들어갑니다" },
  ],
  async preview(ctx) {
    if (!ctx.drafterUserId) return "기안자 계정 정보가 없어 실행이 실패합니다.";
    const plan = planFollowup(ctx);
    const when = plan.dueDate ? `마감 ${plan.dueDate}` : "기간 미해석 — 날짜 없는 할 일";
    return `${ctx.drafterName ?? "기안자"}의 할 일에 "${plan.title}"(${when})이 생성됩니다. 이미 생성된 문서는 건너뜁니다.`;
  },
  async run(ctx) {
    const userId = ctx.drafterUserId;
    if (!userId) throw new Error("기안자 계정 정보가 없습니다.");
    const existing = await existingFollowup(ctx.docId, userId);
    if (existing) return { detail: "이미 생성됨 — 건너뜀", result: { itemId: existing } };
    const plan = planFollowup(ctx);
    await ensureDefaultBoard(userId);
    const item = await createItem(userId, {
      title: plan.title,
      priority: plan.priority,
      doDate: plan.doDate,
      dueDate: plan.dueDate,
      linkKind: "approval_doc",
      linkId: ctx.docId,
      linkLabel: ctx.docNo ? `${ctx.title} (${ctx.docNo})` : ctx.title,
    });
    return {
      detail: `할 일 생성: ${plan.title}${plan.dueDate ? ` (마감 ${plan.dueDate})` : ""}`,
      result: { itemId: item.itemId },
    };
  },
};
