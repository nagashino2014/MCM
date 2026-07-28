import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { deleteContactPerson, isOrgCategory, setFacilityOrgCategory, updateContactPerson } from "@/lib/directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 주소록 외부 연락처 관리 — 담당자 개별 수정·삭제 + 소속 사업장의 연락처 구분(기관 유형) 설정.
// 사업장 상세(FacilityDetailPanel)의 일괄 저장과 별개로, 주소록에서 바로 고칠 때 쓴다.

export async function PATCH(req: NextRequest) {
  try {
    await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json().catch(() => ({}))) as {
      id?: number;
      facilityId?: string;
      orgCategory?: string;
      personName?: string;
      title?: string | null;
      officePhone?: string | null;
      mobilePhone?: string | null;
      email?: string | null;
      duties?: string | null;
      status?: string;
    };

    // 연락처 구분은 사업장 속성 — 담당자 수정과 함께 와도 각각 반영한다.
    if (body.orgCategory !== undefined) {
      if (!body.facilityId) return NextResponse.json({ error: "facilityId 가 필요합니다." }, { status: 400 });
      if (!isOrgCategory(body.orgCategory)) {
        return NextResponse.json({ error: "연락처 구분 값이 올바르지 않습니다." }, { status: 400 });
      }
      await setFacilityOrgCategory(body.facilityId, body.orgCategory);
    }

    if (body.id != null) {
      if (body.personName != null && !body.personName.trim()) {
        return NextResponse.json({ error: "이름은 비울 수 없습니다." }, { status: 400 });
      }
      await updateContactPerson(Number(body.id), {
        personName: body.personName,
        title: body.title,
        officePhone: body.officePhone,
        mobilePhone: body.mobilePhone,
        email: body.email,
        duties: body.duties,
        status: body.status,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    if (err instanceof Error && err.message) return NextResponse.json({ error: err.message }, { status: 400 });
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const id = Number(req.nextUrl.searchParams.get("id") ?? "");
    if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
    await deleteContactPerson(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
