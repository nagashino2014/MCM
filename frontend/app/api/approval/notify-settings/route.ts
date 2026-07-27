import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { listNotifySettings, saveNotifySettings, type NotifyEventSetting } from "@/lib/approval/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 이벤트별 알림 채널 설정(admin)
export async function GET() {
  try {
    await requirePermission("approval.manage");
    return NextResponse.json({ settings: await listNotifySettings() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 알림 설정 저장(admin)
export async function PUT(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.manage");
    const body = (await req.json().catch(() => ({}))) as { settings?: NotifyEventSetting[] };
    if (!Array.isArray(body.settings)) return NextResponse.json({ error: "settings 배열이 필요합니다." }, { status: 400 });
    await saveNotifySettings(body.settings);
    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "approval_notify_settings_update",
      targetTable: "approval_notify_settings",
      targetId: "all",
      after: body.settings,
    });
    return NextResponse.json({ settings: await listNotifySettings() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
