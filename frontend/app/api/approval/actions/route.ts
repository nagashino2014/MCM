import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { listActionRuns, rerunFormActions } from "@/lib/approval/actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?docId= : 문서별 액션 실행 로그(201) — 문서 상세·관리 화면 공용
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const docId = req.nextUrl.searchParams.get("docId") ?? "";
    if (!docId) return NextResponse.json({ error: "docId가 필요합니다." }, { status: 400 });
    const runs = await listActionRuns(docId);
    return NextResponse.json({ runs });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST {docId} : 실패 액션 재실행 — 관리자 전용(성공분은 멱등 skip)
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as { docId?: string };
    const docId = String(body.docId ?? "").trim();
    if (!docId) return NextResponse.json({ error: "docId가 필요합니다." }, { status: 400 });
    await rerunFormActions(docId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_action_rerun",
      targetTable: "approval_action_runs",
      targetId: docId,
    });
    return NextResponse.json({ runs: await listActionRuns(docId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
