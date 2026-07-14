import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { parseBusinessCard } from "@/lib/sales/business-card-parser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 명함 이미지 → 필드 파싱(저장 없음). 결과는 폼 프리필용 — 확정 저장은 [id]/contacts/card POST.
export async function POST(req: NextRequest) {
  try {
    await requirePermission("contact.edit", { fallbackRoles: ["editor"] });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "명함 이미지 파일을 첨부하세요." }, { status: 400 });
    }
    if (!/^image\//.test(file.type)) {
      return NextResponse.json({ error: "이미지 파일만 지원합니다." }, { status: 400 });
    }
    if (file.size > 15 * 1024 * 1024) {
      return NextResponse.json({ error: "이미지가 너무 큽니다(15MB 이하)." }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseBusinessCard(buffer);
    if (!parsed) {
      return NextResponse.json({
        fields: null,
        warning: "명함 분석 키(ANTHROPIC_API_KEY)가 설정되지 않아 자동 추출을 건너뛰었습니다. 수동 입력해 주세요.",
      });
    }
    return NextResponse.json({ fields: parsed.fields, model: parsed.model });
  } catch (err) {
    if (err instanceof Error && /명함 분석/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return authErrorToResponse(err);
  }
}
