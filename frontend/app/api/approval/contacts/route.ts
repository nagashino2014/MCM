import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 사업장 담당자 키워드 검색(성명·업체명) — 양식 contact_select(접견인) 자동완성용.
// 명함 촬영·사업장 담당자 정보로 쌓인 facility_contact_people 리스트가 소스다.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const q = String(req.nextUrl.searchParams.get("q") ?? "").trim();
    const limit = Math.min(30, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? "15") || 15));
    if (q.length < 2) return NextResponse.json({ items: [] });

    const db = await getDb();
    const rows = rowsToObjects(
      await db.exec(
        `SELECT p.id, p.person_name, p.title, p.facility_id,
                f.company_name AS facility_name, d.department_name
           FROM facility_contact_people p
           LEFT JOIN facilities f ON f.facility_id = p.facility_id
           LEFT JOIN facility_contact_departments d ON d.id = p.department_id
          WHERE (p.person_name ILIKE $1 OR f.company_name ILIKE $1)
          ORDER BY (p.status = 'active') DESC, f.company_name ASC, p.person_name ASC
          LIMIT $2`,
        [`%${q}%`, limit]
      )
    );
    return NextResponse.json({
      items: rows.map((r) => ({
        id: Number(r.id ?? 0),
        personName: String(r.person_name ?? ""),
        title: r.title != null ? String(r.title) : null,
        facilityId: String(r.facility_id ?? ""),
        facilityName: r.facility_name != null ? String(r.facility_name) : null,
        departmentName: r.department_name != null ? String(r.department_name) : null,
      })),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
