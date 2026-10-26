import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { generateCatalogPdf, listCatalogEditions } from "@/lib/catalog/render/editions";
import { parseRenderOptions } from "@/lib/catalog/render/options";
import { ConverterError } from "@/lib/print-kit/converter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 본편+부록 PDF 생성(converter Chromium) — 목표 60초 이하, 여유를 둔다
export const maxDuration = 180;

// GET: 최근 생성본 목록(마스터본) — 발행본 목록은 /api/catalog/editions
export async function GET() {
  try {
    await requirePermission("catalog.manage");
    return NextResponse.json({ editions: await listCatalogEditions(undefined, 20, { stage: "generated" }) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 마스터본 PDF 생성 { edition: print|draft, naming: masked|real, scope: full|summary } → 생성본 요약(쪽 수·넘침 경고·크기·시간)
// 여기서 만드는 것은 검토용 생성본이다. 발행(대외 배포본 확정)은 /api/catalog/editions — 인쇄·배포본 생성본을 그대로 승격할 수 있다.
// 지금 데이터로 실명판까지 만들 수 있어 catalog.manage(전 직원 열람 catalog.view 와 분리, 312).
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const opts = parseRenderOptions((await req.json().catch(() => ({}))) as Record<string, unknown>);
    const edition = await generateCatalogPdf(opts, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "catalog_render",
      targetTable: "catalog_editions",
      targetId: edition.editionId,
      after: { edition: edition.edition, naming: edition.naming, scope: edition.scope, pages: edition.pages, warnings: edition.warnings.length },
    });
    return NextResponse.json({ edition });
  } catch (err) {
    if (err instanceof ConverterError) return NextResponse.json({ error: err.message }, { status: err.status });
    return authErrorToResponse(err);
  }
}
