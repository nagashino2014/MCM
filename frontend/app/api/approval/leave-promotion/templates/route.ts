import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { listNoticeTemplates, saveNoticeTemplate } from "@/lib/approval/leave-promotion";
import { getCompanyProfile } from "@/lib/company/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 1·2차 연차 고지 문구 템플릿(admin) — 양식 관리 화면. 발신 표기용 회사 정보 동봉.
export async function GET() {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const [templates, company] = await Promise.all([listNoticeTemplates(), getCompanyProfile().catch(() => null)]);
    return NextResponse.json({
      templates,
      company: company ? { companyName: company.companyName, ceoName: company.ceoName } : null,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 고지 문구 템플릿 저장(admin) — { round, title, body[] }
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as { round?: number; title?: string; body?: string[] };
    const round = Number(body.round);
    if (round !== 1 && round !== 2) return NextResponse.json({ error: "round 는 1 또는 2 여야 합니다." }, { status: 400 });
    if (typeof body.title !== "string" || !Array.isArray(body.body))
      return NextResponse.json({ error: "title·body 가 필요합니다." }, { status: 400 });
    await saveNoticeTemplate(round, body.title, body.body.map((p) => String(p)));
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_leave_notice_template",
      targetTable: "leave_notice_templates",
      targetId: String(round),
      after: { title: body.title },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
