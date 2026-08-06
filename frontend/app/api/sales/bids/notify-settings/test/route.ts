import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { sendTestNotification } from "@/lib/bid/notify-dispatch";
import { normalizeProfile } from "@/lib/bid/notify-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 테스트 전송 — 편집 중(미저장) 조건 그대로 즉시 1회 발송. 큐·발송이력은 건드리지 않는다. */
export async function POST(req: NextRequest) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = await req.json().catch(() => ({}));
    if (!body?.profile) return NextResponse.json({ error: "profile 이 필요합니다." }, { status: 400 });
    const profile = normalizeProfile(body.profile);
    if (!profile.recipients.length) {
      return NextResponse.json({ error: "수신자를 1명 이상 선택하세요." }, { status: 400 });
    }
    const result = await sendTestNotification(profile);
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
