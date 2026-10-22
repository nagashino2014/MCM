import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getCatalogEditionFile } from "@/lib/catalog/render/editions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 회사소개서 생성본 PDF — ?download=1 이면 받기(첨부), 아니면 브라우저 미리보기(inline)
export async function GET(req: NextRequest, { params }: { params: Promise<{ editionId: string }> }) {
  try {
    await requirePermission("catalog.view");
    const { editionId } = await params;
    const hit = await getCatalogEditionFile(editionId);
    if (!hit) return NextResponse.json({ error: "생성본을 찾을 수 없습니다." }, { status: 404 });
    const name = hit.summary.fileName || `${editionId}.pdf`;
    const disposition = req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new NextResponse(new Uint8Array(hit.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(hit.pdf.length),
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
