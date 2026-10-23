import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { MASTER_DOC_ID } from "@/lib/catalog/projects";
import { loadCatalogRenderData } from "@/lib/catalog/render/data";
import { chooseCover } from "@/lib/catalog/render/html";
import { parseRenderOptions } from "@/lib/catalog/render/options";
import { StudioConflictError, listInfographicPrefs, listStudioImageAssets, loadStudioDoc, saveStudioDoc } from "@/lib/catalog/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const docIdOf = (req: NextRequest) => {
  const id = req.nextUrl.searchParams.get("doc") || MASTER_DOC_ID;
  return /^[A-Za-z0-9_-]{1,40}$/.test(id) ? id : MASTER_DOC_ID;
};

// GET: 스튜디오 열기 — 문서 상태(설정·쪽 순서·숨김·편집층) + 지금 데이터(렌더 데이터) + 표지 선택 + 인포그래픽 선택 기록 + 사진 목록
// ?doc=master&edition=print|draft&naming=masked|real (데이터는 열 때마다 DB 에서 새로 읽는다 — 블루프린트 §6-1 초안 라이브)
export async function GET(req: NextRequest) {
  try {
    await requirePermission("catalog.manage");
    const docId = docIdOf(req);
    const opts = parseRenderOptions(Object.fromEntries(req.nextUrl.searchParams));
    const doc = await loadStudioDoc(docId);
    if (!doc) return NextResponse.json({ error: "회사소개서 문서를 찾지 못했습니다." }, { status: 404 });
    const data = await loadCatalogRenderData({ ...opts, docId });
    const notices: string[] = [];
    const cover = await chooseCover(data, notices);
    const [prefs, assets] = await Promise.all([listInfographicPrefs(), listStudioImageAssets()]);
    return NextResponse.json({ doc, data: { ...data, notices: [...data.notices, ...notices] }, cover, prefs, assets, opts });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 자동 저장 { rev, pages: [{key, order, hidden, edits}], meta: {쪽 키: {type, section}}, theme? } → { rev, theme }
// rev 가 다르면 409(다른 곳에서 먼저 고침). 편집층은 서버에서 다시 정리한다(lib/catalog/studio/edits.ts sanitizePageEdits).
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const out = await saveStudioDoc(
      docIdOf(req),
      {
        rev: typeof body.rev === "string" ? body.rev : "",
        pages: body.pages,
        meta: body.meta && typeof body.meta === "object" ? (body.meta as Record<string, { type?: string; section?: string }>) : {},
        theme: body.theme && typeof body.theme === "object" ? (body.theme as Record<string, string>) : undefined,
      },
      actor.userId
    );
    return NextResponse.json(out);
  } catch (err) {
    if (err instanceof StudioConflictError) return NextResponse.json({ error: err.message, conflict: true }, { status: 409 });
    return authErrorToResponse(err);
  }
}
