import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import type { ManualProject } from "@/lib/catalog/appendix";
import { deleteManualProject, listManualProjects, saveManualProject } from "@/lib/catalog/manual-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 계약 없는 실적 목록(회사소개서 지표·부록 전용 — 계약 관리 집계와 무관)
export async function GET() {
  try {
    await requirePermission("catalog.manage");
    return NextResponse.json({ items: await listManualProjects() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 계약 없는 실적 추가·수정(manualId 있으면 수정)
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as Partial<ManualProject>;
    const manualId = await saveManualProject(body, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_manual_projects",
      targetId: manualId,
      after: { title: body.title, category: body.category, subtype: body.subtype, siteCount: body.siteCount },
    });
    return NextResponse.json({ manualId, items: await listManualProjects() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: 계약 없는 실적 삭제 ?manualId=
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const manualId = String(req.nextUrl.searchParams.get("manualId") ?? "");
    if (!manualId) return NextResponse.json({ error: "manualId 가 필요합니다." }, { status: 400 });
    await deleteManualProject(manualId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_manual_projects",
      targetId: manualId,
      after: { deleted: true },
    });
    return NextResponse.json({ items: await listManualProjects() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
