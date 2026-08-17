import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  buildTripLogWorkbook,
  deleteTripLog,
  listTripLogs,
  saveTripLog,
  syncTripLogsFromDocs,
  tripLogYearlySummary,
  updateTripLogDistance,
} from "@/lib/assets/trip-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 운행기록 목록/연간 요약. format=xlsx → 운행기록부 다운로드
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const sp = req.nextUrl.searchParams;
    const year = Number(sp.get("year") ?? 0) || new Date().getFullYear();
    const assetId = sp.get("assetId") || undefined;
    if (sp.get("format") === "xlsx") {
      const buf = await buildTripLogWorkbook(year, assetId);
      const filename = encodeURIComponent(`운행기록부_${year}.xlsx`);
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
        },
      });
    }
    const month = sp.get("month") || undefined;
    const [logs, summary] = await Promise.all([listTripLogs({ year, month, assetId }), tripLogYearlySummary(year)]);
    return NextResponse.json({ year, logs, summary });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  action?: "sync" | "save" | "update_distance" | "delete";
  year?: number;
  logId?: string;
  assetId?: string;
  driveDate?: string;
  driverName?: string | null;
  useKind?: string;
  purpose?: string | null;
  distanceKm?: number | null;
  memo?: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("finance.manage");
    const body = (await req.json().catch(() => ({}))) as PostBody;

    if (body.action === "sync") {
      const year = Number(body.year ?? 0) || new Date().getFullYear();
      const result = await syncTripLogsFromDocs(year);
      await recordAuditLog({
        actorUserId: ctx.userId,
        action: "trip_log_sync",
        targetTable: "vehicle_trip_logs",
        targetId: String(year),
        after: { ...result },
      });
      return NextResponse.json(result);
    }
    if (body.action === "save") {
      if (!body.assetId || !/^\d{4}-\d{2}-\d{2}$/.test(String(body.driveDate ?? ""))) {
        return NextResponse.json({ error: "차량·일자(YYYY-MM-DD)가 필요합니다." }, { status: 400 });
      }
      const logId = await saveTripLog({
        logId: body.logId,
        assetId: String(body.assetId),
        driveDate: String(body.driveDate),
        driverName: body.driverName,
        useKind: body.useKind,
        purpose: body.purpose,
        distanceKm: body.distanceKm == null ? null : Number(body.distanceKm),
        memo: body.memo,
      });
      return NextResponse.json({ logId });
    }
    if (!body.logId) return NextResponse.json({ error: "logId 가 필요합니다." }, { status: 400 });
    if (body.action === "update_distance") {
      await updateTripLogDistance(body.logId, body.distanceKm == null ? null : Number(body.distanceKm), body.memo);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "delete") {
      await deleteTripLog(body.logId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "action 이 올바르지 않습니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
