import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { addSalesAssignees, listManualSalesAssigneeIds, listSalesAssignees, setSalesAssignees } from "@/lib/sales/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 영업 담당자. employees = 필터·선택용 목록, manualIds = 지정된 직원 id(조직도 체크 표시용).
// 지정·해제는 영업 메뉴 권한(tpl-sales-staff)을 함께 부여·회수하므로 sales.staff.manage(대표이사·관리자)만 한다(298).
export async function GET() {
  try {
    await requirePermission("sales.view");
    const [employees, manualIds] = await Promise.all([listSalesAssignees(), listManualSalesAssigneeIds()]);
    return NextResponse.json({ employees, manualIds });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// '영업 담당 추가' — 조직도에서 고른 인원을 풀에 등록.
export async function POST(req: Request) {
  try {
    const auth = await requirePermission("sales.staff.manage");
    const body = await req.json().catch(() => ({}));
    const employeeIds: string[] = Array.isArray(body?.employeeIds) ? body.employeeIds.map(String) : [];
    if (!employeeIds.length) {
      return NextResponse.json({ error: "추가할 인원을 선택하세요." }, { status: 400 });
    }
    await addSalesAssignees(employeeIds, auth.userId ?? null);
    const [employees, manualIds] = await Promise.all([listSalesAssignees(), listManualSalesAssigneeIds()]);
    return NextResponse.json({ employees, manualIds });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// "영업 제설정 > 영업 담당자 설정" — 지정 목록 전체 저장(빠진 인원은 해제·메뉴 권한 회수).
export async function PUT(req: Request) {
  try {
    const auth = await requirePermission("sales.staff.manage");
    const body = await req.json().catch(() => ({}));
    if (!Array.isArray(body?.employeeIds)) {
      return NextResponse.json({ error: "employeeIds 배열이 필요합니다." }, { status: 400 });
    }
    const employeeIds: string[] = body.employeeIds.map(String);
    const before = await listManualSalesAssigneeIds();
    const result = await setSalesAssignees(employeeIds, auth.userId ?? null);
    await recordAuditLog({
      actorUserId: auth.userId,
      action: "permission_assignment_update",
      targetTable: "sales_assignees",
      targetId: "sales-staff",
      before: { employeeIds: before },
      after: { employeeIds, granted: result.granted, revoked: result.revoked },
    });
    const [employees, manualIds] = await Promise.all([listSalesAssignees(), listManualSalesAssigneeIds()]);
    return NextResponse.json({ employees, manualIds, ...result });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
