import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import {
  deliverCertificate,
  issueAutoCertificate,
  issueStampedCertificate,
  issueWithholdingFromYearend,
  listCertificateIssues,
} from "@/lib/approval/certificates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET: 발급 대기/이력 목록(발급 담당 — approval.manage) ?status=
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const status = req.nextUrl.searchParams.get("status") || undefined;
    return NextResponse.json({ issues: await listCertificateIssues(status) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST — JSON {action:"issue-auto"|"issue-yearend"|"deliver", issueId}
//      | multipart(action=issue-stamp, issueId, file) 스캔 PDF 업로드 → 직인본 생성.
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const issueId = String(form.get("issueId") ?? "");
      const file = form.get("file");
      if (!issueId || !(file instanceof File)) return NextResponse.json({ error: "issueId와 PDF 파일이 필요합니다." }, { status: 400 });
      if (file.type !== "application/pdf") return NextResponse.json({ error: "PDF 파일만 업로드할 수 있습니다." }, { status: 400 });
      const issue = await issueStampedCertificate(issueId, actor.userId, Buffer.from(await file.arrayBuffer()));
      await recordAuditLog({ actorUserId: actor.userId, action: "certificate_issue", targetTable: "certificate_issues", targetId: issueId });
      return NextResponse.json({ issue });
    }

    const body = (await req.json().catch(() => ({}))) as { action?: string; issueId?: string };
    const issueId = String(body.issueId ?? "");
    if (!issueId) return NextResponse.json({ error: "issueId가 필요합니다." }, { status: 400 });

    if (body.action === "issue-auto") {
      const issue = await issueAutoCertificate(issueId, actor.userId);
      await recordAuditLog({ actorUserId: actor.userId, action: "certificate_issue", targetTable: "certificate_issues", targetId: issueId });
      return NextResponse.json({ issue });
    }
    if (body.action === "issue-yearend") {
      // 앱이 보유한 연말정산 PDF(yearend_settlements.pdf_key)를 원본으로 직인본 생성 — 원천징수영수증 자동 경로.
      const updated = await issueWithholdingFromYearend(issueId, actor.userId);
      if (!updated) return NextResponse.json({ error: "해당 귀속연도의 연말정산 PDF가 없습니다 — 스캔본을 업로드하세요." }, { status: 404 });
      await recordAuditLog({ actorUserId: actor.userId, action: "certificate_issue", targetTable: "certificate_issues", targetId: issueId });
      return NextResponse.json({ issue: updated });
    }
    if (body.action === "deliver") {
      const issue = await deliverCertificate(issueId);
      await recordAuditLog({ actorUserId: actor.userId, action: "certificate_deliver", targetTable: "certificate_issues", targetId: issueId });
      return NextResponse.json({ issue });
    }
    return NextResponse.json({ error: "알 수 없는 action 입니다." }, { status: 400 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
