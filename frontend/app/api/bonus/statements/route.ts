import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { checkPermission, loadUserAccess, grantDeptIds } from "@/lib/auth/rbac";
import { getDb, rowsToObjects } from "@/lib/db";
import { parsePeriod } from "@/lib/bonus/source";
import { getStatementDetail, listStatementsOverview } from "@/lib/bonus/statements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 직원의 소속 부서 id(없으면 null). */
async function employeeDeptId(employeeId: string): Promise<string | null> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec("SELECT dept_id FROM employee_profiles WHERE employee_id = $1 LIMIT 1", [employeeId])
  );
  return rows[0]?.dept_id != null ? String(rows[0].dept_id) : null;
}

/**
 * 지급 명세 조회 — ?employeeId= 가 있으면 개별 상세(용역별 lines), 없으면 전체 명세.
 * 범위(X-01, 2026-10-19): bonus.view 를 전사(all)로 갖지 않으면 개별 상세는 그 직원의 부서를 target 으로 재판정하고,
 * 전체 명세는 본인 부서(self_dept)·지정 부서(specific_dept) 직원만 남긴다.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("bonus.view", { fallbackRoles: ["editor"] });
    const sp = new URL(req.url).searchParams;
    const p = parsePeriod(sp.get("period") ?? "");
    if (!p) return NextResponse.json({ error: "period 형식은 YYYY-H1/H2 입니다." }, { status: 400 });
    const access = await loadUserAccess(ctx.userId);
    const grants = access.grants.filter((g) => g.permissionKey === "bonus.view" && g.effect === "allow");
    const global = checkPermission(access, "bonus.view") && grants.some((g) => g.scopeKind === "all");
    const employeeId = sp.get("employeeId");
    if (employeeId) {
      if (!global) {
        const deptId = (await employeeDeptId(employeeId)) ?? "";
        if (!deptId || !checkPermission(access, "bonus.view", { deptId })) {
          return NextResponse.json({ error: "이 작업을 수행할 권한이 없습니다." }, { status: 403 });
        }
      }
      return NextResponse.json({ detail: await getStatementDetail(p, employeeId) });
    }
    let overview = await listStatementsOverview(p);
    if (!global) {
      const deptIds = new Set<string>();
      for (const g of grants) {
        for (const d of grantDeptIds(access, g)) deptIds.add(d); // self_dept = 보직 부서 전체(겸직 300)
      }
      const db = await getDb();
      const rows = rowsToObjects(
        await db.exec("SELECT employee_id FROM employee_profiles WHERE dept_id = ANY($1)", [[...deptIds]])
      );
      const allowed = new Set(rows.map((r) => String(r.employee_id)));
      overview = overview.filter((row) => allowed.has(row.employeeId));
    }
    return NextResponse.json({
      overview,
      // 산정·명세서 생성 버튼 노출 — bonus.calculate(291) 보유 여부. 이름은 화면 호환을 위해 유지.
      isAdmin: checkPermission(access, "bonus.calculate"),
      // 명세서 PDF·발송 버튼 노출 — 발송·PDF API 와 같은 bonus.send(2026-10-21 F-23).
      canSend: checkPermission(access, "bonus.send"),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
