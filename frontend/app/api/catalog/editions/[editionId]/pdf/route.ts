import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAccessLog } from "@/lib/auth/access-log";
import { getCatalogEditionFile } from "@/lib/catalog/render/editions";
import { catalogRoles } from "@/lib/catalog/refresh/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 회사소개서 생성본·발행본 PDF — ?download=1 이면 받기(첨부), 아니면 브라우저 미리보기(inline)
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
    if (summary.naming === "real") {
      await recordAccessLog({
        actorUserId: actor.userId,
        action: download ? "download" : "view",
        targetKind: "catalog_edition",
        targetId: editionId,
        detail: { stage: summary.stage, scope: summary.scope, naming: summary.naming },
      });
    }
    const name = summary.fileName || `${editionId}.pdf`;
    return new NextResponse(new Uint8Array(hit.pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(hit.pdf.length),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
