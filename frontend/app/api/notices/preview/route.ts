import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { ISO_DATE_RE } from "@/lib/letter/types";
import { renderNoticePdf } from "@/lib/notice/pdf";
import type { NoticeFieldValues } from "@/lib/notice/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST: 내부고시 PDF 미리보기 — field_values 규약을 받아 저장 없이 렌더한다.
export async function POST(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const body = (await req.json()) as { fieldValues?: NoticeFieldValues; docNo?: string | null };
    const values = body?.fieldValues;
    if (!values || typeof values !== "object") {
      return NextResponse.json({ error: "fieldValues 가 필요합니다." }, { status: 400 });
    }
    const issueDate = ISO_DATE_RE.test(values.issue_date ?? "") ? (values.issue_date as string) : new Date().toISOString().slice(0, 10);
    const bytes = await renderNoticePdf(values, { docNo: body.docNo ?? null, issueDate });
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="notice-preview.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
