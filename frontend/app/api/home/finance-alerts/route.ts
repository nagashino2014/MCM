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

    const [cardRows, reconRows, ntsRows, journalRows] = await Promise.all([
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
      // 전표 확정 큐(P3) — 계정 미확정 자동분개. 마이그 178 적용 전엔 테이블이 없으므로 0 폴백.
      db.exec(`SELECT count(*) AS n FROM journal_entries WHERE status = 'pending'`).catch(() => null),
    ]);

    // 신고·납부 기한 D-day (P7) — 원천세(매월 10일)·부가세(1/25·4/25·7/25·10/25). D-10 이내만 노출.
    const todayYmd = now.toISOString().slice(0, 10);
    const dday = (due: string) =>
      Math.round((new Date(`${due}T00:00:00Z`).getTime() - new Date(`${todayYmd}T00:00:00Z`).getTime()) / 86400000);
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth() + 1;
    const pad = (n: number) => String(n).padStart(2, "0");
    const candidates: Array<{ kind: string; label: string; dueDate: string }> = [
      { kind: "withholding", label: "원천세 신고·납부", dueDate: `${y}-${pad(m)}-10` },
      { kind: "withholding", label: "원천세 신고·납부", dueDate: m === 12 ? `${y + 1}-01-10` : `${y}-${pad(m + 1)}-10` },
      ...[1, 4, 7, 10].flatMap((vm) => [
        { kind: "vat", label: "부가세 신고·납부", dueDate: `${y}-${pad(vm)}-25` },
        { kind: "vat", label: "부가세 신고·납부", dueDate: `${y + 1}-${pad(vm)}-25` },
      ]),
    ];
    const taxDeadlines = candidates
      .map((c) => ({ ...c, dday: dday(c.dueDate) }))
      .filter((c) => c.dday >= 0 && c.dday <= 10)
      .sort((a, b) => a.dday - b.dday)
      .filter((c, i, arr) => arr.findIndex((x) => x.kind === c.kind) === i); // 종류별 가장 임박한 것만

    return NextResponse.json({
      unclassified: Number(rowsToObjects(cardRows)[0]?.n || 0),
      quarterStart: qStart,
      reconHigh: Number(rowsToObjects(reconRows)[0]?.high || 0),
      reconReview: Number(rowsToObjects(reconRows)[0]?.review || 0),
      ntsFailed: Number(rowsToObjects(ntsRows)[0]?.n || 0),
      journalPending: journalRows ? Number(rowsToObjects(journalRows)[0]?.n || 0) : 0,
      taxDeadlines,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
