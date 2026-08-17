import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { deleteBudgetLine, listBudgets, saveBudgetLine } from "@/lib/finance/budget";
import { loadCategories } from "@/lib/barobill/classify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 연도 예산 + 집행 현황 (+ 등록 가능한 카테고리 목록)
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const year = Number(req.nextUrl.searchParams.get("year") ?? 0) || new Date().getFullYear();
    const [budgets, categories] = await Promise.all([listBudgets(year), loadCategories()]);
    return NextResponse.json({
      year,
      budgets,
      categories: categories.map((c) => ({ key: c.categoryKey, label: c.label })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  action?: "save" | "delete";
  year?: number;
  categoryKey?: string;
  amount?: number;
  memo?: string | null;
  budgetId?: string;
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission("finance.manage");
    const body = (await req.json().catch(() => ({}))) as PostBody;
    if (body.action === "save") {
      if (!body.year || !body.categoryKey || !(Number(body.amount) >= 0)) {
        return NextResponse.json({ error: "연도·계정과목·금액이 필요합니다." }, { status: 400 });
      }
      const budgetId = await saveBudgetLine({
        year: Number(body.year),
        categoryKey: String(body.categoryKey),
        amount: Number(body.amount),
        memo: body.memo,
      });
      return NextResponse.json({ budgetId });
    }
    if (body.action === "delete") {
      if (!body.budgetId) return NextResponse.json({ error: "budgetId 가 필요합니다." }, { status: 400 });
      await deleteBudgetLine(body.budgetId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "action 이 올바르지 않습니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
