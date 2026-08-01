import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import type { MetricItem } from "@/lib/analytics/metric-types";
import { getMetric, listMetrics } from "@/lib/analytics/metric-store";
import { runMetric } from "@/lib/analytics/metric-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * 지표 보드 조회 API(SW-P3) — 일반 사용자용. 공개범위(§8-2) 필터:
 * 관리(approval.manage) 권한자는 전부, 그 외에는 visibility='all' 또는 자신이 만든 owner 지표만.
 * 정의 편집·미리보기는 /api/approval/metrics(+/preview) 쪽(manage 전용).
 */

async function resolveAccess(): Promise<{ userId: string; manager: boolean; nlq: boolean }> {
  let userId = "";
  let manager = false;
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    userId = actor.userId;
    manager = true;
  } catch {
    const actor = await requirePermission("approval.view");
    userId = actor.userId;
  }
  let nlq = manager; // admin fallback 은 ask 라우트와 동일 기준
  if (!nlq) {
    try {
      await requirePermission("reports.nlq");
      nlq = true;
    } catch {
      nlq = false;
    }
  }
  return { userId, manager, nlq };
}

function visible(m: MetricItem, access: { userId: string; manager: boolean }): boolean {
  if (access.manager) return true;
  if (m.visibility === "all") return true;
  if (m.visibility === "owner") return m.createdBy === access.userId;
  return false;
}

// GET: 조회 가능한 지표 목록 · ?run=<metricKey>: 실행(결과+진단 메타)
export async function GET(req: NextRequest) {
  try {
    const access = await resolveAccess();
    const metrics = (await listMetrics(true)).filter((m) => visible(m, access));
    const runKey = req.nextUrl.searchParams.get("run");
    if (runKey) {
      const item = metrics.find((m) => m.metricKey === runKey);
      if (!item) return NextResponse.json({ error: "지표를 찾을 수 없거나 조회 권한이 없습니다." }, { status: 404 });
      const result = await runMetric(item, getMetric);
      return NextResponse.json({ result });
    }
    return NextResponse.json({ metrics, manager: access.manager, nlqAllowed: access.nlq });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
