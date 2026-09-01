import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { createPosting, listPostings } from "@/lib/recruit/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 채용공고 목록(콘텐츠 트리 제외한 메타만).
export async function GET() {
  try {
    await requirePermission("recruit.view", { fallbackRoles: ["admin", "editor"] });
    return NextResponse.json({ postings: await listPostings() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// 새 공고 생성 — 선택한 템플릿의 design_tree 사본으로 시작.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("recruit.manage", { fallbackRoles: ["admin"] });
    const body = await req.json();
    const templateId = String(body?.templateId ?? "");
    if (!templateId) return NextResponse.json({ error: "templateId 가 필요합니다." }, { status: 400 });
    const posting = await createPosting({
      templateId,
      title: body?.title != null ? String(body.title) : undefined,
      createdBy: ctx.userId,
    });
    return NextResponse.json({ posting }, { status: 201 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
