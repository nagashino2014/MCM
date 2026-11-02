import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listAccounts } from "@/lib/finance/journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 매입 계정과목 목록(331) — journal_accounts 중 비용·자산 계정. 재무 라우트(/api/finance/journal)는
 * finance.view 를 요구하므로 매입 계약 화면용으로 purchase.view 에서 읽는 얇은 라우트를 둔다(재무 코드 수정 없음).
 */
export async function GET() {
  try {
    await requirePermission("purchase.view");
    const accounts = (await listAccounts()).filter((a) => a.acctType === "expense" || a.acctType === "asset");
    return NextResponse.json({ accounts });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
