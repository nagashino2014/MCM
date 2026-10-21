import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getPosting, getPostingVersion, listPostingVersions } from "@/lib/recruit/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ postingId: string }>;
}

// [버전 저장] 스냅샷 조회(F-40) — 목록(?version 없음) 또는 한 버전의 콘텐츠·테마(?version=N).
// 복원은 편집기가 불러온 내용을 자동 저장(PUT /api/recruit/postings/[postingId])으로 덮어쓴다 — 별도 쓰기 경로 없음.
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    await requirePermission("recruit.view", { fallbackRoles: ["admin", "editor"] });
    const { postingId } = await context.params;
    if (!(await getPosting(postingId))) {
      return NextResponse.json({ error: "공고를 찾을 수 없습니다." }, { status: 404 });
    }
    const raw = req.nextUrl.searchParams.get("version");
    if (raw != null) {
      const version = Number(raw);
      if (!Number.isInteger(version) || version < 1) {
        return NextResponse.json({ error: "버전 번호가 올바르지 않습니다." }, { status: 400 });
      }
      const row = await getPostingVersion(postingId, version);
      if (!row) return NextResponse.json({ error: "버전을 찾을 수 없습니다." }, { status: 404 });
      return NextResponse.json({ version: row });
    }
    return NextResponse.json({ versions: await listPostingVersions(postingId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
