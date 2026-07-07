import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { collectDartSignals } from "@/lib/intel/collect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 수동 '수집 테스트'(헬스체크): 지정 기간을 소량(maxPages)만 조회·매칭해 정상작동 확인.
// 전량 수집·완주는 야간 배치(ECS RunTask, intel-batch 엔트리)가 전담한다.
export async function POST(req: Request) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json().catch(() => ({}))) as { days?: unknown; maxPages?: unknown };
    const days = Number(body?.days) > 0 ? Number(body.days) : 7;
    const maxPages = Number(body?.maxPages) > 0 ? Number(body.maxPages) : 2; // 테스트 기본 소량
    const result = await collectDartSignals({ days, maxPages });
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
