import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getForm } from "@/lib/approval/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 양식 단건(필드 스키마 포함) — 기안 렌더러·빌더 공용
export async function GET(_req: NextRequest, { params }: { params: Promise<{ formId: string }> }) {
  try {
    await requirePermission("approval.view");
    const { formId } = await params;
    const form = await getForm(formId);
    if (!form) return NextResponse.json({ error: "양식을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ form });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
