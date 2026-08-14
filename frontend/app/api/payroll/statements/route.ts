import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireAdmin } from "@/lib/auth/guards";
import { listStatementTargets, sendStatements } from "@/lib/payroll/statements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ?ledgerId= — 명세서 발송 대상·이력 */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const ledgerId = new URL(req.url).searchParams.get("ledgerId");
    if (!ledgerId) return NextResponse.json({ error: "ledgerId가 필요합니다." }, { status: 400 });
    return NextResponse.json(await listStatementTargets(ledgerId));
  } catch (err) {
    return authErrorToResponse(err);
  }
}

/** action: send(확정 대장 명세서 발송, resend=true 면 기발송분 포함 재발송) */
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const body = await req.json();
    if (String(body.action ?? "send") !== "send") {
      return NextResponse.json({ error: "알 수 없는 action 입니다." }, { status: 400 });
    }
    if (!body.ledgerId) return NextResponse.json({ error: "ledgerId가 필요합니다." }, { status: 400 });
    const origin = new URL(req.url).origin;
    const testEmail = typeof body.testEmail === "string" ? body.testEmail.trim() : "";
    if (testEmail && !/.+@.+\..+/.test(testEmail)) {
      return NextResponse.json({ error: "테스트 수신 메일 주소가 올바르지 않습니다." }, { status: 400 });
    }
    return NextResponse.json(
      await sendStatements(String(body.ledgerId), ctx.userId, origin, {
        resend: body.resend === true,
        testEmail: testEmail || undefined,
      })
    );
  } catch (err) {
    return authErrorToResponse(err);
  }
}
