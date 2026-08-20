// 법인카드 전자 전표 확보 API — 기안 화면이 카드 건을 표에 담을 때 호출한다.
// 대부분은 야간 배치(card-slip-tick)가 이미 만들어 둔 key 를 그대로 돌려주고,
// 아직 없는 최신 건만 그 자리에서 생성한다(선택 건 수만큼이라 지연이 짧다).
// 권한: approval.view — 카드 피커와 같은 기준(법인카드는 공용 운영).

import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { cardSlipName, ensureCardSlips } from "@/lib/finance/card-slip";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const body = (await req.json().catch(() => ({}))) as { cardTxnIds?: unknown };
    const ids = Array.isArray(body.cardTxnIds)
      ? body.cardTxnIds.map(String).filter(Boolean).slice(0, 100)
      : [];
    if (!ids.length) return NextResponse.json({ slips: [] });

    const keys = await ensureCardSlips(ids);
    // 첨부 표시명은 상호·승인일 기준(목록과 같은 규약).
    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(`SELECT card_txn_id, store_name, approved_at FROM card_transactions WHERE card_txn_id = ANY($1::text[])`, [
        ids,
      ]),
    );
    const slips = rows
      .filter((r) => keys.has(String(r.card_txn_id)))
      .map((r) => ({
        cardTxnId: String(r.card_txn_id),
        key: keys.get(String(r.card_txn_id))!,
        name: cardSlipName((r.store_name as string | null) ?? null, String(r.approved_at ?? "")),
      }));
    return NextResponse.json({ slips });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
