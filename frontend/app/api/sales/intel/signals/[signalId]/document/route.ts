import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getIntelSignal } from "@/lib/intel/intel-queries";
import { getDocumentText } from "@/lib/intel/dart-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ signalId: string }>;
}

// DART 공시 원문 텍스트 — external_id(=접수번호)로 document.xml 을 받아 태그 제거 텍스트 반환.
// DART 는 IP 제한이 있어 서버(ECS, DART_HTTPS_PROXY 경유)에서만 호출 가능하다.
const MAX_TEXT = 20000; // 모달 표시용 상한(원문 전체는 외부 링크로)

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    await requirePermission("sales.view");
    const { signalId } = await ctx.params;
    const signal = await getIntelSignal(signalId);
    if (!signal) return NextResponse.json({ error: "신호를 찾을 수 없습니다." }, { status: 404 });
    if (signal.source !== "dart") {
      return NextResponse.json({ error: "DART 신호만 원문 텍스트를 지원합니다." }, { status: 400 });
    }
    const text = await getDocumentText(signal.externalId);
    if (!text) {
      return NextResponse.json(
        { error: "원문을 가져오지 못했습니다. DART 원본 링크를 이용해 주세요." },
        { status: 502 }
      );
    }
    const truncated = text.length > MAX_TEXT;
    return NextResponse.json({ text: truncated ? text.slice(0, MAX_TEXT) : text, truncated });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
