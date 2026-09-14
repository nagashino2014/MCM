import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { analyzeBusinessCertificate } from "@/lib/ieps/business-certificate-analysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    await requirePermission("facility.edit", { fallbackRoles: ["editor"] });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "사업자등록증 PDF 파일을 첨부하세요." }, { status: 400 });
    }
    if (file.size > 30 * 1024 * 1024) {
      return NextResponse.json({ error: "파일은 30MB 이하만 분석할 수 있습니다." }, { status: 400 });
    }
    const result = await analyzeBusinessCertificate(file, { highQuality: form.get("highQuality") === "1" });
    return NextResponse.json({ ...result, ocrText: result.ocrText.slice(0, 12000) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
