import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { createBoard, listAllBoardsForAdmin, listBoards } from "@/lib/todo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 보드 — GET 내 보드 목록(개인 기본 보드 자동 생성; ?all=1 은 todo.admin 전사 목록, 개인 보드 제외) / POST 생성.
// POST 입력 = lib/todo/types.ts TodoBoardCreateInput — kind(project|dept|shared) + project 는 mode(contract|manual|internal),
//   contractId·projectName·clientName·facilityId·color(팔레트 키)·name·memberIds. 응답 { board }(projectName·clientName·contractId·facilityId·color·colorHex 포함).
//   부서 보드는 canCreateDeptBoard(부서장·임원·관리자), 프로젝트·공유 보드는 누구나.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const sp = req.nextUrl.searchParams;
    const boards =
      sp.get("all") === "1" ? await listAllBoardsForAdmin(ctx.userId) : await listBoards(ctx.userId, { includeArchived: sp.get("archived") === "1" });
    return NextResponse.json({ boards });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = await req.json().catch(() => ({}));
    const board = await createBoard(ctx.userId, body ?? {});
    return NextResponse.json({ board }, { status: 201 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
