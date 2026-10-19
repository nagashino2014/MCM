import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { filterByVisibleContracts, requireVisibleContracts } from "@/lib/auth/scope-guards";
import { listAgreementDocs } from "@/lib/agreement/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 계약서 보드 목록 — frm-agreement 결재 문서 + 대장 발송 상태. ?q=검색.
export async function GET(req: NextRequest) {
  try {
    const { visible } = await requireVisibleContracts("contract.view");
    const sp = req.nextUrl.searchParams;
    // 가시 계약(contract.view 범위)에 연동된 계약서만 — 계약 미연동 문서는 전사 범위에만(2026-10-19 §7.7)
    const docs = filterByVisibleContracts(
      await listAgreementDocs({ q: sp.get("q"), limit: Number(sp.get("limit") ?? 200) }),
      visible,
      (d) => d.contractId
    );
    return NextResponse.json({ docs });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
