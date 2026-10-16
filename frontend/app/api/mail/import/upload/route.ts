import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { createImportUpload } from "@/lib/mail/import/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 메일 가져오기 업로드 발급 — { fileName, byteSize } → { key, url(presigned PUT) }. ZIP·EML, 파일당 2GB.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => null)) as { fileName?: unknown; byteSize?: unknown } | null;
    const out = await createImportUpload(ctx.userId, {
      fileName: typeof body?.fileName === "string" ? body.fileName : "",
      byteSize: typeof body?.byteSize === "number" ? body.byteSize : 0,
    });
    return NextResponse.json(out);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
