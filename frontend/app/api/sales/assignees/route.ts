import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { addSalesAssignees, listManualSalesAssigneeIds, listSalesAssignees } from "@/lib/sales/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 영업 담당자 풀. employees = 필터·선택용 최종 목록, manualIds = 수동 등록분(조직도 합집합용).
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
    const auth = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
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
