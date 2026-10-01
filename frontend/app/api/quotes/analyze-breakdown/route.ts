import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { LlmError } from "@/lib/ai/llm-json";
import { analyzeBreakdownXlsx } from "@/lib/quote/breakdown-analyze";
import { QUOTE_MULTI_WORK_MAX, type QuoteWorkTag } from "@/lib/quote/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const MAX_BYTES = 10 * 1024 * 1024;

// POST: 산출내역서 엑셀 LLM 분석(multipart: file, works=JSON[{subtype,count}]) → 업무 항목 트리·기술등급.
// 견적서 작성(복수 업무)의 '항목 입력(자동)' — 결과는 화면 편집기에 채워질 뿐 저장하지 않는다.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission("approval.view");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "분석할 엑셀 파일이 필요합니다." }, { status: 400 });
    if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) return NextResponse.json({ error: "엑셀 파일(.xlsx·.xls)만 분석할 수 있습니다." }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "파일은 10MB 이하만 분석할 수 있습니다." }, { status: 400 });

    let works: QuoteWorkTag[] = [];
    try {
      const raw = JSON.parse(String(form.get("works") ?? "[]"));
      if (Array.isArray(raw)) {
        works = raw
          .map((w) => ({ subtype: String(w?.subtype ?? "").trim().slice(0, 40), count: Math.max(1, Math.round(Number(w?.count) || 1)) }))
          .filter((w) => w.subtype)
          .slice(0, QUOTE_MULTI_WORK_MAX);
      }
    } catch {
      // 구성 업무는 참고 정보 — 깨졌으면 없이 분석한다
    }

    let result;
    try {
      result = await analyzeBreakdownXlsx(Buffer.from(await file.arrayBuffer()), works, ctx.userId);
    } catch (err) {
      if (err instanceof LlmError) {
        const notConfigured = err.message.includes("llm_not_configured");
        return NextResponse.json(
          { error: notConfigured ? "LLM 분석이 설정되지 않았습니다(ANTHROPIC_API_KEY)." : `자동 분석에 실패했습니다 — ${err.message}` },
          { status: notConfigured ? 503 : 502 }
        );
      }
      return NextResponse.json({ error: "엑셀 파일을 읽지 못했습니다. 파일이 손상되었거나 암호가 걸려 있는지 확인하세요." }, { status: 400 });
    }
    if (!result.rows.some((r) => !r.isParent)) {
      return NextResponse.json({ error: `산출내역서에서 업무 항목·투입인력을 찾지 못했습니다.${result.note ? ` (${result.note})` : ""}` }, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
