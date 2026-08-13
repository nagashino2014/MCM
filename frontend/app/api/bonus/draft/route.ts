import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { parsePeriod } from "@/lib/bonus/source";
import { createBonusPlanDraft } from "@/lib/bonus/draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 성과급 지급 계획 기안(draft) 생성 — 관리자 전용, 결재선=대표이사 직결. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const body = await req.json();
    const p = parsePeriod(String(body?.period ?? ""));
    if (!p) return NextResponse.json({ error: "period 형식은 YYYY-H1/H2 입니다." }, { status: 400 });
    const { docId } = await createBonusPlanDraft(ctx.userId, p);
    return NextResponse.json({ ok: true, docId, href: `/approval/draft?docId=${docId}` });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 400) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
