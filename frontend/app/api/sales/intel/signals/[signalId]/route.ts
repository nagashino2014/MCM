import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getIntelSignalDetail, linkSignalFacility, updateSignalStatus } from "@/lib/intel/intel-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ signalId: string }>;
}

/** 신호 상세 — 원문 모달용 raw_json(소스별 본문·분류)·summary 포함. */
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("sales.view");
    const { signalId } = await ctx.params;
    const signal = await getIntelSignalDetail(signalId);
    if (!signal) return NextResponse.json({ error: "신호를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ signal });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { signalId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { status?: string; facilityId?: string };
    if (body.facilityId) await linkSignalFacility(signalId, String(body.facilityId));
    if (body.status && ["new", "reviewed", "dismissed"].includes(body.status)) {
      await updateSignalStatus(signalId, body.status as "new" | "reviewed" | "dismissed");
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
