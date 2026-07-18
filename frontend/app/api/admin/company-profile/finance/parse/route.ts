import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { parseFinancialStatementWithLlm } from "@/lib/company/finance-llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;

// POST: 홈택스 표준재무제표 LLM 분석(multipart: file) → 연도별 재정상황 행 추출.
// 표준재무제표가 아니면 422 로 거부(자유 재무제표·감사보고서 등 불가).
export async function POST(req: NextRequest) {
  try {
    await requirePermission("org.edit", { fallbackRoles: ["admin"] });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "분석할 파일이 필요합니다." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "파일은 20MB 이하만 분석할 수 있습니다." }, { status: 400 });
    }
    const parsed = await parseFinancialStatementWithLlm(file);
    if (!parsed) {
      return NextResponse.json({ error: "LLM 분석이 설정되지 않았습니다(ANTHROPIC_API_KEY)." }, { status: 503 });
    }
    if (!parsed.isStandard || parsed.rows.length === 0) {
      return NextResponse.json(
        { error: "홈택스에서 출력한 표준재무제표만 업로드할 수 있습니다. 파일을 확인해 주세요." },
        { status: 422 }
      );
    }
    return NextResponse.json({ rows: parsed.rows });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
