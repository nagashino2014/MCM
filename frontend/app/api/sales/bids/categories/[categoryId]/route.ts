import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { deleteCategory, updateCategory } from "@/lib/bid/category-store";
import { normalizeGroups } from "@/lib/bid/match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Ctx {
  params: Promise<{ categoryId: string }>;
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { categoryId } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    await updateCategory(categoryId, {
      name: body?.name !== undefined ? String(body.name) : undefined,
      keywords: Array.isArray(body?.keywords) ? body.keywords.map(String) : undefined,
      rule: body?.rule !== undefined ? normalizeGroups(body.rule) : undefined,
      enabled: typeof body?.enabled === "boolean" ? body.enabled : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function DELETE(_: NextRequest, ctx: Ctx) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const { categoryId } = await ctx.params;
    await deleteCategory(categoryId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
