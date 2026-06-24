import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { listStageTemplates } from "@/lib/contracts/process-stages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 용역분류별 표준 공정 단계 — 계약 공정표 생성 시 기본값으로 적용.
export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
    const serviceType = new URL(req.url).searchParams.get("serviceType") ?? "";
    return NextResponse.json({ stages: await listStageTemplates(serviceType) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
