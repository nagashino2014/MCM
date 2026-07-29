import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { addReceivableActionDocument, getReceivableActionById } from "@/lib/ieps/receivables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

interface RouteContext {
  params: Promise<{ actionId: string }>;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("billing.receivable.manage");
    const { actionId } = await ctx.params;
    const action = await getReceivableActionById(actionId);
    if (!action) {
      return NextResponse.json({ error: "대응 조치를 찾을 수 없습니다." }, { status: 404 });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "업로드할 파일을 선택해 주세요." }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "파일 크기는 20MB 이하여야 합니다." }, { status: 400 });
    }

    const fileName = sanitizeFilename(file.name || "document");
    const storageKey = ["contracts", "receivable-actions", actionId, fileName].join("/");
    const body = Buffer.from(await file.arrayBuffer());
    const stored = await putContractDocument(
      storageKey,
      body,
      file.type || "application/octet-stream"
    );

    const document = await addReceivableActionDocument({
      actionId,
      fileName,
      contentType: file.type || null,
      byteSize: file.size,
      storageProvider: stored.storageProvider,
      storageBucket: stored.storageBucket,
      storageKey: stored.storageKey,
      publicPath: stored.publicPath,
    });

    return NextResponse.json({ ok: true, document });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
