import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDoc } from "@/lib/approval/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 문서 상세 — 제출 당시 양식 버전 fields + 결재선 진행 상태 포함
export async function GET(_req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const ctx = await requirePermission("approval.view");
    const { docId } = await params;
    const doc = await getDoc(docId);
    if (!doc) return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
    // 접근 범위: 기안자·결재선 관계자·admin (참조/열람은 E-P3 watchers 에서 확장)
    const involved =
      doc.drafterUserId === ctx.userId || doc.steps.some((s) => s.assigneeUserId === ctx.userId || s.delegatedFrom === ctx.userId);
    if (!involved && ctx.role !== "admin") {
      return NextResponse.json({ error: "이 문서를 열람할 권한이 없습니다." }, { status: 403 });
    }
    return NextResponse.json({ doc });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
