import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { resolveFixedLine } from "@/lib/approval/fixed-line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 기안 화면용 고정 결재선(335) 해석 — 본인(기안자) 기준. body { formId, fieldValues }.
//   enforced=false 면 종전처럼 자유 지정, enforced=true 면 잠긴 결재선(steps)과 상신 불가 이유(errors).
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const body = (await req.json().catch(() => ({}))) as { formId?: string; fieldValues?: Record<string, unknown> };
    if (!body.formId) return NextResponse.json({ error: "formId 가 필요합니다." }, { status: 400 });
    const result = await resolveFixedLine({
      formId: body.formId,
      drafterUserId: ctx.userId,
      fieldValues: body.fieldValues && typeof body.fieldValues === "object" ? body.fieldValues : {},
    });
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
