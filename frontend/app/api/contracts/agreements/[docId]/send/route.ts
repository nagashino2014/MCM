import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { processAgreementSend } from "@/lib/agreement/send";
import type { AgreementRecipient } from "@/lib/agreement/types";

// POST: 계약서 발주처 발송(수동 — ① 확정) / 재발송. 동기 실행(공문 재발송 관례).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ docId: string }> }) {
  try {
    await requirePermission("contract.view");
    const { docId } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      recipients?: AgreementRecipient[];
      includeHwpx?: boolean;
      includePdf?: boolean;
      note?: string | null;
    };
    if (!Array.isArray(body.recipients) || !body.recipients.length) {
      return NextResponse.json({ error: "수신 담당자를 1명 이상 지정하세요." }, { status: 400 });
    }
    const result = await processAgreementSend(docId, {
      recipients: body.recipients,
      includeHwpx: body.includeHwpx,
      includePdf: body.includePdf,
      note: body.note ?? null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error ?? "발송 실패" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
