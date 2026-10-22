import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { LOGO_TYPES, listClients, uploadClientLogo } from "@/lib/catalog/clients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;

// POST: 고객사 로고 업로드·교체(multipart: clientId, file) — PNG/JPG/WebP, 5MB 이하
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const form = await req.formData();
    const clientId = String(form.get("clientId") ?? "");
    const file = form.get("file");
    if (!clientId) return NextResponse.json({ error: "clientId 가 필요합니다." }, { status: 400 });
    if (!(file instanceof File)) return NextResponse.json({ error: "로고 파일이 필요합니다." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "로고는 5MB 이하만 올릴 수 있습니다." }, { status: 400 });
    if (!LOGO_TYPES.has(file.type)) return NextResponse.json({ error: "PNG·JPG·WebP 이미지만 올릴 수 있습니다." }, { status: 400 });
    if (!(await listClients()).some((c) => c.clientId === clientId)) {
      return NextResponse.json({ error: "고객사를 찾을 수 없습니다." }, { status: 404 });
    }
    const asset = await uploadClientLogo({
      clientId,
      fileName: file.name || "logo.png",
      contentType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
      actorUserId: actor.userId,
    });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_clients",
      targetId: clientId,
      after: { logoAssetId: asset.assetId, fileName: asset.fileName },
    });
    return NextResponse.json({ asset, clients: await listClients() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
