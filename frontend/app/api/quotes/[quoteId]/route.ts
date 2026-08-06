import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getQuoteById, updateQuoteMeta } from "@/lib/quote/store";
import type { QuoteRecipient, QuoteResult } from "@/lib/quote/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 견적 대장 단건
export async function GET(_req: NextRequest, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    await requirePermission("approval.view");
    const { quoteId } = await params;
    const quote = await getQuoteById(quoteId);
    if (!quote) return NextResponse.json({ error: "견적을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ quote });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PATCH: 수신처·참조 사후 편집 + 수주 결과(result) 기입. 권한: approval.manage.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    await requirePermission("approval.manage");
    const { quoteId } = await params;
    const body = (await req.json()) as {
      recipients?: QuoteRecipient[];
      ccRefs?: QuoteRecipient[];
      result?: QuoteResult;
      resultNote?: string | null;
      resultAt?: string | null;
      resultAmount?: number | null;
      resultReason?: string | null;
      contractId?: string | null;
    };
    const quote = await getQuoteById(quoteId);
    if (!quote) return NextResponse.json({ error: "견적을 찾을 수 없습니다." }, { status: 404 });
    await updateQuoteMeta(quoteId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
