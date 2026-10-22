import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { applyAppendixRules, sanitizeAppendixRules, type AppendixResult } from "@/lib/catalog/appendix";
import { MASTER_DOC_ID, getAppendixRules, listCatalogProjects } from "@/lib/catalog/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function brief(r: AppendixResult) {
  return {
    shownRows: r.shownRows,
    shownContracts: r.shownContracts,
    hiddenContracts: r.hiddenContracts,
    hiddenByReason: r.hiddenByReason,
    estimatedPages: r.estimatedPages,
    byCategory: r.sections.map((s) => ({ category: s.category, shownRows: s.shownRows, shownContracts: s.shownContracts, hiddenContracts: s.hiddenContracts })),
  };
}

// POST: 표시 범위 미리보기 { rules } → 저장된 규칙 대비 표시 행 수·예상 쪽 수(저장하지 않음)
export async function POST(req: NextRequest) {
  try {
    await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as { rules?: unknown };
    const [rows, saved] = await Promise.all([listCatalogProjects(), getAppendixRules(MASTER_DOC_ID)]);
    const draft = sanitizeAppendixRules(body.rules);
    return NextResponse.json({
      draft: { rules: draft, ...brief(applyAppendixRules(rows, draft)) },
      saved: { rules: saved, ...brief(applyAppendixRules(rows, saved)) },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
