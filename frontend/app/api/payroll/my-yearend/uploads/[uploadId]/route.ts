import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { deleteMyYearendUpload, readYearendUpload } from "@/lib/finance/yearend-self";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ATTACH = "inline; filename*=UTF-8'" + "'";

/** 본인 업로드 파일 내려받기 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  try {
    const ctx = await requireSession();
    const { uploadId } = await params;
    const f = await readYearendUpload(uploadId, ctx.userId);
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

/** 본인 업로드 삭제 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ uploadId: string }> }) {
  try {
    const ctx = await requireSession();
    const { uploadId } = await params;
    await deleteMyYearendUpload(ctx.userId, uploadId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
