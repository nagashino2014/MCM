import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { sanitizeDownloadName } from "@/lib/contracts/document-bundle";
import { ISO_DATE_RE } from "@/lib/letter/types";
import { renderNoticeHwpx } from "@/lib/notice/export";
import { renderNoticePdf } from "@/lib/notice/pdf";
import type { NoticeFieldValues } from "@/lib/notice/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST: 내부고시 PDF·HWPX 내려받기(작성 화면) — 저장 전 내용도 그대로 출력한다.
// body: { fieldValues, docNo?, format: "pdf" | "hwpx" }
export async function POST(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const body = (await req.json()) as { fieldValues?: NoticeFieldValues; docNo?: string | null; format?: string };
    const values = body?.fieldValues;
    if (!values || typeof values !== "object") {
      return NextResponse.json({ error: "fieldValues 가 필요합니다." }, { status: 400 });
    }
    const format = body.format === "hwpx" ? "hwpx" : "pdf";
    const issueDate = ISO_DATE_RE.test(values.issue_date ?? "") ? (values.issue_date as string) : new Date().toISOString().slice(0, 10);
    const snap = { docNo: body.docNo ?? null, issueDate };
    const bytes = format === "hwpx" ? await renderNoticeHwpx(values, snap) : await renderNoticePdf(values, snap);
    const name = sanitizeDownloadName(`(${snap.docNo ?? "채번 예정"})${values.subject || "내부고시"}.${format}`);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": format === "hwpx" ? "application/vnd.hancom.hwpx" : "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
