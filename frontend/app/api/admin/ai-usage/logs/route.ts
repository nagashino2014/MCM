import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { isYmd, kstToday, listUsageLogs, monthBounds } from "@/lib/ai/usage-stats";
import { AI_FEATURES, isAiFeatureKey } from "@/lib/ai/features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/admin/ai-usage/logs?from&to&feature&status&model&userId&page&pageSize[&format=csv]
// 호출 이력 드릴다운. format=csv 면 필터 전체(최대 5,000행)를 CSV(BOM) 로 내려준다.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("ai.usage.view");
    const p = req.nextUrl.searchParams;
    const today = kstToday();
    const from = isYmd(p.get("from")) ? String(p.get("from")) : monthBounds(today).from;
    const toRaw = isYmd(p.get("to")) ? String(p.get("to")) : today;
    const to = toRaw < from ? from : toRaw;
    const filter = {
      from,
      to,
      feature: String(p.get("feature") ?? "").trim() || null,
      status: String(p.get("status") ?? "").trim() || null,
      model: String(p.get("model") ?? "").trim() || null,
      userId: String(p.get("userId") ?? "").trim() || null,
    };
    const csv = p.get("format") === "csv";
    const page = csv ? 1 : Math.max(1, Number(p.get("page") ?? 1) || 1);
    const pageSize = csv ? 5000 : Math.min(200, Math.max(10, Number(p.get("pageSize") ?? 50) || 50));

    const { total, rows } = await listUsageLogs(filter, page, pageSize);

    if (csv) {
      const esc = (v: unknown) => {
        const s = v == null ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = [
        "called_at_kst", "feature_key", "feature_label", "model", "status", "input_tokens", "cache_creation_input_tokens",
        "cache_read_input_tokens", "output_tokens", "cost_usd", "latency_ms", "stop_reason", "request_id", "user", "subject_type", "subject_id", "env",
      ];
      const lines = rows.map((r) =>
        [
          new Date(new Date(r.calledAt).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " "),
          r.featureKey,
          isAiFeatureKey(r.featureKey) ? AI_FEATURES[r.featureKey].label : "",
          r.model, r.status, r.inputTokens, r.cacheCreationInputTokens, r.cacheReadInputTokens, r.outputTokens,
          r.costUsd ?? "", r.latencyMs ?? "", r.stopReason ?? "", r.requestId ?? "", r.userName ?? r.userId ?? "",
          r.subjectType ?? "", r.subjectId ?? "", r.env ?? "",
        ].map(esc).join(",")
      );
      const body = "﻿" + [header.join(","), ...lines].join("\r\n");
      return new NextResponse(body, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="ai-usage-${from}_${to}.csv"`,
          "cache-control": "no-store",
        },
      });
    }

    return NextResponse.json({ total, page, pageSize, rows });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
