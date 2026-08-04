import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getBriefing } from "@/lib/intel/rag-queries";
import { createBriefingPdf } from "@/lib/intel/briefing-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ briefingId: string }>;
}

// 브리핑 리포트 PDF 다운로드
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("sales.view");
    const { briefingId } = await ctx.params;
    const briefing = await getBriefing(briefingId);
    if (!briefing) return NextResponse.json({ error: "브리핑을 찾을 수 없습니다." }, { status: 404 });
    const pdf = await createBriefingPdf(briefing);
    const stamp = (briefing.createdAt || new Date().toISOString()).slice(0, 10).replace(/-/g, "");
    const fileName = encodeURIComponent(`AI브리핑_${stamp}.pdf`);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${fileName}`,
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
