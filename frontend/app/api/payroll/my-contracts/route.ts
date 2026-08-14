import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listMyContracts } from "@/lib/payroll/sign";
import { CONTRACT_CONSENT_SECTIONS } from "@/lib/payroll/sign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 홈 위젯 — 본인 수신 근로계약(서버에서 본인 강제). 미연결 계정은 빈 목록. */
export async function GET() {
  try {
    const ctx = await requireSession();
    const data = await listMyContracts(ctx.userId);
    return NextResponse.json({ ...data, consentSections: CONTRACT_CONSENT_SECTIONS });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
