import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { renderQuotePdf } from "@/lib/quote/pdf";
import type { QuoteFieldValues } from "@/lib/quote/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST: 저장 없이 견적서 PDF 렌더(작성 중 미리보기). body = { values, quoteNo?, drafterName?, issueDate? }
export async function POST(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const body = (await req.json()) as {
      values: QuoteFieldValues;
      quoteNo?: string;
      drafterName?: string;
      issueDate?: string;
    };
    if (!body?.values) return NextResponse.json({ error: "values가 필요합니다." }, { status: 400 });
    const bytes = await renderQuotePdf({
      values: body.values,
      quoteNo: body.quoteNo || "미채번",
      drafterName: body.drafterName || "",
      issueDate: body.issueDate || new Date().toISOString().slice(0, 10),
    });
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline; filename=quote-preview.pdf",
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
