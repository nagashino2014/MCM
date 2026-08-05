import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 다음 채번 예정 공문번호 — 작성 화면 상단 표시용(실제 확정은 상신 시 allocateDocNo).
// 반납 풀(doc_no_pool)의 최소 결번이 있으면 그 번호를, 없으면 시퀀스 다음 번호를 보여준다.
export async function GET() {
  try {
    await requirePermission("approval.view");
    const db = await getDb();
    const year = new Date().getFullYear().toString();
    const pool = rowsToObjects(
      await db.exec(`SELECT min(seq) AS seq FROM doc_no_pool WHERE rule_key = '대외' AND year = $1`, [year])
    );
    let seq = pool[0]?.seq != null ? Number(pool[0].seq) : null;
    if (seq == null) {
      const rows = rowsToObjects(
        await db.exec(`SELECT last_seq FROM doc_no_sequences WHERE rule_key = '대외' AND year = $1`, [year])
      );
      seq = rows.length ? Number(rows[0].last_seq) + 1 : 1001;
    }
    return NextResponse.json({ nextNo: `${year}-대외-${String(seq).padStart(5, "0")}` });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
