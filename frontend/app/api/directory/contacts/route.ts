import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission, requireSession } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import {
  createContactPerson,
  deleteContactPerson,
  isOrgCategory,
  setFacilityOrgCategory,
  updateContactPerson,
} from "@/lib/directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 주소록 외부 연락처 관리 — 담당자 개별 추가·수정·삭제 + 소속 사업장의 연락처 구분(기관 유형) 설정.
// 사업장 상세(FacilityDetailPanel)의 일괄 저장과 별개로, 주소록·결재 양식에서 바로 고칠 때 쓴다.
// 권한(2026-10-30 사용자 결정): 담당자 추가·수정은 contact.edit(전 직원), 삭제와 연락처 구분(사업장 속성)
// 변경은 facility.edit 만 — 출장·영업에서 만난 사람은 담당 직원이 직접 등록·갱신하되 지우지는 못한다.

/** 담당자 추가·수정 — contact.edit 또는 facility.edit(사업장 관리자는 원래 수정할 수 있었다). */
async function requireContactEditor() {
  const ctx = await requireSession();
  if ((await hasPermission(ctx.userId, "contact.edit")) || (await hasPermission(ctx.userId, "facility.edit"))) return ctx;
  throw new AuthError("담당자를 등록·수정할 권한이 없습니다.", 403);
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContactEditor();
    const body = (await req.json().catch(() => ({}))) as {
      facilityId?: string;
      personName?: string;
      title?: string | null;
      departmentName?: string | null;
      officePhone?: string | null;
      mobilePhone?: string | null;
      email?: string | null;
      duties?: string | null;
    };
    if (!body.facilityId) return NextResponse.json({ error: "기관·업체를 선택하세요." }, { status: 400 });
    const id = await createContactPerson(
      {
        facilityId: String(body.facilityId),
        personName: String(body.personName ?? ""),
        title: body.title,
        departmentName: body.departmentName,
        officePhone: body.officePhone,
        mobilePhone: body.mobilePhone,
        email: body.email,
        duties: body.duties,
      },
      ctx.userId
    );
    return NextResponse.json({ id });
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    if (err instanceof Error && err.message) return NextResponse.json({ error: err.message }, { status: 400 });
    return authErrorToResponse(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await requireContactEditor();
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

    // 연락처 구분은 사업장 속성(같은 사업장 담당자 전원에게 적용) — 사업장 수정 권한자만 바꾼다.
    if (body.orgCategory !== undefined) {
      if (!(await hasPermission(ctx.userId, "facility.edit"))) {
        return NextResponse.json({ error: "연락처 구분은 사업장 수정 권한이 있어야 바꿀 수 있습니다." }, { status: 403 });
      }
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
      await updateContactPerson(
        Number(body.id),
        {
          personName: body.personName,
          title: body.title,
          officePhone: body.officePhone,
          mobilePhone: body.mobilePhone,
          email: body.email,
          duties: body.duties,
          status: body.status,
        },
        ctx.userId
      );
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
