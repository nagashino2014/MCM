import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { loadCatalogRenderData } from "@/lib/catalog/render/data";
import { buildCatalogHtml } from "@/lib/catalog/render/html";
import { parseRenderOptions } from "@/lib/catalog/render/options";
import { MASTER_DOC_ID } from "@/lib/catalog/projects";
import { loadStudioDoc } from "@/lib/catalog/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 회사소개서 HTML 미리보기 — PDF 와 같은 HTML·같은 쪽 나누기 스크립트(print-kit)를 앱 주소로 연다. 스튜디오 편집본을 얹는다.
// ?edition=print|draft&naming=masked|real&doc=master
export async function GET(req: NextRequest) {
  try {
    await requirePermission("catalog.view");
    const opts = parseRenderOptions(Object.fromEntries(req.nextUrl.searchParams));
    const docId = req.nextUrl.searchParams.get("doc") || MASTER_DOC_ID;
    const [data, studio] = await Promise.all([loadCatalogRenderData({ ...opts, docId }), loadStudioDoc(docId)]);
    const built = await buildCatalogHtml(data, { ...opts, target: "preview", pages: studio?.pages ?? [] });
    return new NextResponse(built.html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        // 미리보기 문서는 앱 출처의 자산만 쓴다
        "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'unsafe-inline'; font-src 'self'; frame-ancestors 'self'",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
