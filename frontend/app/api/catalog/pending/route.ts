import { NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { catalogRoles, listOpenPending, loadBaseline, loadRefreshState, runCatalogRefresh } from "@/lib/catalog/refresh/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 회사소개서 반영 대기(P7, 블루프린트 §6-7) — 최근 발행본과 지금 데이터의 차이. 관리·발행 담당(catalog.manage 또는 publish).
async function requireSteward() {
  const actor = await requirePermission("catalog.view");
  const roles = await catalogRoles(actor.userId);
  if (!roles.manage && !roles.publish) throw new AuthError("반영 대기는 회사소개서 관리·발행 담당만 볼 수 있습니다.", 403);
  return actor;
}

async function payload() {
  const [items, baseline, state] = await Promise.all([listOpenPending(), loadBaseline(), loadRefreshState()]);
  return {
    items,
    baseline: baseline ? { editionId: baseline.editionId, publishedAt: baseline.publishedAt, label: baseline.label } : null,
    lastCheckedAt: state.lastCheckedAt,
  };
}

// GET: { items[], baseline, lastCheckedAt }
export async function GET() {
  try {
    await requireSteward();
    return NextResponse.json(await payload());
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 지금 다시 점검(알림 없이) → 같은 모양 + 이번 점검 결과
export async function POST() {
  try {
    await requireSteward();
    const result = await runCatalogRefresh({ notify: false });
    return NextResponse.json({ ...(await payload()), result });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
