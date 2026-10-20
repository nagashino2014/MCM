import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { requireGlobalScope } from "@/lib/auth/scope-guards";
import { createDeptPost, listDeptPosts, revokeDeptPost, type PostKind } from "@/lib/org/posts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 부서 보직(겸직·부서장 지정, 300) — 직원 상세 인사관리 탭의 "겸직·부서장 보직" 칸.
 *   GET    ?employeeId=  미해제 보직 목록(없으면 전체 — 조직도 부서장 표시용)   org.view
 *   POST   보직 등록                                                          org.edit(전사)
 *          부서장 보직은 tpl-dept-lead 자동 배정을 수반하므로 rbac.assignment.manage 도 요구한다.
 *   DELETE ?postId=&endDate=  보직 해제                                        org.edit(전사)
 */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("org.view");
    const employeeId = req.nextUrl.searchParams.get("employeeId");
    return NextResponse.json({ posts: await listDeptPosts(employeeId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireGlobalScope("org.edit");
    const body = (await req.json().catch(() => ({}))) as {
      employeeId?: string;
      deptId?: string;
      postKind?: PostKind;
      title?: string | null;
      effectiveFrom?: string | null;
      effectiveTo?: string | null;
      note?: string | null;
    };
    if (body.postKind === "head") await requirePermission("rbac.assignment.manage");
    const post = await createDeptPost(actor.userId, {
      employeeId: String(body.employeeId ?? ""),
      deptId: String(body.deptId ?? ""),
      postKind: body.postKind === "head" ? "head" : body.postKind === "member" ? "member" : ("" as PostKind),
      title: body.title ?? null,
      effectiveFrom: body.effectiveFrom ?? null,
      effectiveTo: body.effectiveTo ?? null,
      note: body.note ?? null,
    });
    return NextResponse.json({ post });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireGlobalScope("org.edit");
    const postId = req.nextUrl.searchParams.get("postId") ?? "";
    const posts = await listDeptPosts();
    if (posts.find((p) => p.postId === postId)?.postKind === "head") await requirePermission("rbac.assignment.manage");
    await revokeDeptPost(actor.userId, postId, req.nextUrl.searchParams.get("endDate"));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
