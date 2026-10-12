import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { blockedExtensionsFor } from "@/lib/security/attachment-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 본인에게 적용되는 차단 확장자 목록 — 메일 작성·메신저 화면의 사전 안내용(최종 판정은 전송 API). */
export async function GET() {
  try {
    const ctx = await requireSession();
    const blocked = [...(await blockedExtensionsFor(ctx.userId))].sort();
    return NextResponse.json({ blocked });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
