import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import {
  ContractTypeViewGrantInputError,
  createContractTypeViewGrant,
  listContractTypeViewGrants,
  revokeContractTypeViewGrant,
} from "@/lib/admin/contract-type-view-grants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 용역 유형별 계약 열람 부여(377) — 계정·권한 관리 화면의 "용역 유형별 계약 열람" 칸. 권한 부여와 같은 키로 판정한다.
 *   GET    ?userId=    계정의 미회수 부여 목록        rbac.assignment.manage
 *   POST   {userId, serviceType, serviceSubtype?, note?}  부여
 *   DELETE ?grantId=   회수
 */
function inputErrorToResponse(err: unknown) {
  if (err instanceof ContractTypeViewGrantInputError) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  return authErrorToResponse(err);
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission("rbac.assignment.manage", { fallbackRoles: ["admin"] });
    const userId = req.nextUrl.searchParams.get("userId") ?? "";
    if (!userId) return NextResponse.json({ error: "userId가 필요합니다." }, { status: 400 });
    return NextResponse.json(await listContractTypeViewGrants(userId));
  } catch (err) {
    return inputErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("rbac.assignment.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const grantId = await createContractTypeViewGrant(actor.userId, body);
    return NextResponse.json({ grantId });
  } catch (err) {
    return inputErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("rbac.assignment.manage", { fallbackRoles: ["admin"] });
    await revokeContractTypeViewGrant(actor.userId, req.nextUrl.searchParams.get("grantId"));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return inputErrorToResponse(err);
  }
}
