/**
 * 쇼핑몰 전표 불러오기(기안 피커, 2026-09-15) — 지출결의서(법인카드) 기안 화면에서 품목이 나오는
 * 쇼핑몰 전표를 골라 표 행·첨부로 담는다. 재무 화면의 records 와 달리 approval.view 권한이면 된다
 * (기안자는 재무 권한이 없다). 매칭 제외(개인 결제) 건은 빼고, 이미 다른 문서에 실린 건은 표시만 한다.
 */

import { NextRequest, NextResponse } from "next/server";

import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listShopReceipts } from "@/lib/receipts/shop-receipt-store";
import { SHOPS, shopByKey } from "@/lib/receipts/shops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
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
      keyword: params.get("keyword") ?? undefined,
      excludeExcluded: true,
      limit: 300,
    });
    const items = rows.map((r) => ({
      receiptId: r.receiptId,
      site: r.site,
      siteName: shopByKey(r.site)?.name ?? r.site,
      orderNo: r.orderNo,
      orderDate: r.orderDate,
      title: r.title,
      amount: r.amount,
      receiptType: r.receiptType,
      cardLast4: r.cardLast4,
      approvalNum: r.approvalNum,
      storageKey: r.storageKey,
      fileName: r.fileName ?? (r.storageKey ? r.storageKey.split("/").pop() ?? null : null),
      matchedTxnId: r.matchedTxnId,
      matchedTxn: r.matchedTxn,
      docId: r.docId,
    }));
    return NextResponse.json({ items, sites: SHOPS.map((s) => ({ key: s.key, name: s.name })) });
  } catch (err) {
    // 마이그레이션(196/224) 전이면 빈 목록 + 사유.
    return NextResponse.json({ items: [], sites: [], error: (err as Error).message }, { status: 200 });
  }
}
