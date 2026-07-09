import { NextRequest, NextResponse } from "next/server";
import { requirePermission, authErrorToResponse } from "@/lib/auth/guards";
import { withDbWrite } from "@/lib/db";
import { buildEnrichCandidates, ensureDartCorpCache } from "@/lib/ieps/facility-enrich";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// corpCode 캐시 최초 적재(11만 건) 시 오래 걸릴 수 있다.
export const maxDuration = 300;

const MAX_IDS = 20;

/** 누락 점검 화면 — 대상 사업장들의 보완 후보 조회(DART). 저장하지 않는다. */
export async function POST(req: NextRequest) {
  try {
    await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json().catch(() => ({}))) as { facilityIds?: unknown };
    const facilityIds = Array.isArray(body.facilityIds)
      ? body.facilityIds.map((v) => String(v)).filter(Boolean).slice(0, MAX_IDS)
      : [];
    if (facilityIds.length === 0) {
      return NextResponse.json({ error: "facilityIds가 비어 있습니다." }, { status: 400 });
    }
    const candidates = await withDbWrite(async (db) => {
      await ensureDartCorpCache(db);
      return buildEnrichCandidates(db, facilityIds);
    });
    return NextResponse.json({ candidates });
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (msg.includes("DART_API_KEY")) {
      return NextResponse.json(
        { error: "DART_API_KEY가 설정되지 않아 자동 보완을 사용할 수 없습니다." },
        { status: 503 }
      );
    }
    return authErrorToResponse(err);
  }
}
