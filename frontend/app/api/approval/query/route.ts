import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listDocsByForm } from "@/lib/approval/docs";
import { getForm } from "@/lib/approval/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 양식별 문서 조회(관리자) — 필드 컬럼 데이터 테이블의 소스. ?formId=&status=&from=&to=&q=
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const sp = req.nextUrl.searchParams;
    const formId = String(sp.get("formId") ?? "");
    if (!formId) return NextResponse.json({ error: "formId 가 필요합니다." }, { status: 400 });
    const form = await getForm(formId);
    if (!form) return NextResponse.json({ error: "양식을 찾을 수 없습니다." }, { status: 404 });
    const docs = await listDocsByForm({
      formId,
      status: (sp.get("status") as "all" | "approved" | "in_progress" | "rejected") ?? "all",
      from: sp.get("from"),
      to: sp.get("to"),
      q: sp.get("q"),
    });
    return NextResponse.json({ fields: form.fields, docs });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
