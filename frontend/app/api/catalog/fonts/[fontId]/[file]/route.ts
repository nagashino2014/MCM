import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { uploadedFaceKey } from "@/lib/catalog/font-library";
import { readContractDocument } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 업로드 서체 굵기 파일(TrueType 윤곽 WOFF) — 스튜디오·미리보기·견본의 @font-face 가 부른다. /api/catalog/fonts/{id}/{굵기}.woff?v=…
// 주소의 v 는 파일을 바꾸면 달라진다(저장소 키 끝부분) — 그래서 오래 캐시해도 된다.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ fontId: string; file: string }> }) {
  try {
    await requirePermission("catalog.view");
    const { fontId, file } = await params;
    const m = /^(\d{3})\.woff$/.exec(file);
    if (!m || !/^f-[a-f0-9]{12}$/.test(fontId)) return NextResponse.json({ error: "서체 주소가 올바르지 않습니다." }, { status: 400 });
    const key = await uploadedFaceKey(fontId, Number(m[1]));
    const buf = key ? await readContractDocument(key) : null;
    if (!buf) return NextResponse.json({ error: "서체 파일을 찾지 못했습니다." }, { status: 404 });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "font/woff",
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
