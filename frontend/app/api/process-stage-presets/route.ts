import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession, requireEditor } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { listPresets, savePreset, type PresetItemInput } from "@/lib/contracts/process-stage-presets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 공정 프리셋 목록(공정표 설정 모달의 선택 대상).
export async function GET() {
  try {
    await requireSession();
    return NextResponse.json({ presets: await listPresets() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 공정 프리셋 생성/수정.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireEditor();
    const body = (await req.json()) as {
      presetId?: string;
      presetName?: string;
      serviceType?: string | null;
      displayOrder?: number | null;
      items?: PresetItemInput[];
    };
    const presetId = await savePreset({
      presetId: body.presetId,
      presetName: body.presetName ?? "새 프리셋",
      serviceType: body.serviceType ?? null,
      displayOrder: body.displayOrder ?? null,
      items: Array.isArray(body.items) ? body.items : [],
    });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: body.presetId ? "contract_update" : "contract_create",
      targetTable: "process_stage_presets",
      targetId: presetId,
      after: { presetName: body.presetName },
    });
    return NextResponse.json({ presetId, presets: await listPresets() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
