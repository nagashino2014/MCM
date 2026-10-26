import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { proposeLabels } from "@/lib/catalog/ai/service";
import { listCatalogProjects, saveProjectMeta } from "@/lib/catalog/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

// POST: 실적 대외 표기 제안 { ids?, exclude?(이미 본 행), limit? } — 규칙 표기가 어색한 행(직접 정한 표기·검토 완료·통합허가 제외)만, 한 번에 최대 30행
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as { ids?: unknown; exclude?: unknown; limit?: unknown };
    const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : undefined;
    return NextResponse.json(await proposeLabels({ ids, exclude: Array.isArray(body.exclude) ? body.exclude.map(String).slice(0, 500) : undefined, limit: Number(body.limit) || 20, userId: actor.userId }));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 일괄 확정 { items: [{id, title}] } — 대외 표기로 저장하고 검토 완료로 표시
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as { items?: unknown };
    const items = (Array.isArray(body.items) ? body.items : [])
      .map((raw) => {
        const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
        return { id: String(r.id ?? ""), title: String(r.title ?? "").replace(/\s+/g, " ").trim().slice(0, 200) };
      })
      .filter((it) => it.id && !it.id.startsWith("manual:") && it.title)
      .slice(0, 100);
    if (items.length === 0) return NextResponse.json({ error: "확정할 표기가 없습니다." }, { status: 400 });
    for (const it of items) await saveProjectMeta([it.id], { displayTitle: it.title, reviewed: true }, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "contract_catalog_meta",
      targetId: items.length === 1 ? items[0].id : `${items.length} contracts`,
      after: { displayTitles: items.slice(0, 50), via: "catalog.project_label" },
    });
    return NextResponse.json({ updated: items.length, rows: await listCatalogProjects() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
