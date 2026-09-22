import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { NOTICE_RULE_KEY } from "@/lib/notice/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 내부고시 채번 예정 번호 — 작성 화면 상단 표시용. 확정은 상신 시(allocateDocNo).
// 반납 풀(doc_no_pool)의 최소 번호가 있으면 그것, 없으면 시퀀스 + 1(신규 연도 01001).
export async function GET() {
  try {
    await requirePermission("approval.view");
    const year = String(new Date().getFullYear());
    const db = await getDb();
    const pool = rowsToObjects(
      await db.exec(`SELECT min(seq) AS seq FROM doc_no_pool WHERE rule_key = $1 AND year = $2`, [NOTICE_RULE_KEY, year])
    );
    let seq = pool[0]?.seq != null ? Number(pool[0].seq) : null;
    if (seq == null) {
      const rows = rowsToObjects(
        await db.exec(`SELECT last_seq FROM doc_no_sequences WHERE rule_key = $1 AND year = $2`, [NOTICE_RULE_KEY, year])
      );
      seq = rows.length ? Number(rows[0].last_seq) + 1 : 1001;
    }
    return NextResponse.json({ nextNo: `${year}-${NOTICE_RULE_KEY}-${String(seq).padStart(5, "0")}호` });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
