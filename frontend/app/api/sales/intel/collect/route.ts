import { NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { collectDartSignals } from "@/lib/intel/collect";
import { collectEiassSignals } from "@/lib/intel/collect-eiass";
import { collectGosiSignals } from "@/lib/intel/collect-gosi";
import { collectPressSignals } from "@/lib/intel/collect-press";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 수동 '수집 테스트'(헬스체크): 지정 기간을 소량(maxPages)만 조회·매칭해 정상작동 확인.
// 전량 수집·완주는 야간 배치(ECS RunTask, intel-batch 엔트리)가 전담한다.
// source='eiass' 면 EIASS 협의진행현황 소량 수집(리스트 2페이지·상세 5건 기본).
export async function POST(req: Request) {
  try {
    await requirePermission("sales.edit", { fallbackRoles: ["editor"] });
    const body = (await req.json().catch(() => ({}))) as {
      source?: unknown; days?: unknown; maxPages?: unknown; maxDocs?: unknown;
    };
    const maxPages = Number(body?.maxPages) > 0 ? Number(body.maxPages) : 2; // 테스트 기본 소량
    if (body?.source === "eiass") {
      const result = await collectEiassSignals({ maxPages, maxDetails: 5, maxClassify: 5 });
      return NextResponse.json(result);
    }
    if (body?.source === "press") {
      const result = await collectPressSignals({ maxClassify: 5 });
      return NextResponse.json(result);
    }
    if (body?.source === "gosi") {
      const result = await collectGosiSignals({ maxPagesPerKeyword: 1 });
      return NextResponse.json(result);
    }
    const days = Number(body?.days) > 0 ? Number(body.days) : 7;
    // 2차 원문 파싱은 무거우므로 테스트에선 소량만(0=skip). 전량 완주는 야간 배치 전담.
    const maxDocs = Number.isFinite(Number(body?.maxDocs)) && Number(body?.maxDocs) >= 0 ? Number(body.maxDocs) : 5;
    const result = await collectDartSignals({ days, maxPages, maxDocs });
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
