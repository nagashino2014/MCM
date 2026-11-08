import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { requireGlobalScope } from "@/lib/auth/scope-guards";
import { loadUserAccess, resolveDeptScope } from "@/lib/auth/rbac";
import { recordAccessLog } from "@/lib/auth/access-log";
import { getEmployeeRoster } from "@/lib/admin/employee-roster";
import { createRosterWorkbook, rosterFileName } from "@/lib/admin/employee-roster-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 직원 일람표 — 전사 인사 열람(staffing.view 전사 범위)만. 연봉 열은 급여 열람(payroll.view 전사 범위)이 있을 때만 채운다.
// ?resigned=1 퇴사자 포함, ?format=xlsx 엑셀 내려받기(접속기록 export).
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireGlobalScope("staffing.view");
    const access = await loadUserAccess(ctx.userId);
    const salaryVisible = resolveDeptScope(access, "payroll.view").kind === "all";
    const sp = req.nextUrl.searchParams;
    const includeResigned = sp.get("resigned") === "1";
    const roster = await getEmployeeRoster({ includeResigned, salaryVisible });

    if (sp.get("format") !== "xlsx") return NextResponse.json(roster);

    await recordAccessLog({
      actorUserId: ctx.userId,
      action: "export",
      targetKind: "employee_roster",
      detail: { count: roster.rows.length, includeResigned, salary: salaryVisible },
    });
    const file = await createRosterWorkbook(roster);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(rosterFileName(roster.asOf))}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
