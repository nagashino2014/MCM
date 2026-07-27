import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { createCategory, deleteCategory, listCategories } from "@/lib/mail/categories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 카테고리(=보관함 사용자 폴더) 목록 + 보관 건수.
export async function GET() {
  try {
    const ctx = await requireSession();
    return NextResponse.json({ categories: await listCategories(ctx.userId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 카테고리 생성 — body: { name }
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => ({}))) as { name?: string };
    const folderId = await createCategory(ctx.userId, String(body.name ?? ""));
    return NextResponse.json({ ok: true, folderId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE ?id=&mode=delete|move&target= : 카테고리 삭제(보관 메일 처리 선택).
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const id = String(req.nextUrl.searchParams.get("id") ?? "");
    const mode = String(req.nextUrl.searchParams.get("mode") ?? "delete") as "delete" | "move";
    const target = req.nextUrl.searchParams.get("target") ?? undefined;
    if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
    await deleteCategory(ctx.userId, id, mode === "move" ? "move" : "delete", target ?? undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
