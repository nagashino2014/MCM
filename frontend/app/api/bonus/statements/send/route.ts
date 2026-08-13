import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { parsePeriod } from "@/lib/bonus/source";
import { sendStatementEmails } from "@/lib/bonus/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 지급 명세서 이메일 발송(PDF 첨부) — 관리자 전용.
 * employeeIds 를 주면 해당 인원만(재발송), 없으면 participant/dept_head 전원.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const body = await req.json();
    const p = parsePeriod(String(body?.period ?? ""));
    if (!p) return NextResponse.json({ error: "period 형식은 YYYY-H1/H2 입니다." }, { status: 400 });
    const employeeIds = Array.isArray(body?.employeeIds)
      ? body.employeeIds.map((v: unknown) => String(v)).filter(Boolean)
      : undefined;
    const overrideEmail = body?.overrideEmail ? String(body.overrideEmail) : undefined;
    const result = await sendStatementEmails(ctx.userId, p, employeeIds, overrideEmail);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 400) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
