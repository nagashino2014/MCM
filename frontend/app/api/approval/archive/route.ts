import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { listActedDocs, listDeptDocs, listMyDocs, listOrgFolderDocs, listOrgFolders, listWatchedDocs } from "@/lib/approval/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 문서함 — tab=mine(내 기안 완료)|acted(내가 결재한)|dept(부서 완료)|org(전사, &folder=)
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const sp = req.nextUrl.searchParams;
    const tab = String(sp.get("tab") ?? "mine");
    if (tab === "mine") return NextResponse.json({ docs: await listMyDocs(ctx.userId, "completed", 50) });
    if (tab === "acted") return NextResponse.json({ docs: await listActedDocs(ctx.userId, 50) });
    if (tab === "watched") return NextResponse.json({ docs: await listWatchedDocs(ctx.userId) });
    if (tab === "dept") return NextResponse.json({ docs: await listDeptDocs(ctx.userId) });
    if (tab === "org") {
      // 인사·회계·성과급·근태 폴더(304)는 관리자·인사/회계(approval.manage)·대표이사(approval.read_all)만(2026-10-21)
      const privileged =
        (await hasPermission(ctx.userId, "approval.manage")) || (await hasPermission(ctx.userId, "approval.read_all"));
      const folders = await listOrgFolders({ includeRestricted: privileged });
      const requested = sp.get("folder");
      const folder = requested && folders.includes(requested) ? requested : folders[0] ?? null;
      return NextResponse.json({ folders, folder, docs: folder ? await listOrgFolderDocs(folder) : [] });
    }
    return NextResponse.json({ error: "tab 파라미터가 올바르지 않습니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
