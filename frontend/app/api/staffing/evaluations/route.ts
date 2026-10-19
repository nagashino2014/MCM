import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listEvaluationBoard, saveEvaluations, type EvaluationInput } from "@/lib/staffing/evaluations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const deptId = sp.get("dept") ?? "";
    const year = Number(sp.get("year") ?? new Date().getFullYear());
    const half = sp.get("half") === "H2" ? "H2" : "H1";
    // 요청한 부서를 target 으로 넘겨 self_dept grant(부서장)가 타 부서를 보지 못하게 한다(X-01, 2026-10-19).
    await requirePermission("staffing.evaluation.read", { target: deptId ? { deptId } : undefined, fallbackRoles: ["editor"] });
    if (!deptId) return NextResponse.json({ rows: [] });
    return NextResponse.json({ rows: await listEvaluationBoard(deptId, year, half) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("staffing.evaluation.write", { fallbackRoles: ["editor"] });
    const body = (await req.json()) as { year: number; half: string; rows: EvaluationInput[] };
    const year = Number(body.year);
    const half = body.half === "H2" ? "H2" : "H1";
    await saveEvaluations(actor.userId, year, half, Array.isArray(body.rows) ? body.rows : []);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
