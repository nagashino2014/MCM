import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getContractRoster } from "@/lib/staffing/roster";
import { renderRosterPdf } from "@/lib/staffing/roster-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ contractId: string }>;
}

// GET: 용역수행 기술인력 명단 PDF 다운로드
export async function GET(_: NextRequest, ctx: RouteContext) {
  try {
    const { contractId } = await ctx.params;
    const actor = await requirePermission("contract.view", { target: { contractId } });
    const roster = await getContractRoster(contractId);
    if (!roster) {
      return NextResponse.json({ error: "계약을 찾을 수 없습니다." }, { status: 404 });
    }
    const pdf = await renderRosterPdf(roster);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_update",
      targetTable: "service_participants",
      targetId: contractId,
      after: { kind: "roster_pdf", count: roster.rows.length },
    });
    const filename = `용역수행 기술인력(${roster.serviceName}).pdf`;
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
