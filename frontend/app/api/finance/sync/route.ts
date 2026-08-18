// 재무 수집 실행 API — POST: 수동/강제 수집 (EventBridge Scheduler 호출도 이 엔드포인트 재사용 가능)
// 자동 catch-up 은 /api/finance/connections GET 이 stale 판정 시 백그라운드로 수행.

import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { runFinanceSync, isSyncStale } from "@/lib/barobill/sync";
import { listSyncLogs } from "@/lib/barobill/queries";
import { BarobillError } from "@/lib/barobill/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePermission("finance.view");
    const [stale, logs] = await Promise.all([isSyncStale(), listSyncLogs(60)]);
    return NextResponse.json({ stale, logs });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("finance.manage");
    const force = req.nextUrl.searchParams.get("force") === "1";
    // 수집 기간 지정(옵션): { from: "YYYY-MM-DD", to: "YYYY-MM-DD" } — 지정 시 증분 대신 강제 기간 수집
    const body = (await req.json().catch(() => ({}))) as { from?: string; to?: string };
    const toYmd = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.replace(/-/g, "") : null);
    const start = toYmd(body.from);
    const end = toYmd(body.to);
    if ((body.from || body.to) && (!start || !end)) {
      return NextResponse.json({ error: "기간은 YYYY-MM-DD 형식의 from/to 둘 다 필요합니다." }, { status: 400 });
    }
    if (start && end && start > end) {
      return NextResponse.json({ error: "시작일이 종료일보다 늦습니다." }, { status: 400 });
    }
    const range = start && end ? { start, end } : undefined;
    const result = await runFinanceSync({ force, range });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "finance_sync_run",
      targetTable: "finance_sync_logs",
      targetId: range ? `manual-range:${start}-${end}` : force ? "manual-force" : "manual",
      after: { ran: result.ran, targets: result.targets.length },
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BarobillError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return authErrorToResponse(err);
  }
}
