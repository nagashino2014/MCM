import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { deleteFontSet, saveFontSet } from "@/lib/catalog/font-library";
import type { WeightMap } from "@/lib/catalog/font-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST: 서체 세트 저장 { setId?, name, displayFontId, bodyFontId, figureFontId, weightMap: {display|body|figure: {"400": 굵기, …}} }
//   본문에 '제목 전용' 서체·가는(Light) 본문·비활성 서체는 막는다(lib/catalog/fonts.ts checkFontSetChoice)
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const set = await saveFontSet({
      setId: typeof body.setId === "string" && /^u-[a-f0-9]{8}$/.test(body.setId) ? body.setId : null,
      name: String(body.name ?? ""),
      displayFontId: String(body.displayFontId ?? ""),
      bodyFontId: String(body.bodyFontId ?? ""),
      figureFontId: String(body.figureFontId ?? ""),
      weightMap: (body.weightMap && typeof body.weightMap === "object" ? body.weightMap : {}) as WeightMap,
    });
    await recordAuditLog({ actorUserId: actor.userId, action: "catalog_update", targetTable: "catalog_font_sets", targetId: set.setId, after: set });
    return NextResponse.json({ set });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: ?id=u-… — 쓰는 문서가 있으면 막는다
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const id = req.nextUrl.searchParams.get("id") ?? "";
    if (!/^u-[a-f0-9]{8}$/.test(id)) return NextResponse.json({ error: "세트 id 가 올바르지 않습니다." }, { status: 400 });
    await deleteFontSet(id);
    await recordAuditLog({ actorUserId: actor.userId, action: "catalog_update", targetTable: "catalog_font_sets", targetId: id, after: { deleted: true } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
