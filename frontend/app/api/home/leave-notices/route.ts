import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listMyNotices } from "@/lib/approval/leave-promotion";
import { getCompanyProfile } from "@/lib/company/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 수신 문서함(홈) — 세션 직원 본인이 받은 연차 고지 목록 + 고지서 발신 표기용 회사 정보.
// 직원 매핑이 없는 계정(관리자 등)은 빈 배열 → 위젯이 숨겨진다.
export async function GET() {
  try {
    const ctx = await requireSession();
    const [notices, company] = await Promise.all([
      listMyNotices(ctx.userId),
      getCompanyProfile().catch(() => null),
    ]);
    return NextResponse.json({
      notices,
      company: company ? { companyName: company.companyName, ceoName: company.ceoName } : null,
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
