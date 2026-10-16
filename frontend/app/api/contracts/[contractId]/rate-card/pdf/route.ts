import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { upgradeRateCard } from "@/lib/contracts/rate-card";
import { renderRateCardPdf } from "@/lib/contracts/rate-card-pdf";
import { binaryResponse } from "@/lib/contracts/document-bundle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 단가 계약 내역서 PDF(2026-10-16 사용자 요청) — 변경계약 입력의 '단가 계약' 탭이 화면에 보이는 단가표를 보내면
 * 그대로 그린다(저장 전 변경 포함, unsaved=true 면 머리글에 표시). 계약명·업체·계약일은 DB 에서 읽는다.
 * 파일명: (계약일)계약명 단가표.pdf
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ contractId: string }> }) {
  try {
    const { contractId } = await params;
    await requirePermission("contract.view", { target: { contractId } });
    const body = (await req.json().catch(() => ({}))) as { card?: unknown; unsaved?: unknown };
    const card = upgradeRateCard(body.card);

    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT c.contract_title,
                COALESCE(NULLIF(c.contract_date, ''), c.started_at) AS contract_date,
                cp.company_name AS counterparty_name
           FROM contracts c
           LEFT JOIN facilities cp ON cp.facility_id = c.counterparty_facility_id
          WHERE c.contract_id = $1 AND c.deleted_at IS NULL`,
        [contractId]
      )
    );
    if (rows.length === 0) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });

    const contractTitle = String(rows[0].contract_title ?? "");
    const contractDate = rows[0].contract_date != null ? String(rows[0].contract_date).slice(0, 10) : null;
    const printedAt = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const pdf = await renderRateCardPdf({
      contractTitle,
      counterpartyName: String(rows[0].counterparty_name ?? ""),
      contractDate,
      printedAt,
      unsaved: body.unsaved === true,
      card,
    });
    return binaryResponse(pdf, "application/pdf", `${contractDate ? `(${contractDate})` : ""}${contractTitle} 단가표.pdf`);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
