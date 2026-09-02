import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listUsers } from "@/lib/auth/users";
import { loadFilingSettings, saveFilingSettings } from "@/lib/filings/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 설정 조회 — 알림 수신자 선택용 활성 사용자 목록을 함께 준다(별도 관리자 API 권한 불필요). */
export async function GET() {
  try {
    await requirePermission("filing.view");
    const [settings, users] = await Promise.all([loadFilingSettings(), listUsers()]);
    return NextResponse.json({
      settings,
      users: users
        .filter((u) => u.status === "active")
        .map((u) => ({ userId: u.userId, name: u.name })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("filing.manage");
    const body = await req.json();
    const settings = await saveFilingSettings(body, actor.userId);
    return NextResponse.json({ settings });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
