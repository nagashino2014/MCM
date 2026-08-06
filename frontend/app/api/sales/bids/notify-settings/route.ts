import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { DEFAULT_CONTENT_FIELDS, loadBidNotifyConfig, saveBidNotifyConfig } from "@/lib/bid/notify-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 매칭 알림 설정 조회 — 프로파일 목록 + 큐 현황(pending/최근 발송) + 기본 발송 항목 프리셋. */
export async function GET() {
  try {
    await requirePermission("sales.view");
    const config = await loadBidNotifyConfig();
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
    return NextResponse.json({
      profiles: config.profiles,
      pending,
      lastSentAt,
      defaultContentFields: DEFAULT_CONTENT_FIELDS,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 매칭 알림 설정 저장 — { profiles: [{ name, enabled, sendTime, rangeDays, bidTypes, … }] } 전체 교체. */
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body?.profiles)) {
      return NextResponse.json({ error: "profiles 배열이 필요합니다." }, { status: 400 });
    }
    const config = await saveBidNotifyConfig(body.profiles, actor.userId);
    return NextResponse.json({ profiles: config.profiles });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
