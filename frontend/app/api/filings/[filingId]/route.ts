import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getFiling, updateFilingStatus } from "@/lib/filings/store";
import type { FilingStatus } from "@/lib/filings/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set<FilingStatus>(["pending", "submitted", "skipped"]);

/** 단건 조회 — 로컬 자동 입력 도구(2단계)가 payload 를 받아 가는 진입점이기도 하다. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ filingId: string }> }) {
  try {
    await requirePermission("filing.view");
    const { filingId } = await ctx.params;
    const filing = await getFiling(filingId);
    if (!filing) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ filing });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 상태 변경 — submitted(제출 완료: 접수번호·제출일), skipped(제외: 사유), pending(되돌림). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ filingId: string }> }) {
  try {
    const actor = await requirePermission("filing.manage");
    const { filingId } = await ctx.params;
    const body = await req.json();
    const status = String(body?.status ?? "") as FilingStatus;
    if (!STATUSES.has(status)) return NextResponse.json({ error: "status 가 올바르지 않습니다." }, { status: 400 });
    const filing = await updateFilingStatus(filingId, actor.userId, {
      status,
      receiptNo: body?.receiptNo != null ? String(body.receiptNo) : null,
      note: body?.note != null ? String(body.note) : null,
      submittedAt: body?.submittedAt != null ? String(body.submittedAt) : null,
      agentRegisteredAt: body?.agentRegisteredAt != null ? String(body.agentRegisteredAt) : null,
    });
    return NextResponse.json({ filing });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
