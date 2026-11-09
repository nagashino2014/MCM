import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { adminEditDocField } from "@/lib/approval/admin-controls";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { fieldKey, value, reason }: 승인 완료 문서 관리자 값 수정(346) — 일자·시각·글 같은 간단한 항목 하나를 사유와 함께 고친다.
// 전후 값은 approval_doc_edits(문서 상세의 '관리자 수정 이력')와 감사 로그에 남는다. 휴가 문서면 연차 대장 사용분을 다시 계산한다.
export async function POST(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const ctx = await requirePermission("approval.manage");
    const { docId } = await params;
    const body = (await req.json().catch(() => ({}))) as { fieldKey?: string; value?: unknown; reason?: string };
    const result = await adminEditDocField({
      docId,
      actorUserId: ctx.userId,
      fieldKey: String(body.fieldKey ?? ""),
      value: body.value ?? null,
      reason: String(body.reason ?? ""),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof AuthError) return authErrorToResponse(err);
    const status = (err as { status?: number })?.status;
    if (err instanceof Error && err.message) return NextResponse.json({ error: err.message }, { status: status ?? 400 });
    return authErrorToResponse(err);
  }
}
