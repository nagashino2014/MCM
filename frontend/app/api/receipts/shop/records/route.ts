/**
 * 쇼핑몰 전표 — 올라온 전표 조회
 *
 * 개인 PC 에서 올린 전표를 기간·몰로 걸러 보여준다. 수집과 달리 **어디서든** 동작한다
 * (스테이징에서 부가세 신고를 하면서 보는 화면이 이것이다).
 */

import { NextRequest, NextResponse } from "next/server";

import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listShopReceipts } from "@/lib/receipts/shop-receipt-store";
import { listUncoveredShopTxns } from "@/lib/receipts/shop-receipt-match";
import { shopByKey } from "@/lib/receipts/shops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
  } catch (err) {
    return authErrorToResponse(err);
  }

  const params = req.nextUrl.searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const site = params.get("site") ?? "";

  try {
    const rows = await listShopReceipts({
      from: DATE_RE.test(from) ? from : undefined,
      to: DATE_RE.test(to) ? to : undefined,
      site: shopByKey(site) ? site : undefined,
    });

    // 원장 기준 커버리지 — 쇼핑몰 결제로 보이는데 전표가 안 붙은 건(수집 누락 확인용)
    const uncovered =
      DATE_RE.test(from) && DATE_RE.test(to)
        ? await listUncoveredShopTxns(from, to).catch(() => [])
        : [];

    const total = rows.reduce((sum, r) => sum + r.amount, 0);
    return NextResponse.json({ rows, count: rows.length, total, uncovered });
  } catch (err) {
    // 마이그레이션(196) 전이면 테이블이 없다 — 화면이 빈 목록으로 뜨도록 사유만 알려 준다.
    return NextResponse.json({ rows: [], count: 0, total: 0, error: (err as Error).message }, { status: 200 });
  }
}
