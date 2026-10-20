import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { lookupAbsences } from "@/lib/approval/absence-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?userIds=a,b — 결재선 결재자들의 부재(진행 중·30일 내 예정) 조회. 기안 화면 배지용(DA-2), 사유는 제외.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const userIds = (req.nextUrl.searchParams.get("userIds") ?? "").split(",").filter(Boolean);
    return NextResponse.json({ absences: await lookupAbsences(userIds) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
