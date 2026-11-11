import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { cancelCardAuditRequest, createCardAuditRequests, loadCardEvidence, type AuditRequestItem } from "@/lib/finance/card-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const errorResponse = (e: unknown) =>
  NextResponse.json({ error: (e as Error).message }, { status: Number((e as { status?: number }).status) || 400 });

// GET: ?from=&to= — 증빙 없는 카드 건과 누락 내역 분석(출장 후보·확신도·근거·기본 소명 대상).
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const from = req.nextUrl.searchParams.get("from") ?? "";
    const to = req.nextUrl.searchParams.get("to") ?? "";
    if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
      return NextResponse.json({ error: "조회 기간(시작일·종료일)을 확인하세요." }, { status: 400 });
    }
    return NextResponse.json(await loadCardEvidence({ from, to }));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 소명 요청 발송 — { items: [{ cardTxnId, deptId, tripDocId? }], note? }. 관리자가 고른 건·대상만 보낸다.
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("finance.manage");
    const body = (await req.json().catch(() => ({}))) as { items?: unknown; note?: unknown };
    const items: AuditRequestItem[] = (Array.isArray(body.items) ? body.items : [])
      .map((raw) => {
        const o = (raw ?? {}) as Record<string, unknown>;
        return { cardTxnId: String(o.cardTxnId ?? "").trim(), deptId: String(o.deptId ?? "").trim(), tripDocId: o.tripDocId ? String(o.tripDocId) : null };
      })
      .filter((x) => x.cardTxnId && x.deptId)
      .slice(0, 200);
    try {
      const note = String(body.note ?? "").trim().slice(0, 500) || null;
      return NextResponse.json({ ok: true, ...(await createCardAuditRequests({ items, note, requestedBy: actor.userId })) });
    } catch (e) {
      return errorResponse(e);
    }
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: ?requestId= — 열린 소명 요청 취소.
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("finance.manage");
    const requestId = req.nextUrl.searchParams.get("requestId") ?? "";
    if (!requestId) return NextResponse.json({ error: "requestId가 필요합니다." }, { status: 400 });
    try {
      await cancelCardAuditRequest(requestId, actor.userId);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  } catch (err) {
    return authErrorToResponse(err);
  }
}
