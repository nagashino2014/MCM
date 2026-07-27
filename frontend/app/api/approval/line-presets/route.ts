import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listLinePresets, saveLinePreset, deleteLinePreset, type LinePresetStep, type LinePresetWatcher } from "@/lib/approval/line-presets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 내 결재선 프리셋 목록
export async function GET() {
  try {
    const ctx = await requirePermission("approval.view");
    return NextResponse.json({ presets: await listLinePresets(ctx.userId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  name?: string;
  steps?: LinePresetStep[];
  watchers?: LinePresetWatcher[];
}

// POST: 프리셋 저장
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const body = (await req.json().catch(() => ({}))) as PostBody;
    const steps = Array.isArray(body.steps) ? body.steps : [];
    if (!steps.length) return NextResponse.json({ error: "결재선이 비어 있습니다." }, { status: 400 });
    const presetId = await saveLinePreset({
      ownerUserId: ctx.userId,
      name: String(body.name ?? ""),
      steps,
      watchers: Array.isArray(body.watchers) ? body.watchers : [],
    });
    return NextResponse.json({ presetId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: 프리셋 삭제(?presetId=)
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const presetId = String(req.nextUrl.searchParams.get("presetId") ?? "");
    if (!presetId) return NextResponse.json({ error: "presetId 가 필요합니다." }, { status: 400 });
    await deleteLinePreset(ctx.userId, presetId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
