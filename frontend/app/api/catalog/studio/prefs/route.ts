import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { isInfoType } from "@/lib/catalog/render/infographic/types";
import { saveInfographicPref } from "@/lib/catalog/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 인포그래픽 유형 선택 기록 { slot, type, variant } — 같은 자리(분야)의 다음 추천에서 이 유형을 앞에 둔다(블루프린트 §4-4)
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as { slot?: unknown; type?: unknown; variant?: unknown };
    if (typeof body.slot !== "string" || !isInfoType(body.type)) return NextResponse.json({ error: "자리·유형이 올바르지 않습니다." }, { status: 400 });
    const variant = typeof body.variant === "string" && /^[a-z0-9]{1,10}$/.test(body.variant) ? body.variant : null;
    await saveInfographicPref(body.slot, body.type, variant, actor.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
