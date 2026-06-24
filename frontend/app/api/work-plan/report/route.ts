import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireEditor } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { saveReport, type SaveReportInput } from "@/lib/work-plan/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 용역/Task 보고 저장(신규/수정). reportId 유무로 분기.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireEditor();
    const body = (await req.json()) as SaveReportInput;
    const reportId = await saveReport(actor.userId, body);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: body.reportId ? "contract_update" : "contract_create",
      targetTable: "work_plan_reports",
      targetId: reportId,
      after: { subjectKind: body.subjectKind, subjectId: body.subjectId, status: body.status ?? "draft" },
    });
    return NextResponse.json({ reportId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
