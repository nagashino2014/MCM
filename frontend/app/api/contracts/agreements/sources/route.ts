import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { searchContracts } from "@/lib/deliverable/data";
import { listCustomTemplatesForFacility } from "@/lib/agreement/store";
import { listQuotes } from "@/lib/quote/store";

// 계약서 작성 화면 데이터 소스 — 연동 검색(?q=: 계약 + 수주 견적) /
// 발주처 상세(?facilityId=: 갑지 자동 채움 + 자체양식 추천) / 계약 상세(?contractId=).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface OrdererInfo {
  facilityId: string | null;
  name: string;
  address: string;
  bizNo: string;
  phone: string;
}

async function loadOrderer(facilityId: string): Promise<OrdererInfo | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT facility_id, company_name, site_address, business_registration_no, phone_number
         FROM facilities WHERE facility_id = $1`,
      [facilityId]
    )
  );
  const r = rows[0];
  if (!r) return null;
  return {
    facilityId: String(r.facility_id),
    name: String(r.company_name ?? ""),
    address: String(r.site_address ?? ""),
    bizNo: String(r.business_registration_no ?? ""),
    phone: String(r.phone_number ?? ""),
  };
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission("contract.view");
    const sp = req.nextUrl.searchParams;

    // 발주처 상세 — 갑지 자동 채움(대표자는 facilities 에 없어 수동 입력) + 자체양식 추천
    const facilityId = sp.get("facilityId");
    if (facilityId) {
      const orderer = await loadOrderer(facilityId);
      if (!orderer) return NextResponse.json({ error: "사업장을 찾을 수 없습니다." }, { status: 404 });
      const customTemplates = await listCustomTemplatesForFacility(facilityId);
      return NextResponse.json({
        orderer,
        customTemplates: customTemplates.map((t) => ({ templateId: t.templateId, name: t.name })),
      });
    }

    // 계약 상세 — 계약에서 시작(연동 자동 채움)
    const contractId = sp.get("contractId");
    if (contractId) {
      const db = await getDb();
      const rows = rowsToObjects(
        await db.exec(
          `SELECT c.contract_id, c.contract_title, c.service_type, c.service_subtype,
                  c.contract_amount, c.current_amount, c.contract_date, c.started_at, c.ended_at,
                  c.counterparty_facility_id
             FROM contracts c
            WHERE c.contract_id = $1 AND c.deleted_at IS NULL`,
          [contractId]
        )
      );
      const c = rows[0];
      if (!c) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
      const counterpartyId = c.counterparty_facility_id != null ? String(c.counterparty_facility_id) : null;
      const orderer = counterpartyId ? await loadOrderer(counterpartyId) : null;
      const customTemplates = counterpartyId ? await listCustomTemplatesForFacility(counterpartyId) : [];
      return NextResponse.json({
        contract: {
          contractId: String(c.contract_id),
          title: String(c.contract_title ?? ""),
          serviceType: c.service_type != null ? String(c.service_type) : null,
          serviceSubtype: c.service_subtype != null ? String(c.service_subtype) : null,
          amount: c.current_amount != null ? Number(c.current_amount) : c.contract_amount != null ? Number(c.contract_amount) : null,
          contractDate: c.contract_date != null ? String(c.contract_date) : null,
          startedAt: c.started_at != null ? String(c.started_at) : null,
          endedAt: c.ended_at != null ? String(c.ended_at) : null,
        },
        orderer,
        customTemplates: customTemplates.map((t) => ({ templateId: t.templateId, name: t.name })),
      });
    }

    // 연동 검색 — 계약 + 수주 확정(won) 견적
    const q = (sp.get("q") ?? "").trim();
    const contracts = await searchContracts(q, 20);
    const quotes = (await listQuotes({ q: q || null, limit: 60 }))
      .filter((r) => r.result === "won")
      .slice(0, 20)
      .map((r) => ({
        quoteId: r.quoteId,
        quoteNo: r.quoteNo,
        title: r.title,
        serviceType: r.serviceType,
        serviceSubtype: r.serviceSubtype,
        totalAmount: r.resultAmount ?? r.totalAmount,
        facilityId: r.recipients[0]?.facilityId ?? null,
        facilityName: r.recipients[0]?.facilityName ?? r.recipients[0]?.name ?? null,
      }));
    return NextResponse.json({ contracts, quotes });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
