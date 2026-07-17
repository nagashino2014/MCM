import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { createCategory, listCategories } from "@/lib/bid/category-store";
import { normalizeGroups } from "@/lib/bid/match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 용역 분류 설정 목록(074 bid_categories). */
export async function GET() {
  try {
    await requirePermission("sales.view");
    const categories = await listCategories();
    return NextResponse.json({ categories });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 분류 생성 — { name, rule: [{op, keywords[]}] } (구형 keywords: string[] 도 허용). */
export async function POST(req: NextRequest) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "분류명은 필수입니다." }, { status: 400 });
    const rule = normalizeGroups(body?.rule);
    const keywords = Array.isArray(body?.keywords) ? body.keywords.map(String) : [];
    if (!rule.length && !keywords.length) {
      return NextResponse.json({ error: "조건 키워드를 1개 이상 입력하세요." }, { status: 400 });
    }
    const category = await createCategory({ name, keywords, rule });
    return NextResponse.json({ category });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
