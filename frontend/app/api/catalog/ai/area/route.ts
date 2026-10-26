import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { proposeNewArea } from "@/lib/catalog/ai/service";
import { createCustomArea, deactivateCustomArea } from "@/lib/catalog/custom-areas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

// POST: 새 사업 분야 쪽 제안 { name, memo, categories: [계약 관리 분류] } → AI 제안 + 규칙 초안 + 부분별 검토 표시(블루프린트 §7-2 6)
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as { name?: unknown; memo?: unknown; categories?: unknown };
    const proposal = await proposeNewArea({
      name: typeof body.name === "string" ? body.name : "",
      memo: typeof body.memo === "string" ? body.memo : "",
      categories: Array.isArray(body.categories) ? body.categories.map(String) : [],
      userId: actor.userId,
    });
    return NextResponse.json(proposal);
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 새 사업 분야 만들기 { name, content } — 검토 화면에서 고른 내용(서버가 다시 정리). 분야 색은 빈 슬롯(없으면 관련 분류 색)
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as { name?: unknown; content?: unknown };
    const area = await createCustomArea(typeof body.name === "string" ? body.name : "", body.content as never, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_business_areas",
      targetId: area.areaId,
      after: { name: area.name, slot: area.slot, source: area.content.source, relatedCategories: area.content.relatedCategories },
    });
    return NextResponse.json({ area, pageKey: `area-${area.areaId}` });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE ?areaId= — 새 사업 분야 빼기(비활성, 행은 남김). 기존 6개 분야는 뺄 수 없다
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const areaId = req.nextUrl.searchParams.get("areaId") ?? "";
    const ok = await deactivateCustomArea(areaId, actor.userId);
    if (!ok) return NextResponse.json({ error: "뺄 수 있는 새 사업 분야가 아닙니다." }, { status: 404 });
    await recordAuditLog({ actorUserId: actor.userId, action: "catalog_update", targetTable: "catalog_business_areas", targetId: areaId, after: { is_active: 0 } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
