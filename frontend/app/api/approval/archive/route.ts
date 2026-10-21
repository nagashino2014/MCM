import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listActedDocs, listDeptDocs, listMyDocs, listOrgFolderDocs, listOrgFolders, listWatchedDocs } from "@/lib/approval/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 문서함 — tab=mine(내 기안 완료)|acted(내가 결재한)|dept(부서 완료)|org(전사, &folder=)
//   화면이 20·30·50개씩 쪽을 나눠 보여 주므로 최근 500건까지 내려준다(10-21, 이전 50건).
const ARCHIVE_LIMIT = 500;
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const sp = req.nextUrl.searchParams;
    const tab = String(sp.get("tab") ?? "mine");
    if (tab === "mine") return NextResponse.json({ docs: await listMyDocs(ctx.userId, "completed", ARCHIVE_LIMIT) });
    if (tab === "acted") return NextResponse.json({ docs: await listActedDocs(ctx.userId, ARCHIVE_LIMIT) });
    if (tab === "watched") return NextResponse.json({ docs: await listWatchedDocs(ctx.userId, ARCHIVE_LIMIT) });
    if (tab === "dept") return NextResponse.json({ docs: await listDeptDocs(ctx.userId, ARCHIVE_LIMIT) });
    if (tab === "org") {
      const folders = await listOrgFolders();
      const folder = sp.get("folder") ?? folders[0] ?? null;
      return NextResponse.json({ folders, folder, docs: folder ? await listOrgFolderDocs(folder, ARCHIVE_LIMIT) : [] });
    }
    return NextResponse.json({ error: "tab 파라미터가 올바르지 않습니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
