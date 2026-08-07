import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { sanitizeDownloadName } from "@/lib/contracts/document-bundle";
import { generateDeliverableArtifacts } from "@/lib/deliverable/generate";

// 착수계·준공계 HWPX 다운로드(D2) — 실물 hwp 기반 템플릿 치환 결과(편집용 원본).
// 기본양식만 지원한다(발주처 자체양식은 PDF).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ deliverableId: string }>;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { deliverableId } = await ctx.params;
    const persist = req.nextUrl.searchParams.get("persist") === "1";
    await requirePermission(persist ? "contract.edit" : "contract.view", persist ? { fallbackRoles: ["editor"] } : undefined);

    const { hwpxBytes, fileBase } = await generateDeliverableArtifacts(deliverableId, { persist });
    if (!hwpxBytes) {
      return NextResponse.json({ error: "이 문서는 HWPX 를 지원하지 않습니다(발주처 자체양식은 PDF 만 제공)." }, { status: 400 });
    }
    return new NextResponse(Buffer.from(hwpxBytes), {
      headers: {
        "Content-Type": "application/vnd.hancom.hwpx",
        "Content-Length": String(hwpxBytes.byteLength),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(sanitizeDownloadName(fileBase + ".hwpx"))}`,
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
