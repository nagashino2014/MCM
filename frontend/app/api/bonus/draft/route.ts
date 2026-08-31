import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin, requirePermission } from "@/lib/auth/guards";
import { parsePeriod } from "@/lib/bonus/source";
import { createBonusPlanDraft, getBonusPlanApproval } from "@/lib/bonus/draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 반기 성과급 기안 상태 조회 — 명세서 발송 게이트(승인 전 발송 불가)의 근거. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("bonus.view", { fallbackRoles: ["editor"] });
    const p = parsePeriod(new URL(req.url).searchParams.get("period") ?? "");
    if (!p) return NextResponse.json({ error: "period 형식은 YYYY-H1/H2 입니다." }, { status: 400 });
    return NextResponse.json({ plan: await getBonusPlanApproval(p) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

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
