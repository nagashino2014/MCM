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
    const body = (await req.json().catch(() => ({}))) as { days?: unknown; maxPages?: unknown; maxDocs?: unknown };
    const days = Number(body?.days) > 0 ? Number(body.days) : 7;
    const maxPages = Number(body?.maxPages) > 0 ? Number(body.maxPages) : 2; // 테스트 기본 소량
    // 2차 원문 파싱은 무거우므로 테스트에선 소량만(0=skip). 전량 완주는 야간 배치 전담.
    const maxDocs = Number.isFinite(Number(body?.maxDocs)) && Number(body?.maxDocs) >= 0 ? Number(body.maxDocs) : 5;
    const result = await collectDartSignals({ days, maxPages, maxDocs });
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
