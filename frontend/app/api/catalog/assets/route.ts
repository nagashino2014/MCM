import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { IMAGE_TYPES, uploadCatalogAsset } from "@/lib/catalog/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const KINDS = new Set(["photo", "certificate"]);

// POST: 회사소개서 사진 자산 업로드(multipart: kind=photo|certificate, file) — 촉탁 임원 사진·대표이사 인사말 사진 등. PNG/JPG/WebP, 10MB 이하
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const form = await req.formData();
    const kind = String(form.get("kind") ?? "photo");
    const file = form.get("file");
    if (!KINDS.has(kind)) return NextResponse.json({ error: "자산 종류가 올바르지 않습니다." }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "이미지 파일이 필요합니다." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "이미지는 10MB 이하만 올릴 수 있습니다." }, { status: 400 });
    if (!IMAGE_TYPES.has(file.type)) return NextResponse.json({ error: "PNG·JPG·WebP 이미지만 올릴 수 있습니다." }, { status: 400 });
    const asset = await uploadCatalogAsset({
      kind: kind as "photo" | "certificate",
      fileName: file.name || `${kind}.png`,
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      actorUserId: actor.userId,
    });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_assets",
      targetId: asset.assetId,
      after: { kind: asset.kind, fileName: asset.fileName },
    });
    return NextResponse.json({ asset: { assetId: asset.assetId, kind: asset.kind, fileName: asset.fileName } });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
