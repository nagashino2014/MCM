import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listIntegrationHealth } from "@/lib/ops/integration-watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/integrations — 외부 연동 상태(316 integration_health) 목록. 판정은 감시 틱·[지금 점검]이 갱신한다.
export async function GET() {
  try {
    await requirePermission("ops.integration.view");
    const rows = await listIntegrationHealth();
    return NextResponse.json({ rows });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
