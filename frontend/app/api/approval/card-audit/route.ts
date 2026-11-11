import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { answerCardAuditRequest, listMyCardAuditRequests } from "@/lib/finance/card-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 내가 받은 법인카드 소명 요청(본인 요청 건의 사용일·가맹점·금액만).
export async function GET() {
  try {
    const actor = await requirePermission("approval.view");
    return NextResponse.json({ requests: await listMyCardAuditRequests(actor.userId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PATCH: 회신 — { requestId, answer }. 받은 사람 본인만.
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.view");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const requestId = String(body.requestId ?? "").trim();
    if (!requestId) return NextResponse.json({ error: "requestId가 필요합니다." }, { status: 400 });
    try {
      await answerCardAuditRequest({ requestId, userId: actor.userId, answer: String(body.answer ?? "") });
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: Number((e as { status?: number }).status) || 400 });
    }
  } catch (err) {
    return authErrorToResponse(err);
  }
}
