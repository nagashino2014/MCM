import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { MASTER_DOC_ID } from "@/lib/catalog/projects";
import { getStudioVersion } from "@/lib/catalog/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 버전 스냅샷(설정·쪽 상태) — 스튜디오가 불러와 지금 편집 상태로 되돌린다(되돌리기도 실행 취소 가능)
export async function GET(req: NextRequest, { params }: { params: Promise<{ version: string }> }) {
  try {
    await requirePermission("catalog.manage");
    const { version } = await params;
    const n = Number(version);
    const docId = req.nextUrl.searchParams.get("doc") || MASTER_DOC_ID;
    if (!Number.isInteger(n) || n < 1 || !/^[A-Za-z0-9_-]{1,40}$/.test(docId)) return NextResponse.json({ error: "버전이 올바르지 않습니다." }, { status: 400 });
    const snap = await getStudioVersion(docId, n);
    if (!snap) return NextResponse.json({ error: "버전을 찾지 못했습니다." }, { status: 404 });
    return NextResponse.json({ version: n, ...snap });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
