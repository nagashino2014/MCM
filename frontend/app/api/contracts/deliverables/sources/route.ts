import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { buildAutoValues, loadContractContext, searchContracts } from "@/lib/deliverable/data";
import { listTemplates } from "@/lib/deliverable/store";
import type { DeliverableKind } from "@/lib/deliverable/types";

// 작성 화면 데이터 소스 — 계약 검색(?q=) / 계약 선택 시 자동채움·기성회차(?contractId=&kind=).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requirePermission("contract.view");
    const sp = req.nextUrl.searchParams;
    const contractId = sp.get("contractId");
    const kind: DeliverableKind = sp.get("kind") === "start" ? "start" : "completion";

    if (!contractId) {
      const contracts = await searchContracts(sp.get("q") ?? "", Number(sp.get("limit") ?? 30));
      return NextResponse.json({ contracts });
    }

    const ctx = await loadContractContext(contractId);
    if (!ctx) return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
    const values = await buildAutoValues(ctx, kind, {
      milestoneId: sp.get("milestoneId"),
      actualDate: sp.get("actualDate"),
      issueDate: sp.get("issueDate"),
      vatNote: sp.get("vatNote"),
    });
    // 이 발주처가 자체양식을 요구하면 작성 화면에서 우선 추천한다
    const templates = await listTemplates({ kind });
    return NextResponse.json({ contract: ctx, values, templates });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
