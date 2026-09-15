import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listLetterReviews, sendLetterReview } from "@/lib/letter/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET: 한 공문의 사전 검수 이력(최근순) — 작성 화면이 회차·검수자를 보여준다.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const docId = req.nextUrl.searchParams.get("docId")?.trim();
    if (!docId) return NextResponse.json({ error: "docId 가 필요합니다." }, { status: 400 });
    return NextResponse.json({ reviews: await listLetterReviews(docId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 사전 검수 요청 — 상신 전 공문(안) PDF·첨부서류를 사내 검수자 메일로 보낸다.
// 문서는 화면에서 먼저 임시저장하고 docId 를 넘긴다(본인 기안 문서만 허용 — review.ts 에서 검사).
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const body = (await req.json()) as {
      docId?: string;
      reviewerIds?: string[];
      note?: string;
      target?: "personal" | "company";
    };
    const docId = body?.docId?.trim();
    if (!docId) return NextResponse.json({ error: "docId 가 필요합니다." }, { status: 400 });
    if (!Array.isArray(body?.reviewerIds) || body.reviewerIds.length === 0) {
      return NextResponse.json({ error: "검수자를 1명 이상 선택하세요." }, { status: 400 });
    }
    const result = await sendLetterReview({
      docId,
      requesterUserId: ctx.userId,
      reviewerIds: body.reviewerIds,
      note: body.note,
      target: body.target === "company" ? "company" : "personal",
    });
    if (!result.ok) return NextResponse.json({ error: result.error ?? "검수 요청 발송 실패" }, { status: 400 });
    return NextResponse.json({ ok: true, reviewers: result.reviewers, attachNames: result.attachNames });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
