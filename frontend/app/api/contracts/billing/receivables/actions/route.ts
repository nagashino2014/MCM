import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated, requirePermission } from "@/lib/auth/guards";
import {
  RECEIVABLE_ACTION_TYPES,
  createReceivableAction,
  listReceivableActions,
  type ReceivableActionType,
} from "@/lib/ieps/receivables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
    const milestoneId = req.nextUrl.searchParams.get("milestoneId")?.trim();
    if (!milestoneId) {
      return NextResponse.json({ error: "milestoneId가 필요합니다." }, { status: 400 });
    }
    const actions = await listReceivableActions(milestoneId);
    return NextResponse.json({ actions });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    await requirePermission("billing.receivable.manage");
    const body = await req.json();
    const contractId = String(body.contractId ?? "").trim();
    const milestoneId = String(body.milestoneId ?? "").trim();
    const actionType = String(body.actionType ?? "") as ReceivableActionType;
    if (!contractId || !milestoneId) {
      return NextResponse.json({ error: "contractId/milestoneId가 필요합니다." }, { status: 400 });
    }
    if (!RECEIVABLE_ACTION_TYPES.includes(actionType)) {
      return NextResponse.json({ error: "대응 조치 유형이 올바르지 않습니다." }, { status: 400 });
    }
    const stageDates =
      body.stageDates && typeof body.stageDates === "object" && !Array.isArray(body.stageDates)
        ? (body.stageDates as Record<string, string>)
        : null;
    const actionId = await createReceivableAction({
      contractId,
      milestoneId,
      actionType,
      actionDate: body.actionDate ? String(body.actionDate) : null,
      progressNote: String(body.progressNote ?? ""),
      progressStage: body.progressStage ? String(body.progressStage).slice(0, 40) : null,
      stageDates,
    });
    return NextResponse.json({ ok: true, actionId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
