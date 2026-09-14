import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { readYearendUpload } from "@/lib/finance/yearend-self";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ATTACH = "inline; filename*=UTF-8'" + "'";

/** 관리자 — 직원 업로드 파일 열람 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  try {
    await requireAdmin();
    const { uploadId } = await params;
    const f = await readYearendUpload(uploadId, null);
    if (!f) return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
    return new NextResponse(new Uint8Array(f.buffer), {
      headers: {
        "Content-Type": f.contentType,
        "Content-Disposition": ATTACH + encodeURIComponent(f.fileName),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
