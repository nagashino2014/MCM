import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { loadDrafterSnapshot } from "@/lib/approval/docs";
import { composeLetter } from "@/lib/letter/compose";
import { renderLetterPdf } from "@/lib/letter/pdf";
import type { LetterFieldValues } from "@/lib/letter/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST: 공문 PDF 미리보기 — field_values 규약을 받아 저장 없이 PDF 를 렌더한다.
// A4 1장 맞춤(fit) 검증을 겸한다: X-Letter-Fitted 헤더가 "0" 이면 최소 fit 으로도 1장 초과.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const body = (await req.json()) as { fieldValues?: LetterFieldValues; letterNo?: string | null };
    const values = body?.fieldValues;
    if (!values || typeof values !== "object") {
      return NextResponse.json({ error: "fieldValues 가 필요합니다." }, { status: 400 });
    }
    const snap = await loadDrafterSnapshot(ctx.userId);
    const layout = composeLetter(values, {
      letterNo: body.letterNo ?? null,
      drafterName: snap.name,
      drafterPosition: snap.position,
    });
    const result = await renderLetterPdf(layout);
    return new NextResponse(Buffer.from(result.bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="letter-preview.pdf"`,
        "X-Letter-Fitted": result.fitted ? "1" : "0",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
