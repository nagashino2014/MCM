import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { collectOfficialSource } from "@/lib/intel/official-sources";
import { OfficialSourceError, officialProviderId } from "@/lib/intel/official-sources-policy";
import { loadUserAccess } from "@/lib/auth/rbac";
import { canManageOfficialSources } from "@/lib/intel/official-sources-access";
import { refreshBriefingWakeup } from "@/lib/intel/briefing-scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_request: Request, context: { params: Promise<{ providerId: string }> }) {
  try {
    const actor = await requirePermission("sales.edit");
    if (!canManageOfficialSources(await loadUserAccess(actor.userId))) throw new OfficialSourceError("공식 정보원 수집은 전사 영업 편집 권한이 필요합니다.", 403);
    const provider = officialProviderId((await context.params).providerId);
    const result = await collectOfficialSource(provider);
    await refreshBriefingWakeup().catch(() => console.warn("[official-sources] wake_hint_refresh_failed"));
    return NextResponse.json({ result });
  } catch (error) { return authErrorToResponse(error); }
}
