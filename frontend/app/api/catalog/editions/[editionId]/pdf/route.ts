import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAccessLog } from "@/lib/auth/access-log";
import { getCatalogEditionFile } from "@/lib/catalog/render/editions";
import { extractPdfPages, pageSuffix, parsePageSpec } from "@/lib/catalog/render/pdf-pages";
import { catalogRoles } from "@/lib/catalog/refresh/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 회사소개서 생성본·발행본 PDF — ?download=1 이면 받기(첨부), 아니면 브라우저 미리보기(inline)
//   ?pages=3 · 3-5 · 1,3-4 이면 그 쪽만 잘라 준다(스튜디오 쪽별 받기, 2026-11-25). 파일 이름 끝에 쪽 번호를 붙인다.
//   발행본 마스킹판 = 전 직원(catalog.view) · 발행본 실명판 = 관리·발행 담당 · 생성본(검토용) = 관리 담당.
//   실명판은 직원 개인정보(학력·자격·경력)가 실려 열람·받기를 접속기록(access_log)에 남긴다.
//   발행본 파일은 발행 때 저장한 그대로다 — 이후 데이터가 바뀌어도 같은 PDF 를 준다.
export async function GET(req: NextRequest, { params }: { params: Promise<{ editionId: string }> }) {
  try {
    const actor = await requirePermission("catalog.view");
    const { editionId } = await params;
    const hit = await getCatalogEditionFile(editionId);
    if (!hit) return NextResponse.json({ error: "PDF 를 찾을 수 없습니다." }, { status: 404 });
    const { summary } = hit;
    const roles = await catalogRoles(actor.userId);
    const allowed = summary.stage !== "published" ? roles.manage : summary.naming === "masked" || roles.manage || roles.publish;
    if (!allowed) {
      const msg =
        summary.stage !== "published"
          ? "검토용 생성본은 회사소개서 관리 담당만 볼 수 있습니다."
          : "실명판은 회사소개서 관리·발행 담당만 받을 수 있습니다. 마스킹판을 받으세요.";
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    const download = req.nextUrl.searchParams.get("download") === "1";
    const pageSpec = req.nextUrl.searchParams.get("pages");
    const pages = pageSpec ? parsePageSpec(pageSpec, summary.pages) : null;
    if (pageSpec && !pages) return NextResponse.json({ error: `쪽 번호가 올바르지 않습니다(1~${summary.pages}쪽, 예: 3 또는 3-5).` }, { status: 400 });
    if (summary.naming === "real") {
      await recordAccessLog({
        actorUserId: actor.userId,
        action: download ? "download" : "view",
        targetKind: "catalog_edition",
        targetId: editionId,
        detail: { stage: summary.stage, scope: summary.scope, naming: summary.naming, ...(pages ? { pages: pageSpec } : {}) },
      });
    }
    const fullName = summary.fileName || `${editionId}.pdf`;
    const name = pages ? fullName.replace(/\.pdf$/i, "") + pageSuffix(pages) + ".pdf" : fullName;
    const body = new Uint8Array(pages ? await extractPdfPages(hit.pdf, pages) : hit.pdf);
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(body.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
