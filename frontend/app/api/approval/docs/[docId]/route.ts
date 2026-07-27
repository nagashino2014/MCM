import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDoc, getUserDeptId, markWatcherRead } from "@/lib/approval/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 문서 상세 — 제출 당시 양식 버전 fields + 결재선 진행 상태 포함
export async function GET(_req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const ctx = await requirePermission("approval.view");
    const { docId } = await params;
    const doc = await getDoc(docId);
    if (!doc) return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
    // 접근 범위: 기안자·결재선 관계자·admin + 문서함 공개 범위 —
    // 전사 문서함 지정 양식의 승인 문서는 전 직원, 완료 문서는 같은 부서까지 열람 허용.
    const involved =
      doc.drafterUserId === ctx.userId || doc.steps.some((s) => s.assigneeUserId === ctx.userId || s.delegatedFrom === ctx.userId);
    const isWatcher = doc.watchers.some((w) => w.userId === ctx.userId);
    let allowed = involved || isWatcher || ctx.role === "admin";
    if (!allowed && doc.status === "approved" && doc.orgFolder) allowed = true;
    if (!allowed && ["approved", "rejected"].includes(doc.status) && doc.deptId) {
      const myDept = await getUserDeptId(ctx.userId);
      if (myDept && myDept === doc.deptId) allowed = true;
    }
    if (!allowed) {
      return NextResponse.json({ error: "이 문서를 열람할 권한이 없습니다." }, { status: 403 });
    }
    if (isWatcher) await markWatcherRead(docId, ctx.userId);
    const myStep = doc.steps.find((s) => s.assigneeUserId === ctx.userId && s.status === "pending");
    return NextResponse.json({ doc: { ...doc, myStepId: myStep?.stepId ?? null } });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
