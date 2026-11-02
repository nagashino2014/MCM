import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { PURCHASE_CONTRACT_DOCUMENT_PREFIX, readContractDocument } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 다운로드 파일명 헤더 — 매출 라우트(app/api/contracts/documents/route.ts)와 같은 RFC 5987 처리. */
function contentDisposition(key: string): string {
  const base = key.split("/").pop() || "document.pdf";
  const encoded = encodeURIComponent(base).replace(/[()'*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `inline; filename="document.pdf"; filename*=UTF-8''${encoded}`;
}

/**
 * 매입 계약 문서 다운로드(331) — purchase.view 보유자만. 키는 purchase-contracts/ 접두와
 * purchase_contract_documents 등록 여부를 모두 확인한다(같은 버킷의 다른 문서 임의 읽기 차단).
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("purchase.view");
    const key = req.nextUrl.searchParams.get("key")?.trim();
    if (!key || key.includes("..") || !key.startsWith(PURCHASE_CONTRACT_DOCUMENT_PREFIX)) {
      return NextResponse.json({ error: "문서 키가 올바르지 않습니다." }, { status: 400 });
    }
    const db = await getDb();
    const row = rowsToObjects(
      await db.exec(
        `SELECT d.content_type FROM purchase_contract_documents d
           JOIN purchase_contracts p ON p.purchase_contract_id = d.purchase_contract_id
          WHERE d.storage_key = $1 AND p.deleted_at IS NULL`,
        [key]
      )
    )[0];
    if (!row) return NextResponse.json({ error: "등록되지 않은 문서입니다." }, { status: 404 });
    const body = await readContractDocument(key);
    if (!body) return NextResponse.json({ error: "문서 파일을 찾을 수 없습니다." }, { status: 404 });
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": String(row.content_type ?? "application/pdf"),
        "Content-Disposition": contentDisposition(key),
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
