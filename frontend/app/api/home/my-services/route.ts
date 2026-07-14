import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listMyServices } from "@/lib/work-plan/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 내 참여 용역 진행 현황 — 세션 사용자가 수행인력(service_participants)으로 등록된 계약의
 * 현재 공정 단계·진행률. listMyServices 재사용. 관리자 등 미참여 계정은 빈 배열.
 */
export async function GET() {
  try {
    const ctx = await requireSession();
    const rows = await listMyServices(ctx.userId);
    const services = rows.map((s) => ({
      contractId: s.contractId,
      contractTitle: s.contractTitle,
      counterpartyName: s.counterpartyName,
      serviceType: s.serviceType,
      contractStatus: s.contractStatus,
      lastStage: s.lastStage,
      lastPct: s.lastPct,
      stageIndex: s.stageIndex,
      stageTotal: s.stageTotal,
      completed: s.completed,
    }));
    return NextResponse.json({ services });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
