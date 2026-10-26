import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { getIllustration, illustrationUsage, removeIllustration, updateIllustration, type IllustrationPatch } from "@/lib/catalog/illustrations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 일러스트 정보 + 쓰는 곳(쪽·버전·발행본)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    await requirePermission("catalog.manage");
    const { assetId } = await params;
    const info = await getIllustration(assetId);
    if (!info) return NextResponse.json({ error: "일러스트를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ info, usage: await illustrationUsage(assetId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PATCH: 정보 고치기 { title, type, altTypes, count, center, loop, quality, note, slots, license, status }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const actor = await requirePermission("catalog.manage");
    const { assetId } = await params;
    const body = (await req.json().catch(() => ({}))) as IllustrationPatch;
    const before = await getIllustration(assetId);
    const info = await updateIllustration(assetId, body, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_illustrations",
      targetId: assetId,
      before: before ? { title: before.title, type: before.type, count: before.count, slots: before.slots.length, status: before.status } : undefined,
      after: { title: info.title, type: info.type, count: info.count, slots: info.slots.length, status: info.status },
    });
    return NextResponse.json({ info });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: 빼기 — 쓰는 곳이 없으면 지우고, 있으면 보관(그 쪽은 그대로 그려진다)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ assetId: string }> }) {
  try {
    const actor = await requirePermission("catalog.manage");
    const { assetId } = await params;
    const before = await getIllustration(assetId);
    const out = await removeIllustration(assetId, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_update",
      targetTable: "catalog_illustrations",
      targetId: assetId,
      before: before ? { title: before.title, sourceKey: before.sourceKey } : undefined,
      after: { action: out.action, pages: out.usage.pages.length, versions: out.usage.versions, editions: out.usage.editions },
    });
    return NextResponse.json(out);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
