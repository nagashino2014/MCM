import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, withDbWrite } from "@/lib/db";
import {
  INTEL_COLLECT_DEFAULTS,
  loadIntelSettings,
  saveIntelSettings,
} from "@/lib/intel/intel-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 수집 설정 조회 — 현재 유효값(merged)과 기본값을 함께 반환(설정 UI의 '기본값 복원' 표시용). */
export async function GET() {
  try {
    await requirePermission("sales.view");
    const settings = await loadIntelSettings(await getDb());
    return NextResponse.json({ settings, defaults: INTEL_COLLECT_DEFAULTS });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 수집 설정 저장 — 전달된 설정 전체(merged 형태)를 저장한다. 알 수 없는 키는 무시된다. */
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json().catch(() => null)) as { settings?: unknown } | null;
    if (!body || typeof body.settings !== "object" || body.settings === null) {
      return NextResponse.json({ error: "settings 객체가 필요합니다." }, { status: 400 });
    }
    const merged = await withDbWrite((db) => saveIntelSettings(db, body.settings, actor.userId));
    return NextResponse.json({ settings: merged });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
