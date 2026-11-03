import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listAccounts } from "@/lib/finance/journal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 매입 계정과목 목록(331·333) — journal_accounts 중 비용 계정만. 유형별로 더 추리는 일은 화면이
 * PURCHASE_ACCOUNT_CODES(lib/contracts/purchase/options.ts)로 하고, 서버 검증은 validate.ts 가 같은 표로 한다.
 * 재무 라우트(/api/finance/journal)는 finance.view 를 요구하므로 purchase.view 에서 읽는 얇은 라우트를 둔다(재무 코드 수정 없음).
 */
export async function GET() {
  try {
    await requirePermission("purchase.view");
    const accounts = (await listAccounts()).filter((a) => a.acctType === "expense");
    return NextResponse.json({ accounts });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
