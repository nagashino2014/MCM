import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { CATALOG_CATEGORIES } from "@/lib/catalog/areas";
import { proposePageEdit } from "@/lib/catalog/ai/service";
import { MASTER_DOC_ID, listCatalogProjects, saveProjectMeta } from "@/lib/catalog/projects";
import { PAGE_KEY_RE } from "@/lib/catalog/studio/doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

// POST: [AI로 수정] 제안 { doc?, pageKey, focusId?, instruction, edition? } → 검토할 바꿈(편집층 조각·검토 표시)
//   저장된 편집본 기준으로 서버가 쪽을 다시 만들어 컨텍스트를 묶는다(화면은 먼저 자동 저장). 응답 원문은 저장하지 않는다.
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const docId = typeof body.doc === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(body.doc) ? body.doc : MASTER_DOC_ID;
    const pageKey = typeof body.pageKey === "string" && PAGE_KEY_RE.test(body.pageKey) ? body.pageKey : "";
    if (!pageKey) return NextResponse.json({ error: "쪽을 골라 주세요." }, { status: 400 });
    const focusId = typeof body.focusId === "string" && /^[nu][a-z0-9]{1,12}$/.test(body.focusId) ? body.focusId : null;
    const proposal = await proposePageEdit({
      docId,
      pageKey,
      focusId,
      instruction: typeof body.instruction === "string" ? body.instruction : "",
      edition: body.edition === "draft" ? "draft" : "print",
      userId: actor.userId,
    });
    return NextResponse.json(proposal);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 대표 실적 바꿈 채택 { pageKey: "area-N", featured: [계약 id] } — 그 분류의 대표 실적 지정을 고른 계약으로 맞춘다(실적 노출 관리와 같은 값)
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as { pageKey?: unknown; featured?: unknown };
    const m = typeof body.pageKey === "string" ? body.pageKey.match(/^area-([1-5])$/) : null;
    if (!m) return NextResponse.json({ error: "분야 쪽에서만 대표 실적을 바꿉니다." }, { status: 400 });
    const category = CATALOG_CATEGORIES[Number(m[1]) - 1];
    const projects = (await listCatalogProjects()).filter((p) => p.category === category && !p.contractId.startsWith("manual:"));
    const inCategory = new Set(projects.map((p) => p.contractId));
    const ids = (Array.isArray(body.featured) ? body.featured.map(String) : []).filter((id) => inCategory.has(id)).slice(0, 4);
    if (ids.length === 0) return NextResponse.json({ error: "고른 실적이 그 분야 계약이 아닙니다." }, { status: 400 });
    const off = projects.filter((p) => p.meta?.isFeatured && !ids.includes(p.contractId)).map((p) => p.contractId);
    await saveProjectMeta(ids, { isFeatured: true }, actor.userId);
    if (off.length) await saveProjectMeta(off, { isFeatured: false }, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "contract_catalog_meta",
      targetId: `featured:${category}`,
      after: { featured: ids, unfeatured: off.slice(0, 20), via: "catalog.section_write" },
    });
    return NextResponse.json({ ok: true, featured: ids, unfeatured: off.length });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
