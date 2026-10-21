import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getQuoteById, updateQuoteMeta } from "@/lib/quote/store";
import { canActOnQuote, canViewQuote, quoteActionFlags } from "@/lib/quote/access";
import type { QuoteRecipient, QuoteResult } from "@/lib/quote/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 견적 대장 단건
export async function GET(_req: NextRequest, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await requirePermission("approval.view");
    const { quoteId } = await params;
    const quote = await getQuoteById(quoteId);
    if (!quote) return NextResponse.json({ error: "견적을 찾을 수 없습니다." }, { status: 404 });
    // 열람은 전 직원(2026-10-21) — canEdit 으로 화면이 재발송·수신처 편집·결과 기입 버튼을 가린다
    if (!(await canViewQuote())) return NextResponse.json({ error: "이 견적을 볼 권한이 없습니다." }, { status: 403 });
    return NextResponse.json({ quote, ...(await quoteActionFlags(ctx.userId, quote.docId)) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PATCH: 수신처·참조 사후 편집 + 수주 결과(result) 기입. 권한: 기안자 본인(본인이 보낸 견적) 또는 approval.manage(2026-10-21).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await requirePermission("approval.view");
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
    if (!(await canActOnQuote(ctx.userId, quote.docId))) return NextResponse.json({ error: "본인이 보낸 견적만 고칠 수 있습니다." }, { status: 403 });
    await updateQuoteMeta(quoteId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
