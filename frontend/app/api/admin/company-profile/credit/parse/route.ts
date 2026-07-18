import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { parseCreditRatingWithLlm } from "@/lib/company/finance-llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;

// POST: 신용평가 등급서 LLM 분석(multipart: file) → 신용평가회사·평가 종류·등급·평가일 프리필
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
    const fields = await parseCreditRatingWithLlm(file);
    if (!fields) {
      return NextResponse.json({ error: "LLM 분석이 설정되지 않았습니다(ANTHROPIC_API_KEY)." }, { status: 503 });
    }
    return NextResponse.json({ fields });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
