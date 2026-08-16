// 홈 위젯 — 재무 알림(P5): 미분류 카드 건 · 수금 대조 대기 · 세금계산서 전송실패.
// finance.view 가 없으면 403 → 위젯이 스스로 숨는다(useHomeWidget forbidden 규약).

import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("finance.view");
    const db = await getDb();

    // 미분류 카드 매입 건 — 현재 분기 기준(부가세 준비의 실작업 단위).
    const now = new Date(Date.now() + 9 * 3600 * 1000);
    const q = Math.floor(now.getUTCMonth() / 3);
    const qStart = `${now.getUTCFullYear()}-${String(q * 3 + 1).padStart(2, "0")}-01`;

    const [cardRows, reconRows, ntsRows] = await Promise.all([
      db.exec(
        `SELECT count(*) AS n FROM card_transactions
          WHERE category_key IS NULL AND excluded = 0 AND approval_type = '승인' AND approved_at >= $1`,
        [`${qStart} 00:00:00`],
      ),
      db.exec(
        `SELECT
           COUNT(*) FILTER (WHERE s.confidence >= 90 AND s.has_lines) AS high,
           COUNT(*) FILTER (WHERE s.confidence >= 55 AND s.confidence < 90 AND s.has_lines) AS review
         FROM (
           SELECT COALESCE(m.confidence, 0) AS confidence,
                  EXISTS (SELECT 1 FROM recon_match_lines l WHERE l.match_id = m.match_id) AS has_lines
             FROM recon_matches m WHERE m.status = 'suggested'
         ) s`,
      ),
      db.exec(`SELECT count(*) AS n FROM tax_invoices WHERE nts_send_state = 5 AND canceled_at IS NULL`),
    ]);

    return NextResponse.json({
      unclassified: Number(rowsToObjects(cardRows)[0]?.n || 0),
      quarterStart: qStart,
      reconHigh: Number(rowsToObjects(reconRows)[0]?.high || 0),
      reconReview: Number(rowsToObjects(reconRows)[0]?.review || 0),
      ntsFailed: Number(rowsToObjects(ntsRows)[0]?.n || 0),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
