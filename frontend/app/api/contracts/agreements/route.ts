import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { filterByVisibleContracts, requireVisibleContracts } from "@/lib/auth/scope-guards";
import { listAgreementDocs } from "@/lib/agreement/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 계약서 보드 목록 — frm-agreement 결재 문서 + 대장 발송 상태. ?q=검색.
export async function GET(req: NextRequest) {
  try {
    const { ctx, visible } = await requireVisibleContracts("contract.view");
    const sp = req.nextUrl.searchParams;
    // 가시 계약(contract.view 범위)에 연동된 계약서 + 본인이 기안한 계약서(2026-10-21 — 직접 보낸 건은 재발송할 수 있어야 한다).
    // 계약 미연동 문서는 전사 범위·기안자에게만(2026-10-19 §7.7)
    const all = await listAgreementDocs({ q: sp.get("q"), limit: Number(sp.get("limit") ?? 200) });
    const visibleDocs = new Set(filterByVisibleContracts(all, visible, (d) => d.contractId).map((d) => d.docId));
    const docs = all.filter((d) => visibleDocs.has(d.docId) || d.drafterUserId === ctx.userId);
    return NextResponse.json({ docs });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
