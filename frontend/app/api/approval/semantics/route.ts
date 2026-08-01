import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getSemanticsOverview, listUnlinkedDocs } from "@/lib/approval/semantics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 데이터 관계 맵·연결 진단(운영자용).
//   기본 = 전체 개요(양식·엣지·시스템 소스·경고)
//   ?formId=&fieldKey= = 해당 참조 필드의 미연결 문서 목록
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const formId = req.nextUrl.searchParams.get("formId");
    const fieldKey = req.nextUrl.searchParams.get("fieldKey");
    if (formId && fieldKey) {
      return NextResponse.json({ docs: await listUnlinkedDocs(formId, fieldKey) });
    }
    return NextResponse.json(await getSemanticsOverview());
  } catch (err) {
    return authErrorToResponse(err);
  }
}
