import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission, requireSession } from "@/lib/auth/guards";
import { getDoc } from "@/lib/approval/docs";
import { processLetterSend } from "@/lib/letter/send";
import { getLetterById } from "@/lib/letter/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST: 공문 발송 재시도 — 발송 실패(failed)·대기(pending) 건을 동기 재실행한다.
// 발송 완료(sent) 건의 재발송은 회수 → 수정 → 재결재 경유(2026-08-19 사용자 확정,
// /api/approval/docs/[docId]/recall). 권한: 기안자 본인 또는 approval.manage.
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
    const result = await processLetterSend(letter.docId);
    if (!result.ok) return NextResponse.json({ error: result.error ?? "발송 실패" }, { status: 500 });
    return NextResponse.json({ ok: true, skipped: result.skipped ?? false, letter: await getLetterById(letterId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
