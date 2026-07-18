import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getFormProfile, saveFormProfile, type FormProfile } from "@/lib/bid/form-analyze";
import { getFormById } from "@/lib/bid/package-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 양식 분석 결과(form_profile) 조회 ?formId=
export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.view");
    const formId = String(req.nextUrl.searchParams.get("formId") ?? "");
    if (!formId) return NextResponse.json({ error: "formId 가 필요합니다." }, { status: 400 });
    const profile = await getFormProfile(formId);
    return NextResponse.json({ profile });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 미세조정 저장(항목 추가/삭제·매핑 수정 반영, 프로필 전체 교체)
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json().catch(() => ({}))) as { formId?: string; profile?: FormProfile };
    const formId = String(body.formId ?? "");
    if (!formId || !body.profile || !Array.isArray(body.profile.documents)) {
      return NextResponse.json({ error: "formId 와 profile 이 필요합니다." }, { status: 400 });
    }
    const form = await getFormById(formId);
    if (!form) return NextResponse.json({ error: "양식을 찾을 수 없습니다." }, { status: 404 });
    await saveFormProfile(formId, body.profile);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "contract_update",
      targetTable: "bid_package_forms",
      targetId: formId,
      after: { kind: "form_profile_edit", documents: body.profile.documents.length },
    });
    return NextResponse.json({ profile: await getFormProfile(formId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
