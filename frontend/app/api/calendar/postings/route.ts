// 면접 일정 등록용 채용공고 목록(제목만) — 면접 관리자 전용(recruit.view 가 없어도 공고명은 골라야 한다).

import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { loadEntryAccess } from "@/lib/calendar/entries";
import { listPostings } from "@/lib/recruit/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await requireSession();
    const access = await loadEntryAccess(ctx.userId);
    if (!access.interview) return NextResponse.json({ error: "면접 관리자만 조회할 수 있습니다." }, { status: 403 });
    const postings = (await listPostings()).map((p) => ({ postingId: p.postingId, title: p.title, status: p.status }));
    return NextResponse.json({ postings });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
