import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { parseMetricDefinition } from "@/lib/analytics/metric-types";
import { getMetric } from "@/lib/analytics/metric-store";
import { runMetric } from "@/lib/analytics/metric-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 지표 정의를 저장 없이 실행(마법사 STEP 4 미리보기·품질 리포트) — body { definition, label? }
export async function POST(req: NextRequest) {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as { definition?: unknown; label?: string };
    const definition = parseMetricDefinition(body.definition);
    if (!definition) return NextResponse.json({ error: "정의 JSON 이 올바르지 않습니다." }, { status: 400 });
    const result = await runMetric(
      { metricKey: "__preview__", label: body.label?.trim() || "미리보기", definition },
      getMetric
    );
    return NextResponse.json({ result });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
