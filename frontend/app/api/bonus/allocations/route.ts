import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasGlobalScope, hasPermission } from "@/lib/auth/rbac";
import { parsePeriod } from "@/lib/bonus/source";
import { getAllocationBoard, saveAllocations } from "@/lib/bonus/statements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 유관부서/인력 명세 보드(할당액·본부장 확정액·개별 배분). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("bonus.view", { fallbackRoles: ["editor"] });
    const p = parsePeriod(new URL(req.url).searchParams.get("period") ?? "");
    if (!p) return NextResponse.json({ error: "period 형식은 YYYY-H1/H2 입니다." }, { status: 400 });
    // 배분 보드는 전사 합계·전 부서 본부장 확정액·임원/영업지원 개인 배분을 담으므로
    // bonus.view 전사 범위 보유자에게만 내린다. 부서장(self_dept)은 board=null(화면은 "보드 없음" 분기) — 2026-10-19.
    if (!(await hasGlobalScope(ctx.userId, "bonus.view"))) {
      return NextResponse.json({ board: null, canEdit: false, scope: "dept" });
    }
    return NextResponse.json({ board: await getAllocationBoard(p), canEdit: await hasPermission(ctx.userId, "bonus.calculate"), scope: "all" });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 유관부서/임원 개별 배분 저장 — 할당액 초과 시 400(관리자 전용). */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requirePermission("bonus.calculate");
    const body = await req.json();
    const p = parsePeriod(String(body?.period ?? ""));
    if (!p) return NextResponse.json({ error: "period 형식은 YYYY-H1/H2 입니다." }, { status: 400 });
    const rows = (Array.isArray(body?.rows) ? body.rows : [])
      .map((r: Record<string, unknown>) => ({
        employeeId: String(r?.employeeId ?? ""),
        bucket: (r?.bucket === "support" ? "support" : "exec") as "support" | "exec",
        amount: Number(r?.amount ?? 0),
      }))
      .filter((r: { employeeId: string; amount: number }) => r.employeeId && Number.isFinite(r.amount) && r.amount >= 0);
    await saveAllocations(ctx.userId, p, rows);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 400) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
