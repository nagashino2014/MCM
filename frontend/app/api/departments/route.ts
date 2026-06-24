import { NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 부서 목록 (editor 이상 — 계약 수행부서 지정 등에서 사용).
export async function GET() {
  try {
    await requireAuthenticated();
    const db = await getDb();
    const result = await db.exec(
      "SELECT dept_id, dept_name, dept_kind, display_order FROM departments WHERE is_active = 1 ORDER BY display_order ASC, dept_name ASC"
    );
    return NextResponse.json({
      departments: rowsToObjects(result).map((row) => ({
        deptId: String(row.dept_id ?? ""),
        deptName: String(row.dept_name ?? ""),
        deptKind: String(row.dept_kind ?? "division"),
        displayOrder: Number(row.display_order ?? 100),
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
