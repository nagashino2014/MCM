import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { deleteBudget, evaluateBudgets, isValidScope, listBudgetAlerts, listBudgetStatuses, upsertBudget, type BudgetAction } from "@/lib/ai/budget";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function userNames(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT u.user_id, COALESCE(e.name, u.email, u.user_id) AS name
         FROM users u LEFT JOIN employee_profiles e ON e.user_id = u.user_id
        WHERE u.user_id = ANY($1::text[])`,
      [ids]
    )
  );
  return Object.fromEntries(rows.map((r) => [String(r.user_id), String(r.name)]));
}

// GET /api/admin/ai-usage/budgets — 예산 목록(당월 상태 포함) + 알림 이력
export async function GET() {
  try {
    await requirePermission("ai.usage.view");
    const [budgets, alerts] = await Promise.all([listBudgetStatuses(), listBudgetAlerts(50)]);
    const names = await userNames([...new Set(budgets.flatMap((b) => b.recipients))]);
    return NextResponse.json({ budgets, alerts, userNames: names });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT /api/admin/ai-usage/budgets — upsert. body: { budgetId?, scope, label?, monthlyLimitUsd, warnPcts[], action, recipients[], enabled }
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("ai.usage.manage");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const scope = String(body.scope ?? "").trim();
    if (!isValidScope(scope)) return NextResponse.json({ error: "예산 범위(scope)가 올바르지 않습니다." }, { status: 400 });
    const limit = Number(body.monthlyLimitUsd);
    // numeric(12,2) 컬럼 — $0.01 미만은 0 으로 저장돼 "미설정" 이 되므로 막는다.
    if (!Number.isFinite(limit) || limit < 0.01) return NextResponse.json({ error: "월 한도는 $0.01 이상이어야 합니다." }, { status: 400 });
    const warnPcts = (Array.isArray(body.warnPcts) ? body.warnPcts : [50, 80, 100])
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0 && n <= 1000);
    if (!warnPcts.length) return NextResponse.json({ error: "경고 임계(%)를 1개 이상 입력하세요." }, { status: 400 });
    const action = String(body.action ?? "notify") as BudgetAction;
    if (!["notify", "block_noncritical", "block_all"].includes(action)) return NextResponse.json({ error: "초과 시 정책 값이 올바르지 않습니다." }, { status: 400 });
    const recipients = (Array.isArray(body.recipients) ? body.recipients : []).map(String).filter(Boolean);

    const existing = await listBudgetStatuses();
    const before = existing.find((b) => b.budgetId === String(body.budgetId ?? "")) ?? null;
    // 예산 카드는 최대 3개(전체 + 2) — 화면의 3열 카드 레이아웃과 맞춘다.
    if (!before && existing.length >= 3) return NextResponse.json({ error: "예산은 최대 3개까지 둘 수 있습니다. 기존 예산을 삭제하거나 수정하세요." }, { status: 400 });
    const saved = await upsertBudget({
      budgetId: body.budgetId != null ? String(body.budgetId) : null,
      scope,
      label: body.label != null ? String(body.label) : null,
      monthlyLimitUsd: limit,
      warnPcts,
      action,
      recipients,
      enabled: body.enabled !== false,
    });
    await recordAuditLog({ actorUserId: actor.userId, action: "ai_settings_change", targetTable: "ai_budgets", targetId: saved.budgetId, before, after: saved });
    // 저장 직후 1회 평가 — 한도를 낮췄으면 임계 알림이 바로 나간다.
    void evaluateBudgets({ trigger: "call" }).catch(() => {});
    return NextResponse.json({ ok: true, budget: saved });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE /api/admin/ai-usage/budgets?id=<budgetId>
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("ai.usage.manage");
    const id = String(req.nextUrl.searchParams.get("id") ?? "").trim();
    if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
    await deleteBudget(id);
    await recordAuditLog({ actorUserId: actor.userId, action: "ai_settings_change", targetTable: "ai_budgets", targetId: id, before: { budgetId: id }, after: null });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && /삭제할 수 없습니다/.test(err.message)) return NextResponse.json({ error: err.message }, { status: 400 });
    return authErrorToResponse(err);
  }
}
