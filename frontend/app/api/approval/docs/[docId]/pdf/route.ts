import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { getDoc } from "@/lib/approval/docs";
import { createApprovalDocPdf } from "@/lib/approval/doc-pdf";
import { listLeaveTypes } from "@/lib/approval/leave-types-store";
import { sanitizeDownloadName } from "@/lib/contracts/document-bundle";
import { generateLetterArtifacts } from "@/lib/letter/generate";
import { LETTER_FORM_ID } from "@/lib/letter/types";
import { generateQuoteArtifacts } from "@/lib/quote/generate";
import { QUOTE_FORM_ID } from "@/lib/quote/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET: 전자결재 문서 PDF 출력 — 문서 뷰어의 PDF 버튼. 접근 범위는 문서 상세 GET 과 동일하게
// 기안자·결재선 관계자·참조자·approval.manage 만 허용한다.
// 공문 양식(135)은 결재 심사도 최종 지면으로 하도록 공문 렌더(lib/letter)로 분기한다
// (결재 진행 중에는 대장 미등록이라 on-demand, 저장 안 함). ?disposition=inline 은 뷰어 임베드용.
export async function GET(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    const ctx = await requirePermission("approval.view");
    const { docId } = await params;
    const doc = await getDoc(docId);
    if (!doc) return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
    const involved =
      doc.drafterUserId === ctx.userId || doc.steps.some((s) => s.assigneeUserId === ctx.userId || s.delegatedFrom === ctx.userId);
    const isWatcher = doc.watchers.some((w) => w.userId === ctx.userId);
    if (!involved && !isWatcher && !(await hasPermission(ctx.userId, "approval.manage"))) {
      return NextResponse.json({ error: "이 문서를 열람할 권한이 없습니다." }, { status: 403 });
    }

    let bytes: Uint8Array;
    let fileName: string;
    if (doc.formId === LETTER_FORM_ID) {
      const artifacts = await generateLetterArtifacts(docId, { persist: false });
      bytes = artifacts.pdfBytes;
      fileName = `${artifacts.fileBase}.pdf`;
    } else if (doc.formId === QUOTE_FORM_ID) {
      // 견적(136)도 결재 심사를 최종 제출 지면으로 — on-demand 렌더(저장 안 함)
      const artifacts = await generateQuoteArtifacts(docId, { persist: false });
      bytes = artifacts.pdfBytes;
      fileName = `${artifacts.fileBase}.pdf`;
    } else {
      const leaveCatalog = doc.fields.some((f) => f.type === "leave_type") ? await listLeaveTypes() : [];
      bytes = await createApprovalDocPdf(doc, leaveCatalog);
      fileName = `${doc.docNo ?? "미채번"}_${doc.title}.pdf`;
    }
    const disposition = req.nextUrl.searchParams.get("disposition") === "inline" ? "inline" : "attachment";
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.byteLength),
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(sanitizeDownloadName(fileName))}`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
