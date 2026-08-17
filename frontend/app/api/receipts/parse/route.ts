import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { parseReceipt } from "@/lib/finance/receipt-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 영수증 이미지 → 필드 파싱(저장 없음). 결과는 확인 폼 프리필용 — 확정 저장은 /api/receipts POST.
// 권한: approval.view — 기안자 전원이 본인 경비 영수증을 찍는다(명함 parse 라우트 패턴).
export async function POST(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "영수증 이미지 파일을 첨부하세요." }, { status: 400 });
    }
    if (!/^image\//.test(file.type)) {
      return NextResponse.json({ error: "이미지 파일만 지원합니다." }, { status: 400 });
    }
    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "이미지가 너무 큽니다(15MB 이하)." }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseReceipt(buffer);
    if (!parsed) {
      return NextResponse.json({
        fields: null,
        warning: "영수증 분석 키(ANTHROPIC_API_KEY)가 설정되지 않아 자동 추출을 건너뛰었습니다. 수동 입력해 주세요.",
      });
    }
    return NextResponse.json({ fields: parsed.fields, model: parsed.model });
  } catch (err) {
    if (err instanceof Error && /영수증 분석/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return authErrorToResponse(err);
  }
}
