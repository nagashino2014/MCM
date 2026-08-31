import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { buildCardSlipPdf } from "@/lib/finance/card-slip-pdf";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST {cardTxnIds:[...]} — 법인카드 승인 건별 매출전표 PDF 를 생성해 S3 에 두고
// 결재 첨부 항목({name,key,size})을 돌려준다(2026-08-26, 건당 1장 — 사용자 확정).
// 기안 화면의 법인카드 내역 불러오기가 표 행 추가와 함께 호출한다. 키는 카드 건당
// 결정적(approval/card-slips/{YYYYMM}/{cardTxnId}.pdf)이라 재호출해도 중복이 없다.
export async function POST(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const body = (await req.json().catch(() => ({}))) as { cardTxnIds?: string[] };
    const ids = Array.isArray(body.cardTxnIds) ? body.cardTxnIds.map((v) => String(v)).filter(Boolean).slice(0, 100) : [];
    if (!ids.length) return NextResponse.json({ error: "cardTxnIds 가 필요합니다." }, { status: 400 });

    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT ct.card_txn_id, ct.approval_num, ct.approved_at, ct.amount_total, ct.supply_amount, ct.tax_amount,
                ct.store_name, ct.store_ceo, ct.store_corp_num, ct.store_biz_type, ct.store_addr,
                cr.card_num, cr.card_alias, cr.card_company, cr.card_company_name,
                ep.name AS holder_name
           FROM card_transactions ct
           JOIN card_registry cr ON cr.card_id = ct.card_id
           LEFT JOIN employee_profiles ep ON ep.employee_id = cr.holder_employee_id
          WHERE ct.card_txn_id = ANY($1::text[])`,
        [ids]
      )
    );

    const items: { cardTxnId: string; name: string; key: string; size: number }[] = [];
    for (const r of rows) {
      const approvedAt = String(r.approved_at ?? "");
      const pdf = await buildCardSlipPdf({
        cardAlias: r.card_alias != null ? String(r.card_alias) : null,
        cardCompany: r.card_company_name != null ? String(r.card_company_name) : r.card_company != null ? String(r.card_company) : null,
        cardLast4: r.card_num ? String(r.card_num).replace(/\D/g, "").slice(-4) : null,
        approvalNum: r.approval_num != null ? String(r.approval_num) : null,
        approvedAt: approvedAt || null,
        storeName: r.store_name != null ? String(r.store_name) : null,
        storeCeo: r.store_ceo != null ? String(r.store_ceo) : null,
        storeCorpNum: r.store_corp_num != null ? String(r.store_corp_num) : null,
        storeBizType: r.store_biz_type != null ? String(r.store_biz_type) : null,
        storeAddr: r.store_addr != null ? String(r.store_addr) : null,
        supplyAmount: r.supply_amount != null ? Number(r.supply_amount) : null,
        taxAmount: r.tax_amount != null ? Number(r.tax_amount) : null,
        amountTotal: Number(r.amount_total ?? 0),
        holderName: r.holder_name != null ? String(r.holder_name) : null,
      });
      const ym = approvedAt.slice(0, 7).replace("-", "") || "unknown";
      const key = `approval/card-slips/${ym}/${String(r.card_txn_id)}.pdf`;
      await putContractDocument(key, pdf, "application/pdf");
      const name = sanitizeFilename(
        `법인카드전표_${String(r.store_name ?? "가맹점").slice(0, 20)}_${approvedAt.slice(0, 10).replace(/-/g, "")}.pdf`
      );
      items.push({ cardTxnId: String(r.card_txn_id), name, key, size: pdf.length });
    }
    return NextResponse.json({ items });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
