import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { resolveVisibleContractIds } from "@/lib/auth/contract-scope";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  contract: "계약서",
  amendment: "변경계약서",
  invoice: "세금계산서",
  outsourcing: "외주계약서",
  certificate: "실적증명서",
};

// GET /api/contracts/documents/list?from=YYYYMM&to=YYYYMM&q= — 문서함 '계약 문서' 탭 목록.
// 스코프: contract.view + resolveVisibleContractIds(참여 계약 제한 사용자는 해당 계약만).
// 열람은 기존 GET /api/contracts/documents?key= 스트리밍을 재사용한다.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("contract.view");
    const visibleIds = await resolveVisibleContractIds(ctx.userId, "contract.view");
    if (visibleIds !== null && visibleIds.length === 0) {
      return NextResponse.json({ documents: [] });
    }

    const params: unknown[] = [];
    const conds: string[] = [];
    if (visibleIds !== null) {
      params.push(visibleIds);
      conds.push(`d.contract_id = ANY($${params.length}::text[])`);
    }
    const ym = (v: string | null) => {
      const m = /^(\d{4})(\d{2})$/.exec((v ?? "").trim());
      return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}` : null;
    };
    const fromKey = ym(req.nextUrl.searchParams.get("from"));
    if (fromKey) {
      params.push(fromKey);
      conds.push(`substring(d.created_at, 1, 7) >= $${params.length}`);
    }
    const toKey = ym(req.nextUrl.searchParams.get("to"));
    if (toKey) {
      params.push(toKey);
      conds.push(`substring(d.created_at, 1, 7) <= $${params.length}`);
    }
    const q = String(req.nextUrl.searchParams.get("q") ?? "").trim();
    if (q) {
      params.push(`%${q}%`);
      const p = `$${params.length}`;
      conds.push(`(COALESCE(d.display_name, '') ILIKE ${p} OR COALESCE(d.original_filename, '') ILIKE ${p} OR c.contract_title ILIKE ${p})`);
    }

    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT d.document_id, d.contract_id, d.document_type,
                COALESCE(NULLIF(d.display_name, ''), NULLIF(d.original_filename, ''), d.document_type) AS file_name,
                d.byte_size, d.storage_key, d.created_at, c.contract_title
           FROM contract_documents d
           JOIN contracts c ON c.contract_id = d.contract_id
          ${conds.length ? `WHERE ${conds.join(" AND ")}` : ""}
          ORDER BY d.created_at DESC
          LIMIT 1000`,
        params
      )
    );
    return NextResponse.json({
      documents: rows.map((r) => ({
        documentId: String(r.document_id),
        contractId: String(r.contract_id),
        contractTitle: String(r.contract_title ?? ""),
        documentType: String(r.document_type ?? ""),
        typeLabel: TYPE_LABEL[String(r.document_type ?? "")] ?? String(r.document_type ?? "기타"),
        fileName: String(r.file_name ?? ""),
        byteSize: r.byte_size != null ? Number(r.byte_size) : null,
        storageKey: r.storage_key != null ? String(r.storage_key) : null,
        createdAt: r.created_at != null ? String(r.created_at) : null,
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
