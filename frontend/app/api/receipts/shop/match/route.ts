/**
 * 쇼핑몰 전표 ↔ 법인카드 원장 매칭 API
 *
 *   POST  {from, to}                → 기간 자동 매칭 실행
 *   PATCH {receiptId, txnId|null}   → 수동 연결 / 해제
 *   GET   ?receiptId=               → 수동 연결 후보 원장 건 목록
 *
 * 어디서든 동작한다(스테이징 DB 위에서 돈다 — 수집처럼 로컬 전용이 아니다).
 */

import { NextRequest, NextResponse } from "next/server";

import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listCandidates, runAutoMatch, setExcluded, setManualMatch } from "@/lib/receipts/shop-receipt-match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: NextRequest) {
  try {
    await requirePermission("finance.manage");
  } catch (err) {
    return authErrorToResponse(err);
  }

  const body = (await req.json().catch(() => ({}))) as { from?: string; to?: string };
  if (!body.from || !DATE_RE.test(body.from) || !body.to || !DATE_RE.test(body.to)) {
    return NextResponse.json({ error: "기간 형식이 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const result = await runAutoMatch(body.from, body.to);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requirePermission("finance.manage");
  } catch (err) {
    return authErrorToResponse(err);
  }

  const body = (await req.json().catch(() => ({}))) as {
    receiptId?: string;
    txnId?: string | null;
    excluded?: boolean;
  };
  if (!body.receiptId) {
    return NextResponse.json({ error: "receiptId 가 필요합니다." }, { status: 400 });
  }

  try {
    if (typeof body.excluded === "boolean") {
      await setExcluded(body.receiptId, body.excluded);
    } else {
      await setManualMatch(body.receiptId, body.txnId ?? null);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
  } catch (err) {
    return authErrorToResponse(err);
  }

  const receiptId = req.nextUrl.searchParams.get("receiptId") ?? "";
  if (!receiptId) return NextResponse.json({ error: "receiptId 가 필요합니다." }, { status: 400 });

  try {
    return NextResponse.json({ candidates: await listCandidates(receiptId) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
