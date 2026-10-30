import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listIntegrationHealth, runIntegrationWatch } from "@/lib/ops/integration-watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST /api/admin/integrations/check — [지금 점검]. 틱과 같은 판정·전이라 이상·복구가 생기면 알림도 나간다
//   (이미 알린 지속 이상은 24시간 안에 다시 보내지 않는다).
export async function POST() {
  try {
    await requirePermission("ops.integration.view");
    const summary = await runIntegrationWatch();
    const rows = await listIntegrationHealth();
    return NextResponse.json({ summary, rows });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
