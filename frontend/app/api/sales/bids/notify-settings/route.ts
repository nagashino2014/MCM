import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { loadBidNotifySettings, saveBidNotifySettings } from "@/lib/bid/notify-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 매칭 알림 설정 조회 — 설정 + 큐 현황(pending/최근 발송). */
export async function GET() {
  try {
    await requirePermission("sales.view");
    const settings = await loadBidNotifySettings();
    let pending = 0;
    let lastSentAt: string | null = null;
    try {
      const db = await getDb();
      const rows = rowsToObjects(
        await db.exec(
          `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending, MAX(sent_at) AS last_sent
             FROM bid_match_notices`
        )
      );
      pending = Number(rows[0]?.pending ?? 0);
      lastSentAt = rows[0]?.last_sent != null ? String(rows[0].last_sent) : null;
    } catch {
      // 큐 테이블 부재(마이그레이션 전)여도 설정은 반환
    }
    return NextResponse.json({ settings, pending, lastSentAt });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 매칭 알림 설정 저장 — { enabled, sendTime, recipients: [{employeeId, name, channels[]}] }. */
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = await req.json().catch(() => ({}));
    const settings = await saveBidNotifySettings(
      {
        enabled: body?.enabled === true,
        ...(typeof body?.sendTime === "string" ? { sendTime: body.sendTime } : {}),
        ...(Array.isArray(body?.recipients) ? { recipients: body.recipients } : {}),
        ...(Array.isArray(body?.bidTypes) ? { bidTypes: body.bidTypes } : {}),
        ...(body?.contentFields && typeof body.contentFields === "object" ? { contentFields: body.contentFields } : {}),
      },
      actor.userId
    );
    return NextResponse.json({ settings });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
