import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { loadImageKey } from "@/lib/catalog/render/html";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 회사소개서 미리보기 이미지 — 렌더러 이미지 키(a/자산 · c/증빙 · e/인사 사진)를 바이트로. PDF 는 같은 키를 converter 에 직접 넘긴다.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("catalog.view");
    const key = req.nextUrl.searchParams.get("key") ?? "";
    if (!/^[ace]\/[A-Za-z0-9_\-]{1,80}$/.test(key)) return NextResponse.json({ error: "잘못된 이미지 키입니다." }, { status: 400 });
    const hit = await loadImageKey(key);
    if (!hit || !/^image\//.test(hit.contentType)) return NextResponse.json({ error: "이미지를 찾을 수 없습니다." }, { status: 404 });
    return new NextResponse(new Uint8Array(hit.data), {
      headers: { "Content-Type": hit.contentType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
