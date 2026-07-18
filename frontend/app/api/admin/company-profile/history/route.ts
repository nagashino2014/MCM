import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { addHistory, deleteHistory, listHistory, updateHistory } from "@/lib/company/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 연혁 추가 { eventYm: 'YYYY-MM', content }
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("org.edit", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as { eventYm?: string; content?: string };
    const item = await addHistory(String(body.eventYm ?? ""), String(body.content ?? ""));
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "company_profile_update",
      targetTable: "company_history",
      targetId: item.historyId,
      after: { eventYm: item.eventYm },
    });
    return NextResponse.json({ item, history: await listHistory() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 연혁 수정 { historyId, eventYm, content }
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("org.edit", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as { historyId?: string; eventYm?: string; content?: string };
    const historyId = String(body.historyId ?? "");
    if (!historyId) return NextResponse.json({ error: "historyId 가 필요합니다." }, { status: 400 });
    await updateHistory(historyId, String(body.eventYm ?? ""), String(body.content ?? ""));
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "company_profile_update",
      targetTable: "company_history",
      targetId: historyId,
      after: { eventYm: body.eventYm },
    });
    return NextResponse.json({ history: await listHistory() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: 연혁 삭제 ?historyId=
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("org.edit", { fallbackRoles: ["admin"] });
    const historyId = String(req.nextUrl.searchParams.get("historyId") ?? "");
    if (!historyId) return NextResponse.json({ error: "historyId 가 필요합니다." }, { status: 400 });
    await deleteHistory(historyId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "company_profile_update",
      targetTable: "company_history",
      targetId: historyId,
      after: { deleted: true },
    });
    return NextResponse.json({ history: await listHistory() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
