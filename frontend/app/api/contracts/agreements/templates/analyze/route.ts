import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { analyzeAgreementHwpx } from "@/lib/agreement/analyze";

// POST: 발주처 자체양식 계약서 분석 — multipart(file: hwpx) → AgreementSpec 초안 반환(저장 없음).
// 검수 화면(기준 관리 custom 탭)에서 보정 후 templates POST 로 저장한다.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    await requirePermission("approval.manage");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "분석할 파일을 첨부하세요." }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".hwpx")) {
      return NextResponse.json({ error: "1차 버전은 HWPX 양식만 분석합니다(DOCX·스캔 PDF 는 후속)." }, { status: 400 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await analyzeAgreementHwpx(bytes);
    return NextResponse.json({ spec: result.spec, note: result.note, fileName: file.name });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
