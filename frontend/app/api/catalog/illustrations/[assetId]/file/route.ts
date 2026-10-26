import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { readIllustrationFile } from "@/lib/catalog/illustrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 일러스트 파일(?f=svg 정리본 | thumb 미리보기) — 화면 미리보기용. SVG 는 문서로 열려도 스크립트가 돌지 않게 CSP sandbox
export async function GET(req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    await requirePermission("catalog.view");
    const { assetId } = await params;
    const which = req.nextUrl.searchParams.get("f") === "thumb" ? "thumb" : "svg";
    const buf = await readIllustrationFile(assetId, which);
    if (!buf) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": which === "svg" ? "image/svg+xml" : "image/png",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
