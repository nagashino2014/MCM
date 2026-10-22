import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getCatalogAsset } from "@/lib/catalog/clients";
import { readContractDocument } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 회사소개서 자산(로고·사진·증서) 원본 — 화면 미리보기용
export async function GET(_req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    await requirePermission("catalog.view");
    const { assetId } = await params;
    const asset = await getCatalogAsset(assetId);
    if (!asset) return NextResponse.json({ error: "자산을 찾을 수 없습니다." }, { status: 404 });
    const buf = await readContractDocument(asset.storageKey);
    if (!buf) return NextResponse.json({ error: "파일을 읽지 못했습니다." }, { status: 404 });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": asset.contentType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.fileName || assetId)}`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
