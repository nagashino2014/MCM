import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { createRoundDraft, deleteRound, sendRound, syncRoundApproval } from "@/lib/payroll/rounds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** action: draft(기안 생성) | sync(결재 상태 동기화) | send(발송 — approved 게이트) | delete(라운드 삭제 — 서명 있으면 불가) */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roundId: string }> }
) {
  try {
    const ctx = await requireAdmin();
    const { roundId } = await params;
    const body = await req.json();
    const action = String(body.action ?? "");
    if (action === "draft") {
      const { docId } = await createRoundDraft(roundId, ctx.userId);
      return NextResponse.json({ docId, href: `/approval/draft?docId=${encodeURIComponent(docId)}` });
    }
    if (action === "sync") {
      return NextResponse.json({ status: await syncRoundApproval(roundId) });
    }
    if (action === "send") {
      const origin = new URL(req.url).origin;
      return NextResponse.json(await sendRound(roundId, ctx.userId, origin));
    }
    if (action === "delete") {
      return NextResponse.json(await deleteRound(roundId));
    }
    return NextResponse.json({ error: "알 수 없는 action 입니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
