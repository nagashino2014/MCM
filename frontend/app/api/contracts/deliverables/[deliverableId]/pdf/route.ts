import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { sanitizeDownloadName } from "@/lib/contracts/document-bundle";
import { generateDeliverableArtifacts } from "@/lib/deliverable/generate";

// 착수계·준공계 PDF — 기본은 미리보기(inline, 보관 없음).
// ?download=1 첨부 다운로드 / ?persist=1 S3 보관 + 대장에 키 기록(작성 완료 확정).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ deliverableId: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { deliverableId } = await ctx.params;
    const sp = req.nextUrl.searchParams;
    const persist = sp.get("persist") === "1";
    await requirePermission(persist ? "contract.edit" : "contract.view", persist ? { fallbackRoles: ["editor"] } : undefined);

    const { pdfBytes, fileBase } = await generateDeliverableArtifacts(deliverableId, { persist });
    const disposition = sp.get("download") === "1" ? "attachment" : "inline";
    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdfBytes.byteLength),
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(sanitizeDownloadName(fileBase + ".pdf"))}`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
