import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDb, rowsToObjects } from "@/lib/db";
import { loadAiSettings, saveAiSetting, setFeatureEnabled, setFeatureModelOverride, setFeatureThinking } from "@/lib/ai/settings";
import { AI_FEATURES, isAiFeatureKey } from "@/lib/ai/features";
import { listCurrentModelPrices, normalizeModelFamily } from "@/lib/ai/pricing";
import { invalidateBudgetCache } from "@/lib/ai/budget";
import type { EffortLevel, ThinkingMode } from "@/lib/ai/model-caps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface AiSettingsHistoryRow {
  id: number;
  createdAt: string;
  actorUserId: string | null;
  actorName: string | null;
  targetTable: string;
  targetId: string;
  before: unknown;
  after: unknown;
}

async function listHistory(limit = 50): Promise<AiSettingsHistoryRow[]> {
  const db = await getDb();
  const rows = rowsToObjects(
    await db.exec(
      `SELECT a.id, a.created_at, a.actor_user_id, a.target_table, a.target_id, a.before_json, a.after_json,
              COALESCE(e.name, u.email) AS actor_name
         FROM audit_log a
         LEFT JOIN users u ON u.user_id = a.actor_user_id
         LEFT JOIN employee_profiles e ON e.user_id = a.actor_user_id
        WHERE a.target_table IN ('ai_settings', 'ai_model_prices', 'ai_budgets')
        ORDER BY a.id DESC
        LIMIT $1`,
      [limit]
    )
  );
  return rows.map((r) => ({
    id: Number(r.id),
    createdAt: String(r.created_at),
    actorUserId: r.actor_user_id != null ? String(r.actor_user_id) : null,
    actorName: r.actor_name != null ? String(r.actor_name) : null,
    targetTable: String(r.target_table),
    targetId: String(r.target_id),
    before: r.before_json ?? null,
    after: r.after_json ?? null,
  }));
}

// GET /api/admin/ai-usage/settings — 설정 + 변경 이력(audit_log)
export async function GET() {
  try {
    await requirePermission("ai.usage.view");
    const settings = await loadAiSettings({ fresh: true });
    return NextResponse.json({ settings, history: await listHistory() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT /api/admin/ai-usage/settings
//   { featureModel: { feature, model|null } }  — 기능별 모델 오버라이드(§3.6). 단가표에 있고 selectable 인 모델만, 비전 기능은 supports_vision 필수.
//   { usdKrwRate: number|null } / { forecastWindowDays: number }
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("ai.usage.manage");
    const body = (await req.json().catch(() => ({}))) as {
      featureModel?: { feature?: unknown; model?: unknown };
      featureEnabled?: { feature?: unknown; enabled?: unknown };
      featureThinking?: { feature?: unknown; thinking?: unknown; effort?: unknown };
      autoDowngrade?: { enabled?: unknown; atPct?: unknown; targetModel?: unknown };
      usdKrwRate?: unknown;
      forecastWindowDays?: unknown;
      singleCallAlertUsd?: unknown;
    };

    if (body.featureEnabled) {
      const feature = body.featureEnabled.feature;
      if (!isAiFeatureKey(feature)) return NextResponse.json({ error: "알 수 없는 기능 키입니다." }, { status: 400 });
      const map = await setFeatureEnabled(feature, body.featureEnabled.enabled !== false, actor.userId);
      return NextResponse.json({ ok: true, featureEnabled: map });
    }

    if (body.featureThinking) {
      const feature = body.featureThinking.feature;
      if (!isAiFeatureKey(feature)) return NextResponse.json({ error: "알 수 없는 기능 키입니다." }, { status: 400 });
      const t = body.featureThinking.thinking;
      const e = body.featureThinking.effort;
      const thinking = t === "adaptive" || t === "off" ? (t as ThinkingMode) : null;
      const effort = typeof e === "string" && ["low", "medium", "high", "xhigh", "max"].includes(e) ? (e as EffortLevel) : null;
      const map = await setFeatureThinking(feature, { thinking, effort }, actor.userId);
      return NextResponse.json({ ok: true, featureThinking: map });
    }

    if (body.autoDowngrade) {
      const ad = body.autoDowngrade;
      const pct = Number(ad.atPct ?? 80);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return NextResponse.json({ error: "강등 기준 %는 1~100 사이여야 합니다." }, { status: 400 });
      const target = normalizeModelFamily(String(ad.targetModel ?? "claude-haiku-4-5"));
      const price = (await listCurrentModelPrices()).find((p) => p.modelFamily === target);
      if (!price) return NextResponse.json({ error: "강등 대상 모델은 단가표에 있어야 합니다." }, { status: 400 });
      await saveAiSetting("autoDowngrade", { enabled: ad.enabled === true, atPct: pct, targetModel: target }, actor.userId);
      invalidateBudgetCache();
      return NextResponse.json({ ok: true });
    }

    if (body.featureModel) {
      const feature = body.featureModel.feature;
      if (!isAiFeatureKey(feature)) return NextResponse.json({ error: "알 수 없는 기능 키입니다." }, { status: 400 });
      const raw = body.featureModel.model;
      let model: string | null = null;
      if (raw != null && String(raw).trim()) {
        model = normalizeModelFamily(String(raw));
        const price = (await listCurrentModelPrices()).find((p) => p.modelFamily === model);
        if (!price) return NextResponse.json({ error: "단가표에 등록된 모델만 선택할 수 있습니다. 단가표에 먼저 추가하세요." }, { status: 400 });
        if (!price.selectable) return NextResponse.json({ error: "선택 비노출로 설정된 모델입니다." }, { status: 400 });
        if (AI_FEATURES[feature].vision && !price.supportsVision) {
          return NextResponse.json({ error: "이미지·PDF 입력을 쓰는 기능에는 비전 미지원 모델을 적용할 수 없습니다." }, { status: 400 });
        }
        if (price.deprecatedAt) return NextResponse.json({ error: `${price.displayName} 은(는) 폐기 예정 모델입니다.` }, { status: 400 });
      }
      const overrides = await setFeatureModelOverride(feature, model, actor.userId);
      return NextResponse.json({ ok: true, featureModelOverrides: overrides });
    }

    if ("usdKrwRate" in body) {
      const n = body.usdKrwRate == null || body.usdKrwRate === "" ? null : Number(body.usdKrwRate);
      if (n != null && (!Number.isFinite(n) || n <= 0)) return NextResponse.json({ error: "환율은 양수여야 합니다." }, { status: 400 });
      await saveAiSetting("usdKrwRate", n, actor.userId);
      return NextResponse.json({ ok: true });
    }

    if ("singleCallAlertUsd" in body) {
      const n = body.singleCallAlertUsd == null || body.singleCallAlertUsd === "" ? null : Number(body.singleCallAlertUsd);
      if (n != null && (!Number.isFinite(n) || n <= 0)) return NextResponse.json({ error: "단건 고비용 임계는 양수여야 합니다." }, { status: 400 });
      await saveAiSetting("singleCallAlertUsd", n, actor.userId);
      return NextResponse.json({ ok: true });
    }

    if ("forecastWindowDays" in body) {
      const n = Number(body.forecastWindowDays);
      if (!Number.isInteger(n) || n < 1 || n > 31) return NextResponse.json({ error: "예측 창은 1~31일 사이여야 합니다." }, { status: 400 });
      await saveAiSetting("forecastWindowDays", n, actor.userId);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "변경할 항목이 없습니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
