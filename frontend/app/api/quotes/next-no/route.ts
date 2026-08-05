import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { quoteRuleKey, QUOTE_RULE_PREFIX } from "@/lib/quote/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 다음 채번 예정 견적번호 — 작성 화면 표시용(확정은 상신 시 allocateDocNo).
// ?serviceType=통합허가 등 대분류에 따라 5종 시퀀스로 분기(136).
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const serviceType = req.nextUrl.searchParams.get("serviceType") ?? "기타";
    const ruleKey = quoteRuleKey(serviceType);
    const db = await getDb();
    const year = new Date().getFullYear().toString();
    const pool = rowsToObjects(
      await db.exec(`SELECT min(seq) AS seq FROM doc_no_pool WHERE rule_key = $1 AND year = $2`, [ruleKey, year])
    );
    let seq = pool[0]?.seq != null ? Number(pool[0].seq) : null;
    if (seq == null) {
      const rows = rowsToObjects(
        await db.exec(`SELECT last_seq FROM doc_no_sequences WHERE rule_key = $1 AND year = $2`, [ruleKey, year])
      );
      seq = rows.length ? Number(rows[0].last_seq) + 1 : 1;
    }
    return NextResponse.json({ nextNo: `${year}-${ruleKey.slice(QUOTE_RULE_PREFIX.length)}-${String(seq).padStart(4, "0")}` });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
