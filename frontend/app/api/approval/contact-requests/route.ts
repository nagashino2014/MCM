import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import {
  cancelContactRequest,
  createContactRequest,
  getContactRequestDetail,
  listMyContactRequests,
  respondContactRequest,
} from "@/lib/approval/unlisted-companies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const errorResponse = (e: unknown) =>
  NextResponse.json({ error: (e as Error).message }, { status: Number((e as { status?: number }).status) || 400 });

// GET: ?id= → 요청 한 건(받은 사람 본인 또는 운영자) / 그 외 → 내가 받은 열린 요청
export async function GET(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.view");
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ requests: await listMyContactRequests(actor.userId) });
    const detail = await getContactRequestDetail(id);
    if (!detail) return NextResponse.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });
    if (detail.request.requestedTo !== actor.userId) {
      // 본인 요청이 아니면 운영자만 볼 수 있다
      await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    }
    return NextResponse.json(detail);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 요청 생성(운영자) — { docId, note? }. 기안자에게 할 일과 푸시가 간다.
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const docId = String(body.docId ?? "").trim();
    if (!docId) return NextResponse.json({ error: "요청할 문서가 필요합니다." }, { status: 400 });
    try {
      const note = String(body.note ?? "").trim().slice(0, 500) || null;
      return NextResponse.json(await createContactRequest({ docId, note, requestedBy: actor.userId }));
    } catch (e) {
      return errorResponse(e);
    }
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PATCH: 회신(받은 사람 본인) — { requestId, response: { company?, people[] } }
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.view");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const requestId = String(body.requestId ?? "").trim();
    if (!requestId) return NextResponse.json({ error: "requestId가 필요합니다." }, { status: 400 });
    try {
      return NextResponse.json({ request: await respondContactRequest({ requestId, userId: actor.userId, response: body.response }) });
    } catch (e) {
      return errorResponse(e);
    }
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: ?requestId= — 열린 요청 취소(운영자)
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const requestId = req.nextUrl.searchParams.get("requestId") ?? "";
    if (!requestId) return NextResponse.json({ error: "requestId가 필요합니다." }, { status: 400 });
    try {
      await cancelContactRequest(requestId, actor.userId);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  } catch (err) {
    return authErrorToResponse(err);
  }
}
