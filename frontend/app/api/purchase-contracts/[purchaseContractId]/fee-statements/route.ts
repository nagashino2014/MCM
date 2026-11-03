import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects, withDbWrite } from "@/lib/db";
import { recordAuditLogInline } from "@/lib/auth/audit";
import { getPurchaseContractDocumentStorageKey, putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { parseFeeStatement } from "@/lib/contracts/purchase/fee-statement-llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ purchaseContractId: string }>;
}

const MAX_BYTES = 30 * 1024 * 1024;
const PUBLIC_PATH_PREFIX = "/api/purchase-contracts/documents?key=";

/**
 * 관리비 명세서 PDF 업로드 + AI 파싱(333) — 관리 계약(사무실 관리비)의 납부 현황 탭.
 * 파일을 purchase_contract_documents(fee_statement)로 먼저 저장하고 파싱 결과를 돌려준다. 월별 금액 행은 아직 쓰지 않는다 —
 * 사용자가 미리보기에서 연·월·금액·항목을 확인한 뒤 fee-statements/confirm 이 월별 행을 만든다. 파싱 실패(키 없음 등)면
 * parsed=null 로 돌려주고 화면은 수동 입력으로 넘어간다. 같은 PDF(sha256)를 다시 올리면 문서는 재사용한다.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { purchaseContractId } = await ctx.params;
    const actor = await requirePermission("purchase.edit");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "PDF 파일이 필요합니다." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "PDF 파일은 30MB 이하만 업로드할 수 있습니다." }, { status: 400 });
    if (file.type && file.type !== "application/pdf") return NextResponse.json({ error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });

    const db = await getDb();
    const head = rowsToObjects(
      await db.exec(
        "SELECT contract_title, contract_type, contract_date, created_at FROM purchase_contracts WHERE purchase_contract_id = $1 AND deleted_at IS NULL",
        [purchaseContractId]
      )
    )[0];
    if (!head) return NextResponse.json({ error: "매입 계약을 찾을 수 없습니다." }, { status: 404 });
    if (String(head.contract_type) !== "management") return NextResponse.json({ error: "관리비 명세서는 관리 계약에서만 올릴 수 있습니다." }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    const parsed = await parseFeeStatement(buffer, { userId: actor.userId, purchaseContractId });

    const existing = rowsToObjects(
      await db.exec(
        "SELECT document_id, public_path, display_name FROM purchase_contract_documents WHERE purchase_contract_id = $1 AND sha256 = $2",
        [purchaseContractId, hash]
      )
    )[0];
    if (existing) {
      return NextResponse.json({ documentId: String(existing.document_id), publicPath: String(existing.public_path ?? ""), displayName: String(existing.display_name ?? ""), duplicate: true, parsed });
    }

    const contractTitle = String(head.contract_title ?? "").trim();
    const contractDate = String(head.contract_date ?? "").trim() || String(head.created_at ?? "").slice(0, 10);
    const now = new Date();
    const period = parsed?.year && parsed?.month ? `${parsed.year}-${String(parsed.month).padStart(2, "0")}` : now.toISOString().slice(0, 7);
    const countRow = rowsToObjects(
      await db.exec("SELECT COUNT(*) AS n FROM purchase_contract_documents WHERE purchase_contract_id = $1 AND document_type = 'fee_statement' AND display_name LIKE $2", [
        purchaseContractId,
        `(${period})%`,
      ])
    )[0];
    const { storageKey, fileName } = getPurchaseContractDocumentStorageKey({
      contractDate,
      documentDate: period,
      contractTitle,
      docType: "fee_statement",
      seq: Number(countRow?.n ?? 0) + 1,
    });
    const stored = await putContractDocument(storageKey, buffer, file.type || "application/pdf");
    const publicPath = PUBLIC_PATH_PREFIX + encodeURIComponent(storageKey);
    const documentId = "pcd_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const nowIso = now.toISOString();
    await withDbWrite(async (txn) => {
      await txn.run(
        `INSERT INTO purchase_contract_documents
          (document_id, purchase_contract_id, milestone_id, document_type, display_name, original_filename, content_type,
           byte_size, sha256, storage_provider, storage_bucket, storage_key, public_path, created_by, created_at, updated_at)
         VALUES ($1, $2, NULL, 'fee_statement', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
        [
          documentId,
          purchaseContractId,
          fileName,
          sanitizeFilename(file.name || "fee-statement.pdf"),
          file.type || "application/pdf",
          file.size,
          hash,
          stored.storageProvider,
          stored.storageBucket,
          stored.storageKey,
          publicPath,
          actor.userId,
          nowIso,
        ]
      );
      await recordAuditLogInline(txn, {
        actorUserId: actor.userId,
        action: "purchase_contract_document_upload",
        targetTable: "purchase_contract_documents",
        targetId: documentId,
        after: { purchaseContractId, documentType: "fee_statement", period, storageKey, fileName, parsed: parsed != null },
      });
    });
    return NextResponse.json({ documentId, publicPath, displayName: fileName, duplicate: false, parsed });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
