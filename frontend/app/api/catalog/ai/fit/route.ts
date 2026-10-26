import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { fitTexts, type FitItem } from "@/lib/catalog/ai/service";
import type { MetricBrief } from "@/lib/catalog/ai/patch";
import { METRIC_DEFS } from "@/lib/catalog/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST: [AI로 줄이기] { items: [{key, text, maxChars}], metricValues?: {지표 id: 값}, subject? } → 줄인 글(지표 표식 보존·새 숫자 없음, 실패 시 규칙 축약)
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as { items?: unknown; metricValues?: unknown; subject?: unknown };
    const items: FitItem[] = (Array.isArray(body.items) ? body.items : [])
      .map((raw) => {
        const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
        return { key: String(r.key ?? ""), text: String(r.text ?? ""), maxChars: Number(r.maxChars) };
      })
      .filter((it) => it.key && it.text && it.maxChars > 0);
    if (items.length === 0) return NextResponse.json({ error: "줄일 글이 없습니다." }, { status: 400 });
    // 지표는 사전에 있는 id 만(값은 길이 계산용 — 화면이 보낸 값)
    const values = (body.metricValues && typeof body.metricValues === "object" ? body.metricValues : {}) as Record<string, unknown>;
    const metrics: Record<string, MetricBrief> = Object.fromEntries(
      METRIC_DEFS.map((d) => [d.id, { id: d.id, label: d.label, unit: d.unit, footnote: d.footnote, value: typeof values[d.id] === "number" ? (values[d.id] as number) : null }])
    );
    const subject = typeof body.subject === "string" && /^[A-Za-z0-9_:.-]{1,80}$/.test(body.subject) ? { type: "catalog_page", id: body.subject } : null;
    return NextResponse.json(await fitTexts({ items, userId: actor.userId, subject, metrics }));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
