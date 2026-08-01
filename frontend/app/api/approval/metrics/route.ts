import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import type { MetricItem } from "@/lib/analytics/metric-types";
import { deleteMetric, getMetric, listMetrics, saveMetric } from "@/lib/analytics/metric-store";
import { runMetric } from "@/lib/analytics/metric-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 지표 정의·실행 API(SW-P2, 운영자용 — 공개범위별 노출은 SW-P3 보드에서).
// GET: 목록 · GET ?run=<metricKey>: 실행(결과+진단 메타)
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const runKey = req.nextUrl.searchParams.get("run");
    if (runKey) {
      const item = await getMetric(runKey);
      if (!item) return NextResponse.json({ error: "지표를 찾을 수 없습니다." }, { status: 404 });
      const result = await runMetric(item, getMetric);
      return NextResponse.json({ result });
    }
    return NextResponse.json({ metrics: await listMetrics() });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}

// POST: 지표 저장(upsert) — body { metric } / 삭제 — body { deleteKey }
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as { metric?: Omit<MetricItem, "version" | "updatedAt">; deleteKey?: string };
    if (body.deleteKey) {
      await deleteMetric(String(body.deleteKey));
      await recordAuditLog({
        actorUserId: actor.userId,
        action: "approval_metric_update",
        targetTable: "metric_definitions",
        targetId: String(body.deleteKey),
        after: { deleted: true },
      });
      return NextResponse.json({ deleted: true });
    }
    if (!body.metric) return NextResponse.json({ error: "metric 이 필요합니다." }, { status: 400 });
    await saveMetric(body.metric, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_metric_update",
      targetTable: "metric_definitions",
      targetId: body.metric.metricKey,
      after: { label: body.metric.label },
    });
    return NextResponse.json({ saved: true });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
