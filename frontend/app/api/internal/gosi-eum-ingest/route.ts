import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { ingestEumGosiItems } from "@/lib/intel/collect-gosi";
import { disclosureCutoffIso, loadIntelSettings } from "@/lib/intel/intel-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 토지이음(eum) 로컬 수집 에이전트 반입구 — eum.go.kr 이 AWS IP 대역을 차단해
 * 로컬 PC(scripts/collect-eum-local.mjs)가 목록을 긁어 이 라우트로 올린다.
 * AUTH_SECRET 헤더 가드(bid-notify-tick 패턴). 적재는 서버 수집과 동일 규칙·멱등.
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key") ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!secret || key !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const body = (await req.json().catch(() => ({}))) as { items?: unknown };
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return NextResponse.json({ error: "items가 비어 있습니다." }, { status: 400 });
    if (items.length > 2000) return NextResponse.json({ error: "items가 너무 많습니다(최대 2000)." }, { status: 400 });
    const settings = await loadIntelSettings(await getDb());
    const result = await ingestEumGosiItems(items, { disclosureCutoffIso: disclosureCutoffIso(settings) });
    console.log("[gosi-eum-ingest]", JSON.stringify(result));
    return NextResponse.json(result);
  } catch (err) {
    console.error("[gosi-eum-ingest] error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
