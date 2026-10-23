import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getCatalogFont, updateCatalogFont } from "@/lib/catalog/font-library";
import type { FontClass } from "@/lib/catalog/font-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLASSES = new Set(["sans", "serif", "decorative"]);

// PATCH: 업로드 서체 고치기 { displayName?, classification?, isActive? } — 지우지 않고 끈다(지난 PDF 재현)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ fontId: string }> }) {
  try {
    const actor = await requirePermission("catalog.manage");
    const { fontId } = await params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const before = await getCatalogFont(fontId);
    const font = await updateCatalogFont(fontId, {
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      classification: typeof body.classification === "string" && CLASSES.has(body.classification) ? (body.classification as FontClass) : undefined,
      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
    });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_fonts",
      targetId: fontId,
      before: before ? { displayName: before.displayName, classification: before.classification, isActive: before.isActive } : undefined,
      after: { displayName: font.displayName, classification: font.classification, isActive: font.isActive },
    });
    return NextResponse.json({ font });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
