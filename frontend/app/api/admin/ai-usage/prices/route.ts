import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { listCurrentModelPrices, listModelPriceHistory, normalizeModelFamily, upsertModelPrice, type ModelPriceInput } from "@/lib/ai/pricing";
import { isYmd } from "@/lib/ai/usage-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/ai-usage/prices[?model=<family>] — 현재 단가 목록 / 특정 모델 단가 이력
export async function GET(req: NextRequest) {
  try {
    await requirePermission("ai.usage.view");
    const model = String(req.nextUrl.searchParams.get("model") ?? "").trim();
    if (model) return NextResponse.json({ history: await listModelPriceHistory(normalizeModelFamily(model)) });
    return NextResponse.json({ prices: await listCurrentModelPrices() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT /api/admin/ai-usage/prices — (model_family, effective_from) upsert. 적용일을 새로 주면 이력이 남고 이전 단가는 보존된다.
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("ai.usage.manage");
    const body = (await req.json().catch(() => ({}))) as Partial<Record<keyof ModelPriceInput, unknown>>;
    const modelFamily = normalizeModelFamily(String(body.modelFamily ?? ""));
    if (!/^claude-[a-z0-9-]+$/.test(modelFamily)) return NextResponse.json({ error: "모델 ID 형식이 올바르지 않습니다." }, { status: 400 });
    const effectiveFrom = isYmd(body.effectiveFrom) ? body.effectiveFrom : null;
    if (!effectiveFrom) return NextResponse.json({ error: "적용일(YYYY-MM-DD)을 입력하세요." }, { status: 400 });
    const nums = ["inputPerMtok", "cacheWritePerMtok", "cacheReadPerMtok", "outputPerMtok"] as const;
    const parsed: Record<string, number> = {};
    for (const k of nums) {
      const n = Number(body[k]);
      if (!Number.isFinite(n) || n < 0) return NextResponse.json({ error: `${k} 값이 올바르지 않습니다.` }, { status: 400 });
      parsed[k] = n;
    }
    const contextTokens = Number(body.contextTokens ?? 200000);
    const input: ModelPriceInput = {
      modelFamily,
      effectiveFrom,
      displayName: String(body.displayName ?? "").trim() || modelFamily,
      inputPerMtok: parsed.inputPerMtok,
      cacheWritePerMtok: parsed.cacheWritePerMtok,
      cacheReadPerMtok: parsed.cacheReadPerMtok,
      outputPerMtok: parsed.outputPerMtok,
      supportsVision: body.supportsVision !== false,
      contextTokens: Number.isInteger(contextTokens) && contextTokens > 0 ? contextTokens : 200000,
      selectable: body.selectable !== false,
      deprecatedAt: isYmd(body.deprecatedAt) ? body.deprecatedAt : null,
      note: body.note != null ? String(body.note).trim() || null : null,
    };
    const before = (await listModelPriceHistory(modelFamily)).find((r) => r.effectiveFrom === effectiveFrom) ?? null;
    await upsertModelPrice(input);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "ai_settings_change",
      targetTable: "ai_model_prices",
      targetId: `${modelFamily}@${effectiveFrom}`,
      before,
      after: input,
    });
    return NextResponse.json({ ok: true, prices: await listCurrentModelPrices() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
