import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getAppendixRules, listCatalogProjects, saveProjectMeta, type ProjectMetaPatch } from "@/lib/catalog/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 부록 실적 원천(전 계약 + 대외 표기 메타) + 마스터본 표시 범위 규칙. 표기명·표시 판정은 화면이 lib/catalog/appendix.ts 로 계산한다.
export async function GET() {
  try {
    await requirePermission("catalog.manage");
    const [rows, rules] = await Promise.all([listCatalogProjects(), getAppendixRules()]);
    return NextResponse.json({ rows, rules });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 대외 표기 메타 저장 { contractIds: string[], patch } — 여러 계약 일괄(검토 완료·노출 고정·묶음)
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as { contractIds?: unknown; patch?: ProjectMetaPatch };
    const ids = Array.isArray(body.contractIds) ? body.contractIds.map((v) => String(v)) : [];
    if (ids.length === 0) return NextResponse.json({ error: "contractIds 가 필요합니다." }, { status: 400 });
    const patch = (body.patch && typeof body.patch === "object" ? body.patch : {}) as ProjectMetaPatch;
    const count = await saveProjectMeta(ids, patch, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "contract_catalog_meta",
      targetId: ids.length === 1 ? ids[0] : `${ids.length} contracts`,
      after: { contractIds: ids.slice(0, 50), patch },
    });
    return NextResponse.json({ updated: count, rows: await listCatalogProjects() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
