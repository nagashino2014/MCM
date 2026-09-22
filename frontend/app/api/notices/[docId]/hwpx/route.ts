import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { getDoc } from "@/lib/approval/docs";
import { sanitizeDownloadName } from "@/lib/contracts/document-bundle";
import { ISO_DATE_RE } from "@/lib/letter/types";
import { renderNoticeHwpx } from "@/lib/notice/export";
import { NOTICE_FORM_ID, type NoticeFieldValues } from "@/lib/notice/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET: 결재 문서(내부고시)의 HWPX 편집용 사본 — 문서 뷰어의 HWPX 버튼. 접근 범위는 PDF 출력과 같다
// (기안자·결재선 관계자·참조자·approval.manage). 시행일은 PDF 와 같은 규칙(지정일 > 결재 완료일).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const ctx = await requirePermission("approval.view");
    const { docId } = await params;
    const doc = await getDoc(docId);
    if (!doc || doc.formId !== NOTICE_FORM_ID) return NextResponse.json({ error: "내부고시 문서를 찾을 수 없습니다." }, { status: 404 });
    const involved =
      doc.drafterUserId === ctx.userId || doc.steps.some((s) => s.assigneeUserId === ctx.userId || s.delegatedFrom === ctx.userId);
    const isWatcher = doc.watchers.some((w) => w.userId === ctx.userId);
    if (!involved && !isWatcher && !(await hasPermission(ctx.userId, "approval.manage"))) {
      return NextResponse.json({ error: "이 문서를 열람할 권한이 없습니다." }, { status: 403 });
    }
    const values = doc.fieldValues as unknown as NoticeFieldValues;
    const issueDate = ISO_DATE_RE.test(values.issue_date ?? "")
      ? (values.issue_date as string)
      : (doc.completedAt ?? doc.submittedAt ?? new Date().toISOString()).slice(0, 10);
    const bytes = await renderNoticeHwpx({ ...values, subject: values.subject || doc.title }, { docNo: doc.docNo, issueDate });
    const name = sanitizeDownloadName(`(${doc.docNo ?? "미채번"})${doc.title}.hwpx`);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/vnd.hancom.hwpx",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
