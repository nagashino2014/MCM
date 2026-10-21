import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { createPosting, createTemplateEditPosting, duplicatePosting, listPostings } from "@/lib/recruit/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 채용공고 목록(콘텐츠 트리 제외한 메타만). ?division=&hireType=&platform=&q= 로 검색.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("recruit.view", { fallbackRoles: ["admin", "editor"] });
    const sp = req.nextUrl.searchParams;
    return NextResponse.json({
      postings: await listPostings({
        division: sp.get("division"),
        hireType: sp.get("hireType"),
        platform: sp.get("platform"),
        q: sp.get("q"),
      }),
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 새 공고 생성 — 선택한 템플릿의 design_tree 사본으로 시작. { copyFrom: postingId } 면 기존 공고 복제(재활용).
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("recruit.manage", { fallbackRoles: ["admin"] });
    const body = await req.json();
    if (body?.copyFrom) {
      const posting = await duplicatePosting(String(body.copyFrom), ctx.userId);
      return NextResponse.json({ posting }, { status: 201 });
    }
    const templateId = String(body?.templateId ?? "");
    if (!templateId) return NextResponse.json({ error: "templateId 가 필요합니다." }, { status: 400 });
    // 템플릿 [내용 편집]용(F-40) — 목록에 안 보이는 편집용 공고. 같은 템플릿의 이전 편집용 공고는 정리한다.
    if (body?.purpose === "template_edit") {
      const posting = await createTemplateEditPosting(templateId, ctx.userId);
      return NextResponse.json({ posting }, { status: 201 });
    }
    const posting = await createPosting({
      templateId,
      title: body?.title != null ? String(body.title) : undefined,
      meta: body?.meta && typeof body.meta === "object" ? body.meta : undefined,
      createdBy: ctx.userId,
    });
    return NextResponse.json({ posting }, { status: 201 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
