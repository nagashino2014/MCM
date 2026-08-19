import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission, requireSession } from "@/lib/auth/guards";
import { getDoc } from "@/lib/approval/docs";
import { processLetterSend } from "@/lib/letter/send";
import { getLetterById } from "@/lib/letter/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST: 공문 재발송 — 발송 실패(failed)·대기(pending)는 물론 발송 완료(sent) 건도
// 재발송한다(194 — 발주처 사정 재발송, 이력은 send_history 에 N차로 누적).
// 권한: 기안자 본인 또는 approval.manage.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ letterId: string }> }) {
  try {
    const ctx = await requireSession();
    const { letterId } = await params;
    const letter = await getLetterById(letterId);
    if (!letter) return NextResponse.json({ error: "공문을 찾을 수 없습니다." }, { status: 404 });
    if (!letter.docId) return NextResponse.json({ error: "과거 이관 공문은 발송 대상이 아닙니다." }, { status: 400 });

    const doc = await getDoc(letter.docId);
    if (doc?.drafterUserId !== ctx.userId) {
      await requirePermission("approval.manage");
    }
    const result = await processLetterSend(letter.docId, { allowResend: true });
    if (!result.ok) return NextResponse.json({ error: result.error ?? "발송 실패" }, { status: 500 });
    return NextResponse.json({ ok: true, skipped: result.skipped ?? false, letter: await getLetterById(letterId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
