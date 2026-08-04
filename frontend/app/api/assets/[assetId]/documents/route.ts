import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getAssetDocumentKey, setAssetDocument } from "@/lib/assets/store";
import { deleteContractDocument, putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SIZE = 30 * 1024 * 1024; // 30MB — 사업자등록증 업로드와 동일 상한

// POST: 차량 서류(계약서/등록증) PDF 업로드(asset.manage).
// FormData: file(pdf) + docType(contract|registration). 저장은 계약서 문서 저장 유틸 재사용
// (S3 MCM_STORAGE_BUCKET, 로컬 개발은 CONTRACT_DOCUMENT_STORAGE_ROOT 폴백).
// 기존 파일이 있으면 교체(이전 객체는 best-effort 삭제).
export async function POST(req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const actor = await requirePermission("asset.manage");
    const { assetId } = await params;
    const form = await req.formData();
    const file = form.get("file");
    const docTypeRaw = String(form.get("docType") ?? "");
    if (docTypeRaw !== "contract" && docTypeRaw !== "registration") {
      return NextResponse.json({ error: "서류 종류가 올바르지 않습니다." }, { status: 400 });
    }
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "업로드할 파일이 없습니다." }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "파일이 30MB를 초과합니다." }, { status: 400 });
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });
    }

    const prevKey = await getAssetDocumentKey(assetId, docTypeRaw);
    const safeName = sanitizeFilename(file.name || `${docTypeRaw}.pdf`);
    const label = docTypeRaw === "contract" ? "계약서" : "등록증";
    const key = ["assets", "vehicles", assetId, `${label}-${Date.now()}-${safeName}`].join("/");
    const body = Buffer.from(await file.arrayBuffer());
    await putContractDocument(key, body, "application/pdf");
    await setAssetDocument(assetId, docTypeRaw, key, safeName);
    if (prevKey && prevKey !== key) await deleteContractDocument(prevKey);

    await recordAuditLog({
      actorUserId: actor.userId,
      action: "asset_document_upload",
      targetTable: "reservable_assets",
      targetId: assetId,
      after: { docType: docTypeRaw, fileName: safeName },
    });
    return NextResponse.json({ ok: true, key, fileName: safeName });
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    if (err instanceof Error && err.message) return NextResponse.json({ error: err.message }, { status: 400 });
    return authErrorToResponse(err);
  }
}
