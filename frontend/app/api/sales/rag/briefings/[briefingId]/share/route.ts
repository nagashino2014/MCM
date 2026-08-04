import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { shareBriefing, type BriefingShareRecipient } from "@/lib/intel/rag-queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ briefingId: string }>;
}

// 브리핑 공유. body: { recipients: [{ userId, name }] }
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const actor = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { briefingId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { recipients?: BriefingShareRecipient[] };
    const recipients = (Array.isArray(body.recipients) ? body.recipients : []).filter((r) => r && r.userId);
    if (!recipients.length) {
      return NextResponse.json({ error: "공유할 인원을 선택하세요." }, { status: 400 });
    }
    const shared = await shareBriefing(briefingId, recipients, actor.userId || null);
    return NextResponse.json({ ok: true, shared });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
