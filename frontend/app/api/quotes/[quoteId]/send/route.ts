import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDoc } from "@/lib/approval/docs";
import { processQuoteSend } from "@/lib/quote/send";
import { getQuoteById } from "@/lib/quote/store";
import { withDbWrite } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST: 재발송/수동 메일 발송(동기) — 기안자 본인 또는 approval.manage (공문 재발송과 동일 규약).
// direct 모드 대장도 이 라우트로 사후 메일 발송 가능(모드를 mail 로 전환 후 발송).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ quoteId: string }> }) {
  try {
    const ctx = await requirePermission("approval.view");
    const { quoteId } = await params;
    const quote = await getQuoteById(quoteId);
    if (!quote) return NextResponse.json({ error: "견적을 찾을 수 없습니다." }, { status: 404 });
    const doc = await getDoc(quote.docId);
    if (!doc) return NextResponse.json({ error: "결재 문서를 찾을 수 없습니다." }, { status: 404 });
    if (doc.drafterUserId !== ctx.userId) {
      try {
        await requirePermission("approval.manage");
      } catch {
        throw new AuthError("기안자 본인 또는 결재 관리 권한만 발송할 수 있습니다.", 403);
      }
    }
    // direct 모드에서 수동 메일 발송 요청 시 mail 로 전환
    if (quote.sendMode === "direct") {
      await withDbWrite(async (txn) => {
        await txn.run(`UPDATE quotations SET send_mode = 'mail', updated_at = $2 WHERE quote_id = $1`, [
          quoteId,
          new Date().toISOString(),
        ]);
      });
    }
    const result = await processQuoteSend(quote.docId);
    if (!result.ok) return NextResponse.json({ error: result.error ?? "발송 실패" }, { status: 500 });
    return NextResponse.json({ ok: true, skipped: result.skipped ?? false });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
