import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasGlobalScope } from "@/lib/auth/rbac";
import { listBonusMilestones, parsePeriod } from "@/lib/bonus/source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    // 산정 원천(전사 계약·평점·마일스톤·기간)은 bonus.view 를 전사 범위로 가진 사용자만 — 부서장(self_dept)은 403(2026-10-19).
    const ctx = await requirePermission("bonus.view", { fallbackRoles: ["editor"] });
    if (!(await hasGlobalScope(ctx.userId, "bonus.view"))) {
      return NextResponse.json({ error: "이 작업을 수행할 권한이 없습니다." }, { status: 403 });
    }
    const sp = new URL(req.url).searchParams;
    const contractId = sp.get("contractId") ?? "";
    const p = parsePeriod(sp.get("period") ?? "");
    if (!contractId) return NextResponse.json({ error: "contractId 가 필요합니다." }, { status: 400 });
    if (!p) return NextResponse.json({ error: "period 형식은 YYYY-H1/H2 입니다." }, { status: 400 });
    return NextResponse.json({ milestones: await listBonusMilestones(contractId, p) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
