import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { registerPushToken, revokePushToken } from "@/lib/notify/push-prefs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 앱이 획득한 Expo push token 을 현재 사용자에게 등록·갱신한다(앱 시작 시마다 호출).
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json()) as {
      expoToken?: string;
      platform?: string;
      deviceId?: string;
      appVersion?: string;
    };
    const expoToken = String(body.expoToken ?? "").trim();
    if (!expoToken.startsWith("ExponentPushToken")) {
      return NextResponse.json({ error: "유효한 Expo 토큰이 아닙니다." }, { status: 400 });
    }
    const platform = body.platform === "ios" ? "ios" : "android";
    await registerPushToken({
      userId: ctx.userId,
      expoToken,
      platform,
      deviceId: body.deviceId ?? null,
      appVersion: body.appVersion ?? null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: 로그아웃·수신 거부 시 토큰 폐기.
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const expoToken = String(req.nextUrl.searchParams.get("expoToken") ?? "").trim();
    if (!expoToken) return NextResponse.json({ error: "expoToken 이 필요합니다." }, { status: 400 });
    await revokePushToken(ctx.userId, expoToken);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
