/**
 * /api/parsed-fields/export
 *
 * 검수 대기열 진단 익스포트 — `getReviewDiagnosticReport` 결과를 JSON 파일로 즉시
 * 다운로드(Content-Disposition: attachment) 하여, 사용자가 PDF별 실패 패턴
 * (어떤 필드가 어떤 페이지에서 왜 실패하는지) 을 한 번에 분석할 수 있도록 한다.
 *
 * Query:
 *   - includeReviewed=1 : 검수 완료 항목까지 포함 (기본: 미검수만)
 *   - limit=NN          : 첨부 파일 수 상한 (기본 200, 최대 1000)
 */
import { NextRequest, NextResponse } from "next/server";
import { getReviewDiagnosticReport } from "@/lib/ieps/queries";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAuthenticated();
  } catch (err) {
    return authErrorToResponse(err);
  }

  const { searchParams } = new URL(req.url);
  const includeReviewed = searchParams.get("includeReviewed") === "1";
  const limitRaw = Number(searchParams.get("limit") ?? "200");
  const limitAttachments = clamp(limitRaw, 1, 1000);

  try {
    const report = await getReviewDiagnosticReport({
      includeReviewed,
      limitAttachments,
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `review-diagnostic-${stamp}.json`;
    return new NextResponse(JSON.stringify(report, null, 2), {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "검수 대기열 진단 익스포트 실패: " + (err as Error).message },
      { status: 500 }
    );
  }
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}
