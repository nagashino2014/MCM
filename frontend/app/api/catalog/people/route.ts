import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { listAdvisors, listCatalogPeople, listExtraPeople, savePersonMeta, type PersonMetaPatch } from "@/lib/catalog/people";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 사용자관리 재직자(임원·직원 구획·노출·사진 판정) + 직접 입력 임원(촉탁) + 자문위원
export async function GET() {
  try {
    await requirePermission("catalog.manage");
    const [people, extraPeople, advisors] = await Promise.all([listCatalogPeople(), listExtraPeople(), listAdvisors()]);
    return NextResponse.json({ people, extraPeople, advisors });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 인물 노출 메타 저장 { employeeId, patch }
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as { employeeId?: string; patch?: PersonMetaPatch };
    const employeeId = String(body.employeeId ?? "");
    const patch = (body.patch && typeof body.patch === "object" ? body.patch : {}) as PersonMetaPatch;
    await savePersonMeta(employeeId, patch, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_people_meta",
      targetId: employeeId,
      after: patch,
    });
    return NextResponse.json({ people: await listCatalogPeople() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
