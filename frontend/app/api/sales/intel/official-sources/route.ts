import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listOfficialSources, updateOfficialSource } from "@/lib/intel/official-sources";
import { OfficialSourceError } from "@/lib/intel/official-sources-policy";
import { loadUserAccess } from "@/lib/auth/rbac";
import { canManageOfficialSources } from "@/lib/intel/official-sources-access";
import { refreshBriefingWakeup } from "@/lib/intel/briefing-scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requirePermission("sales.view");
    return NextResponse.json({ sources: await listOfficialSources(), canManage: canManageOfficialSources(await loadUserAccess(actor.userId)) });
  } catch (error) { return authErrorToResponse(error); }
}
export async function PUT(request: NextRequest) {
  try {
    const actor = await requirePermission("sales.edit");
    if (!canManageOfficialSources(await loadUserAccess(actor.userId))) throw new OfficialSourceError("공식 정보원 설정은 전사 영업 편집 권한이 필요합니다.", 403);
    if (Number(request.headers.get("content-length") ?? 0) > 40_000) throw new OfficialSourceError("설정 내용이 너무 큽니다.", 413);
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > 40_000) throw new OfficialSourceError("설정 내용이 너무 큽니다.", 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { throw new OfficialSourceError("설정 내용을 확인하세요."); }
    const source = await updateOfficialSource(body, actor.userId);
    await refreshBriefingWakeup().catch(() => console.warn("[official-sources] wake_hint_refresh_failed"));
    return NextResponse.json({ source });
  } catch (error) { return authErrorToResponse(error); }
}
