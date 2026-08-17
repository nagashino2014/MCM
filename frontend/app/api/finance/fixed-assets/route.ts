import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  buildSchedule,
  deactivateFixedAsset,
  disposeFixedAsset,
  listFixedAssets,
  loadDecliningRates,
  saveFixedAsset,
} from "@/lib/finance/depreciation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 고정자산 대장 + 자산별 상각 스케줄(올해 말까지)
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const assets = await listFixedAssets();
    const rates = await loadDecliningRates();
    const toYm = `${new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear()}-12`;
    const withSchedule = assets.map((a) => {
      const schedule = buildSchedule(a, toYm, rates);
      const appAccum = schedule.reduce((acc, s) => acc + s.amount, 0);
      return {
        ...a,
        schedule: req.nextUrl.searchParams.get("schedule") === "1" ? schedule : undefined,
        totalAccum: a.openingAccum + appAccum,
        bookValue: a.acquisitionCost - a.openingAccum - appAccum,
      };
    });
    return NextResponse.json({ assets: withSchedule });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  action?: "save" | "dispose" | "deactivate";
  asset?: {
    faId?: string;
    name?: string;
    category?: string;
    acquisitionDate?: string;
    acquisitionCost?: number;
    method?: string;
    usefulLifeYears?: number;
    residualValue?: number;
    openingAccum?: number;
    openingAsOf?: string | null;
    linkedAssetId?: string | null;
    memo?: string | null;
  };
  faId?: string;
  disposedAt?: string;
  memo?: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("finance.manage");
    const body = (await req.json().catch(() => ({}))) as PostBody;

    if (body.action === "save") {
      const a = body.asset;
      if (
        !a?.name?.trim() ||
        !a.category ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(a.acquisitionDate ?? "")) ||
        !(Number(a.acquisitionCost) > 0) ||
        !(Number(a.usefulLifeYears) > 0)
      ) {
        return NextResponse.json({ error: "자산명·구분·취득일(YYYY-MM-DD)·취득가액·내용연수가 필요합니다." }, { status: 400 });
      }
      const faId = await saveFixedAsset({
        faId: a.faId,
        name: a.name,
        category: a.category,
        acquisitionDate: String(a.acquisitionDate),
        acquisitionCost: Number(a.acquisitionCost),
        method: String(a.method ?? "straight"),
        usefulLifeYears: Number(a.usefulLifeYears),
        residualValue: a.residualValue != null ? Number(a.residualValue) : undefined,
        openingAccum: a.openingAccum != null ? Number(a.openingAccum) : undefined,
        openingAsOf: a.openingAsOf,
        linkedAssetId: a.linkedAssetId,
        memo: a.memo,
      });
      await recordAuditLog({ actorUserId: ctx.userId, action: "fixed_asset_save", targetTable: "fixed_assets", targetId: faId });
      return NextResponse.json({ faId });
    }
    if (!body.faId) return NextResponse.json({ error: "faId 가 필요합니다." }, { status: 400 });
    if (body.action === "dispose") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.disposedAt ?? ""))) {
        return NextResponse.json({ error: "처분일(YYYY-MM-DD)이 필요합니다." }, { status: 400 });
      }
      await disposeFixedAsset(body.faId, String(body.disposedAt), body.memo);
      await recordAuditLog({ actorUserId: ctx.userId, action: "fixed_asset_save", targetTable: "fixed_assets", targetId: body.faId, after: { disposedAt: body.disposedAt } });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "deactivate") {
      await deactivateFixedAsset(body.faId);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "action 이 올바르지 않습니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
