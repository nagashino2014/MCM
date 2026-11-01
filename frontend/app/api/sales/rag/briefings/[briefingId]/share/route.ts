import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { getBriefingShareResult, listBriefingShareRecipients, shareBriefingWithChannels } from "@/lib/intel/briefing-share";
import type { BriefingShareInput } from "@/lib/intel/briefing-share-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ briefingId: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireSession();
    const { briefingId } = await ctx.params;
    if (req.nextUrl.searchParams.get("recipients") === "1") return NextResponse.json({ snapshot: await listBriefingShareRecipients(briefingId, actor.userId) });
    return NextResponse.json(await getBriefingShareResult(briefingId, actor.userId, req.nextUrl.searchParams.get("requestId") ?? ""));
  } catch (error) { return authErrorToResponse(error); }
}

// 항상 공유목록 ACL 등록 + 사용자가 선택한 추가 채널. 성공 채널은 같은 요청의 재시도에서 제외한다.
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requireSession();
    const { briefingId } = await ctx.params;
    const input = await req.json().catch(() => null) as BriefingShareInput;
    return NextResponse.json(await shareBriefingWithChannels(briefingId, actor.userId, input));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
