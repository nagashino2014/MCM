import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listAgreementDocs } from "@/lib/agreement/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 계약서 보드 목록 — frm-agreement 결재 문서 + 대장 발송 상태. ?q=검색.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("contract.view");
    const sp = req.nextUrl.searchParams;
    const docs = await listAgreementDocs({ q: sp.get("q"), limit: Number(sp.get("limit") ?? 200) });
    return NextResponse.json({ docs });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
