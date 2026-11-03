import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { getAssetDocumentKey, setAssetDocument } from "@/lib/assets/store";
import { deleteContractDocument, putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ purchaseContractId: string }>;
}

const MAX_SIZE = 30 * 1024 * 1024;

async function linkedAssetOf(purchaseContractId: string): Promise<string | null> {
  const db = await getDb();
  const row = rowsToObjects(
    await db.exec(`SELECT linked_asset_id FROM purchase_contracts WHERE purchase_contract_id = $1 AND deleted_at IS NULL`, [purchaseContractId])
  )[0];
  if (!row) throw Object.assign(new Error("매입 계약을 찾을 수 없습니다."), { status: 404 });
  return row.linked_asset_id != null && String(row.linked_asset_id) ? String(row.linked_asset_id) : null;
}

/**
 * 차량 등록증 업로드(333) — 차량 렌트 계약에 연결된 자산관리 차량(reservable_assets)의 등록증 자리에 저장한다.
 * 자산 문서 라우트(app/api/assets/[assetId]/documents)와 같은 키 규칙(assets/vehicles/{assetId}/등록증-…)이라
 * 자산관리 화면에서도 같은 파일이 보인다. 권한은 purchase.edit(계약의 부속 문서).
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { purchaseContractId } = await ctx.params;
    const actor = await requirePermission("purchase.edit");
    const assetId = await linkedAssetOf(purchaseContractId);
    if (!assetId) return NextResponse.json({ error: "연결된 차량 자산이 없습니다. 차량 렌트 계약을 먼저 저장해 주세요." }, { status: 400 });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "업로드할 파일이 없습니다." }, { status: 400 });
    if (file.size > MAX_SIZE) return NextResponse.json({ error: "파일이 30MB를 초과합니다." }, { status: 400 });
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });
    }
    const prevKey = await getAssetDocumentKey(assetId, "registration");
    const safeName = sanitizeFilename(file.name || "registration.pdf");
    const key = ["assets", "vehicles", assetId, `등록증-${Date.now()}-${safeName}`].join("/");
    await putContractDocument(key, Buffer.from(await file.arrayBuffer()), "application/pdf");
    await setAssetDocument(assetId, "registration", key, safeName);
    if (prevKey && prevKey !== key) await deleteContractDocument(prevKey).catch(() => undefined);
    await withDbWrite(async (db) => {
      await recordAuditLogInline(db, {
        actorUserId: actor.userId,
        action: "purchase_contract_document_upload",
        targetTable: "reservable_assets",
        targetId: assetId,
        after: { purchaseContractId, docType: "registration", fileName: safeName },
      });
    });
    return NextResponse.json({ ok: true, key, fileName: safeName, publicPath: `/api/assets/documents?key=${encodeURIComponent(key)}` });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
