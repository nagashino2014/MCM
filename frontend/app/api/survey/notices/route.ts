import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { createNotice, listNotices } from "@/lib/survey/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// QR 배포 이미지 목록. ?surveyId= 로 설문별 필터.
export async function GET(req: NextRequest) {
  try {
    await requirePermission("survey.view", { fallbackRoles: ["admin", "editor"] });
    return NextResponse.json({ notices: await listNotices(req.nextUrl.searchParams.get("surveyId")) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("survey.manage", { fallbackRoles: ["admin"] });
    const body = await req.json();
    const notice = await createNotice({
      surveyId: body?.surveyId != null ? String(body.surveyId) : null,
      name: String(body?.name ?? "새 배포 이미지"),
      layout: body?.layout,
      fields: body?.fields,
      theme: body?.theme,
      createdBy: ctx.userId,
    });
    return NextResponse.json({ notice }, { status: 201 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
