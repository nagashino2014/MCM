import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import {
  createContactPerson,
  isOrgCategory,
  listFacilityDepartmentNames,
  setFacilityOrgCategory,
  updateContactPerson,
} from "@/lib/directory";
import { getContactDeleteQuota, moveContactPersonToTrash } from "@/lib/directory-trash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 주소록 외부 연락처 관리 — 담당자 개별 추가·수정·삭제 + 소속 사업장의 연락처 구분(기관 유형) 설정.
// 사업장 상세(FacilityDetailPanel)의 일괄 저장과 별개로, 주소록·결재 양식에서 바로 고칠 때 쓴다.
// 권한(2026-10-30 사용자 결정): 담당자 수정은 contact.edit(전 직원), 연락처 구분(사업장 속성) 변경은 facility.edit 만.
// 삭제(2026-11-27 사용자 결정, 직원 요청 27): 수정 권한자(contact.edit·facility.edit)가 한 명씩 휴지통으로 옮긴다 —
// 완전 삭제는 휴지통에서 관리자(trash.purge)만. 한 직원이 24시간에 5건까지(관리자 제외, lib/directory-trash.ts).
// 추가(POST)와 부서 목록(GET)은 로그인한 직원이면 된다(2026-11-25 사용자 결정) — 출장보고서의 [접견인 추가]는
// 전 직원이 쓰므로 권한 템플릿 구성에 따라 막히지 않게 한다. 누가 넣었는지는 created_by·감사 로그에 남는다.

/** 담당자 수정 — contact.edit 또는 facility.edit(사업장 관리자는 원래 수정할 수 있었다). */
async function requireContactEditor() {
  const ctx = await requireSession();
  if ((await hasPermission(ctx.userId, "contact.edit")) || (await hasPermission(ctx.userId, "facility.edit"))) return ctx;
  throw new AuthError("담당자를 등록·수정할 권한이 없습니다.", 403);
}

// GET ?facilityId= — 그 기관·업체의 부서 목록(담당자 등록·수정 창에서 부서를 고를 때).
// GET ?quota=1 — 내 담당자 삭제 제한 상태(최근 24시간 건수·잠금 해제 시각). 삭제 확인 창에 보인다.
export async function GET(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get("quota") === "1") {
      const ctx = await requireContactEditor();
      const exempt = await hasPermission(ctx.userId, "trash.purge");
      return NextResponse.json({ quota: await getContactDeleteQuota(ctx.userId, exempt) });
    }
    await requireSession();
    const facilityId = String(req.nextUrl.searchParams.get("facilityId") ?? "").trim();
    if (!facilityId) return NextResponse.json({ error: "facilityId 가 필요합니다." }, { status: 400 });
    const names = await listFacilityDepartmentNames(facilityId);
    return NextResponse.json({ departments: names.map((name) => ({ name })) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => ({}))) as {
      facilityId?: string;
      personName?: string;
      title?: string | null;
      departmentName?: string | null;
      officePhone?: string | null;
      mobilePhone?: string | null;
      email?: string | null;
      duties?: string | null;
      extraEmails?: string[];
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
        extraEmails: Array.isArray(body.extraEmails) ? body.extraEmails : undefined,
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
      departmentName?: string | null;
      officePhone?: string | null;
      mobilePhone?: string | null;
      email?: string | null;
      duties?: string | null;
      status?: string;
      extraEmails?: string[];
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
          departmentName: body.departmentName,
          extraEmails: Array.isArray(body.extraEmails) ? body.extraEmails : undefined,
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

// DELETE ?id= — 담당자 한 명을 휴지통으로 옮긴다(완전 삭제 아님). 여러 명을 한 번에 지우는 경로는 두지 않는다.
// 하루 제한에 걸리면 429 와 다시 지울 수 있는 시각을 돌려준다.
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireContactEditor();
    const id = Number(req.nextUrl.searchParams.get("id") ?? "");
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
    const exempt = await hasPermission(ctx.userId, "trash.purge");
    const out = await moveContactPersonToTrash({ id, actorUserId: ctx.userId, exempt });
    return NextResponse.json({ ok: true, quota: out.quota });
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    const status = (err as { status?: number })?.status;
    if (status && err instanceof Error && err.message) return NextResponse.json({ error: err.message }, { status });
    return authErrorToResponse(err);
  }
}
