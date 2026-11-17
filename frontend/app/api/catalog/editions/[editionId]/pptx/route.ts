import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAccessLog } from "@/lib/auth/access-log";
import { getCatalogEdition } from "@/lib/catalog/render/editions";
import { buildCatalogPptxForEdition } from "@/lib/catalog/render/pptx";
import { catalogRoles } from "@/lib/catalog/refresh/service";
import { ConverterError } from "@/lib/print-kit/converter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 쪽 그림(54쪽 기준 수 초) + 표지 다시 그리기(converter, 수 초~수십 초) — PDF 생성과 같은 여유
export const maxDuration = 300;

// GET: 회사소개서 생성본·발행본 → PPTX 받기(사용자 요청 2026-11-17)
//   첫 슬라이드 = 갑지 편집형 표지(바탕 그림 + 글상자·로고), 그 뒤 = PDF 쪽 그림(PDF 표지 그림은 숨긴 슬라이드).
//   권한은 PDF 받기와 같다 — 발행본 마스킹판 = 전 직원, 발행본 실명판·생성본 = 관리(·발행) 담당. 실명판은 접속기록.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ editionId: string }> }) {
  try {
    const actor = await requirePermission("catalog.view");
    const { editionId } = await params;
    const summary = await getCatalogEdition(editionId);
    if (!summary?.pdfKey) return NextResponse.json({ error: "회사소개서 PDF 를 찾을 수 없습니다." }, { status: 404 });
    const roles = await catalogRoles(actor.userId);
    const allowed = summary.stage !== "published" ? roles.manage : summary.naming === "masked" || roles.manage || roles.publish;
    if (!allowed) {
      const msg =
        summary.stage !== "published"
          ? "검토용 생성본은 회사소개서 관리 담당만 받을 수 있습니다."
          : "실명판은 회사소개서 관리·발행 담당만 받을 수 있습니다. 마스킹판을 받으세요.";
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    const built = await buildCatalogPptxForEdition(editionId);
    if (!built) return NextResponse.json({ error: "회사소개서 PDF 를 찾을 수 없습니다." }, { status: 404 });
    if (summary.naming === "real") {
      await recordAccessLog({
        actorUserId: actor.userId,
        action: "download",
        targetKind: "catalog_edition",
        targetId: editionId,
        detail: { stage: summary.stage, scope: summary.scope, naming: summary.naming, format: "pptx" },
      });
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Length": String(built.data.length),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(built.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    // 표지를 글상자로 바꾸지 못했으면 이유를 머리글로(그림형만 들어감)
    if (built.coverNotice) headers["X-Catalog-Pptx-Notice"] = encodeURIComponent(built.coverNotice);
    return new NextResponse(new Uint8Array(built.data), { headers });
  } catch (err) {
    if (err instanceof ConverterError) return NextResponse.json({ error: err.message }, { status: err.status });
    return authErrorToResponse(err);
  }
}
