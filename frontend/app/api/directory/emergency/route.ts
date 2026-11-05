import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { requireGlobalScope } from "@/lib/auth/scope-guards";
import { recordAccessLog } from "@/lib/auth/access-log";
import {
  addEmergencyContactLine,
  createEmergencyContact,
  deleteEmergencyContact,
  listEmergencyContacts,
  updateEmergencyContact,
  type EmergencyContactPatch,
} from "@/lib/emergency-contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 비상 연락망 — 열람은 로그인 전원(2026-11-05 사용자 결정, 개인 메일 포함), 수정은 전사 범위 staffing.edit(인사 담당·관리자).
// 숨긴 행은 수정 권한자에게만 내려준다. 열람은 접속기록(access_log)에 남긴다.
const EDIT_KEY = "staffing.edit";

function badRequest(err: unknown): NextResponse {
  if (err instanceof AuthError || !(err instanceof Error) || !err.message) return authErrorToResponse(err);
  return NextResponse.json({ error: err.message }, { status: 400 });
}

export async function GET() {
  try {
    const ctx = await requireSession();
    const rows = await listEmergencyContacts();
    const canEdit = await requireGlobalScope(EDIT_KEY).then(() => true, () => false);
    await recordAccessLog({
      actorUserId: ctx.userId,
      action: "view",
      targetKind: "emergency_contacts",
      detail: { count: rows.length },
    });
    return NextResponse.json({ rows: canEdit ? rows : rows.filter((r) => !r.hidden) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireGlobalScope(EDIT_KEY);
    const { sameAsEmployeeId, ...body } = (await req.json().catch(() => ({}))) as EmergencyContactPatch & { sameAsEmployeeId?: string };
    // 겸직 줄(sameAsEmployeeId)과 인사카드 없는 인원을 같은 경로로 추가한다.
    const entryId = sameAsEmployeeId
      ? await addEmergencyContactLine(String(sameAsEmployeeId), body, ctx.userId)
      : await createEmergencyContact(body, ctx.userId);
    const key = `entry:${entryId}`;
    return NextResponse.json({ key });
  } catch (err) {
    return badRequest(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireGlobalScope(EDIT_KEY);
    const { key, ...patch } = (await req.json().catch(() => ({}))) as EmergencyContactPatch & { key?: string };
    if (!key) return NextResponse.json({ error: "수정할 행을 지정하세요." }, { status: 400 });
    await updateEmergencyContact(String(key), patch, ctx.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return badRequest(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireGlobalScope(EDIT_KEY);
    const key = new URL(req.url).searchParams.get("key");
    if (!key) return NextResponse.json({ error: "삭제할 행을 지정하세요." }, { status: 400 });
    await deleteEmergencyContact(key, ctx.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return badRequest(err);
  }
}
