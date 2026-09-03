import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getDailySeries, getFeatureStats, getKpis, getModelStats, getMonthlySeries, isYmd, kstToday, monthBounds } from "@/lib/ai/usage-stats";
import { loadAiSettings } from "@/lib/ai/settings";
import { listCurrentModelPrices } from "@/lib/ai/pricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/ai-usage/summary?from=YYYY-MM-DD&to=YYYY-MM-DD&asOf=YYYY-MM-DD
// /admin/ai-usage 한 화면분 — KPI(기준일 asOf)·기능별·모델별·일별(from~to)·월별 12개월·설정·단가.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("ai.usage.view");
    // 화면의 편집 UI 노출 여부 — manage 권한은 별도 키(둘 다 tpl-system-admin 에 시드).
    const canManage = await requirePermission("ai.usage.manage").then(() => true, () => false);
    const p = req.nextUrl.searchParams;
    const today = kstToday();
    const asOf = isYmd(p.get("asOf")) ? String(p.get("asOf")) : today;
    const mb = monthBounds(asOf);
    const from = isYmd(p.get("from")) ? String(p.get("from")) : mb.from;
    const toRaw = isYmd(p.get("to")) ? String(p.get("to")) : asOf;
    const to = toRaw < from ? from : toRaw;

    const settings = await loadAiSettings({ fresh: true });
    const [kpis, features, models, daily, monthly, prices] = await Promise.all([
      getKpis(asOf, settings.forecastWindowDays),
      getFeatureStats(from, to, asOf),
      getModelStats(from, to),
      getDailySeries(from, to),
      getMonthlySeries(asOf, 12),
      listCurrentModelPrices(),
    ]);

    return NextResponse.json({ asOf, range: { from, to }, kpis, features, models, daily, monthly, settings, prices, canManage });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
