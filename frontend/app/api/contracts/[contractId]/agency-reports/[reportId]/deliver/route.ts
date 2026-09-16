import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { deliverAgencyReport } from "@/lib/filings/agency-report-delivery";
import { getAgencyReport, isReportDeliveryMode, listAgencyReports } from "@/lib/filings/agency-reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string; reportId: string }>;
}

/**
 * 대행 실적 보고서 수동 발송(254) — 보류했던 건, 실무자를 막 지정한 건, 실패한 건을 다시 보낸다.
 * body: { mode?: mail | messenger | both } — 비우면 건별 → 설정 기본값. hold 는 받지 않는다(보류는 발송이 아니다).
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { contractId, reportId } = await ctx.params;
    const actor = await requirePermission("contract.edit", { fallbackRoles: ["editor"], target: { contractId } });
    const current = await getAgencyReport(reportId);
    if (!current || current.contractId !== contractId) {
      return NextResponse.json({ error: "신고 이력을 찾을 수 없습니다." }, { status: 404 });
    }
    if (!current.documentId) {
      return NextResponse.json({ error: "신고서 PDF 를 먼저 첨부해 주세요." }, { status: 400 });
    }
    const body = (await req.json().catch(() => ({}))) as { mode?: unknown };
    const mode = isReportDeliveryMode(body.mode) && body.mode !== "hold" ? body.mode : null;
    // 보류 상태에서 [발송] 을 누르면 기본값이 보류여도 보내야 한다 — 이때는 메일로 보낸다
    const effective = mode ?? (current.deliveryMode && current.deliveryMode !== "hold" ? current.deliveryMode : null);
    const delivery = await deliverAgencyReport(reportId, actor.userId, effective ?? undefined);
    const resolved = delivery?.status === "held" ? await deliverAgencyReport(reportId, actor.userId, "mail") : delivery;
    return NextResponse.json({ delivery: resolved, reports: await listAgencyReports(contractId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
