import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listFilings, loadFilingSettings, syncFilings } from "@/lib/filings/store";
import type { FilingKind, FilingStatus } from "@/lib/filings/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 신고 대기열 목록 — 호출 시 MCM 데이터에서 대기열을 재파생(멱등)한 뒤 반환한다. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("filing.view");
    const sp = req.nextUrl.searchParams;
    const status = (sp.get("status") || "pending") as FilingStatus | "all";
    const kind = (sp.get("kind") || "all") as FilingKind | "all";
    if (sp.get("sync") !== "0") await syncFilings();
    const [filings, settings] = await Promise.all([listFilings({ status, kind }), loadFilingSettings()]);
    return NextResponse.json({ filings, settings });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
