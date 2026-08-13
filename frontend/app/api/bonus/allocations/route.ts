import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin, requirePermission } from "@/lib/auth/guards";
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
    return NextResponse.json({ board: await getAllocationBoard(p), canEdit: ctx.role === "admin" });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 유관부서/임원 개별 배분 저장 — 할당액 초과 시 400(관리자 전용). */
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requireAdmin();
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
