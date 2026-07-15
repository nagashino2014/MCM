import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { createSource, listSources } from "@/lib/scraper/sources-store";
import type { ScraperPurpose } from "@/lib/scraper/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 범용 스크래퍼 소스 목록. ?purpose=intel|bid 로 sink 필터. */
export async function GET(req: NextRequest) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const p = req.nextUrl.searchParams.get("purpose");
    const purpose = p === "intel" || p === "bid" ? (p as ScraperPurpose) : undefined;
    const sources = await listSources(purpose);
    return NextResponse.json({ sources });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** 소스 생성(name/base_url/purpose). api_profile 은 이후 analyze→PUT 으로 커밋. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "소스명은 필수입니다." }, { status: 400 });
    const purpose = body?.purpose === "bid" ? "bid" : "intel";
    const source = await createSource({
      name,
      baseUrl: body?.baseUrl ? String(body.baseUrl) : null,
      purpose,
      slug: body?.slug ? String(body.slug) : undefined,
      authSecret: body?.authSecret ? String(body.authSecret) : undefined,
      updatedBy: ctx.userId,
    });
    return NextResponse.json({ source });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
