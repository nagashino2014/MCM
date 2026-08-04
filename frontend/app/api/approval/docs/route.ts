import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { listMyDocs, listInbox, listActedDocs, listRefCandidates, saveDoc, submitDoc, type ApprovalLineStepInput, type ApprovalWatcherInput } from "@/lib/approval/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 결재함 목록 — box=draft|in_progress|completed(기안함) / pending|upcoming(결재함) / acted(결재한 문서)
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const box = String(req.nextUrl.searchParams.get("box") ?? "pending");
    if (box === "pending" || box === "upcoming") {
      return NextResponse.json({ docs: await listInbox(ctx.userId, box) });
    }
    if (box === "acted") {
      return NextResponse.json({ docs: await listActedDocs(ctx.userId) });
    }
    if (box === "draft" || box === "in_progress" || box === "completed") {
      return NextResponse.json({ docs: await listMyDocs(ctx.userId, box) });
    }
    // 선행 문서 후보(127) — 내가 기안한 특정 양식 문서(보고서 기안 화면의 연결 모달용)
    if (box === "ref-candidates") {
      const formId = String(req.nextUrl.searchParams.get("formId") ?? "");
      if (!formId) return NextResponse.json({ error: "formId 가 필요합니다." }, { status: 400 });
      return NextResponse.json({ docs: await listRefCandidates(ctx.userId, formId) });
    }
    return NextResponse.json({ error: "box 파라미터가 올바르지 않습니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

interface PostBody {
  action?: "save" | "submit";
  docId?: string | null;
  formId?: string;
  title?: string;
  urgent?: boolean;
  fieldValues?: Record<string, unknown>;
  line?: ApprovalLineStepInput[];
  watchers?: ApprovalWatcherInput[];
  refDocId?: string | null;
}

// POST: 기안 저장(draft) / 상신(저장 후 채번·결재 시작)
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const body = (await req.json().catch(() => ({}))) as PostBody;
    if (!body.formId) return NextResponse.json({ error: "formId 가 필요합니다." }, { status: 400 });
    const docId = await saveDoc({
      docId: body.docId ?? null,
      formId: body.formId,
      title: String(body.title ?? ""),
      urgent: body.urgent === true,
      fieldValues: body.fieldValues ?? {},
      line: Array.isArray(body.line) ? body.line : [],
      watchers: Array.isArray(body.watchers) ? body.watchers : [],
      refDocId: body.refDocId ?? null,
      actorUserId: ctx.userId,
    });
    let docNo: string | null = null;
    if (body.action === "submit") {
      const res = await submitDoc(docId, ctx.userId);
      docNo = res.docNo;
      await recordAuditLog({
        actorUserId: ctx.userId,
        action: "approval_doc_submit",
        targetTable: "approval_docs",
        targetId: docId,
        after: { docNo, formId: body.formId },
      });
    }
    return NextResponse.json({ docId, docNo });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
