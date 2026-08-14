import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { signContract } from "@/lib/payroll/sign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 전자서명 — 동의 5종 전부 체크 필수. 서명 문자열은 서버 생성(§5-4). */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ contractId: string }> }
) {
  try {
    const ctx = await requireSession();
    const { contractId } = await params;
    const body = await req.json();
    const consents = (body?.consents ?? {}) as Record<string, boolean>;
    return NextResponse.json(await signContract(ctx.userId, contractId, consents));
  } catch (err) {
    return authErrorToResponse(err);
  }
}
