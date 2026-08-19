import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import {
  deleteLibraryFiles,
  listLibraryFileIds,
  listLibraryFiles,
  type FileSource,
  type LibraryFilter,
} from "@/lib/files/library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SOURCES: FileSource[] = ["approval", "chat", "facility", "board", "issue"];

function filterFromParams(params: URLSearchParams): LibraryFilter {
  const source = params.get("source") ?? "";
  return {
    source: SOURCES.includes(source as FileSource) ? (source as FileSource) : "",
    format: params.get("format") ?? "",
    fromYm: params.get("from") ?? "",
    toYm: params.get("to") ?? "",
    q: params.get("q") ?? "",
  };
}

// GET /api/files — 통합 파일 목록(소스·형식·기간·검색어 필터 + 페이지네이션).
export async function GET(req: NextRequest) {
  try {
    await requirePermission("files.manage");
    const params = req.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize") ?? 30) || 30));
    const { rows, total } = await listLibraryFiles(filterFromParams(params), page, pageSize);
    return NextResponse.json({ files: rows, total, page, pageSize });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE /api/files — 선택 삭제({ids}) 또는 일괄 삭제({mode:'filtered', filter}).
export async function DELETE(req: NextRequest) {
  try {
    await requirePermission("files.manage");
    const body = (await req.json().catch(() => ({}))) as {
      ids?: string[];
      mode?: string;
      filter?: { source?: string; format?: string; from?: string; to?: string; q?: string };
    };

    let ids: string[];
    if (body.mode === "filtered") {
      const f = body.filter ?? {};
      ids = await listLibraryFileIds({
        source: SOURCES.includes(f.source as FileSource) ? (f.source as FileSource) : "",
        format: f.format ?? "",
        fromYm: f.from ?? "",
        toYm: f.to ?? "",
        q: f.q ?? "",
      });
    } else {
      ids = Array.isArray(body.ids) ? body.ids.filter((v) => typeof v === "string") : [];
    }
    if (ids.length === 0) {
      return NextResponse.json({ error: "삭제할 파일이 없습니다." }, { status: 400 });
    }
    const result = await deleteLibraryFiles(ids);
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
