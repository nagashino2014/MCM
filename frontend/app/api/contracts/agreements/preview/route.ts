import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getTemplate } from "@/lib/agreement/store";
import { renderAgreementPdf } from "@/lib/agreement/pdf";
import type { AgreementFieldValues } from "@/lib/agreement/types";

// POST: 계약서 PDF 미리보기 — 저장 없이 현재 입력값으로 온디맨드 렌더(견적 preview 관례).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    await requirePermission("contract.view");
    const body = (await req.json()) as { fieldValues?: AgreementFieldValues };
    const fv = body?.fieldValues;
    if (!fv || !fv.templateId) return NextResponse.json({ error: "입력값이 올바르지 않습니다." }, { status: 400 });
    const tpl = await getTemplate(fv.templateId);
    if (!tpl) return NextResponse.json({ error: "양식을 찾을 수 없습니다." }, { status: 404 });
    const pdf = await renderAgreementPdf(tpl.spec, fv);
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="agreement-preview.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
