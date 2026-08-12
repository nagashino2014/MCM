import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { putContractDocument, sanitizeFilename } from "@/lib/storage/contract-document-storage";
import { analyzeAgreementHwpx, analyzeAgreementOverlay } from "@/lib/agreement/analyze";

// POST: 발주처 자체양식 계약서 분석 — multipart(file: hwpx, mode: spec|overlay).
//  - spec    : AgreementSpec 초안(조문 편집 가능, 갑지는 표준 골격으로 정규화)
//  - overlay : 원본 서식을 그대로 두고 값만 주입할 슬롯 매핑(TemplateProfile) — 148
// 어느 쪽이든 원본 HWPX 를 S3 에 보관한다(overlay 는 렌더마다 원본이 필요하고,
// spec 도 재분석에 쓰인다). 저장은 templates POST 가 담당한다(여기서는 분석만).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    await requirePermission("approval.manage");
    const form = await req.formData();
    const file = form.get("file");
    const mode = String(form.get("mode") ?? "spec") === "overlay" ? "overlay" : "spec";
    if (!(file instanceof File)) return NextResponse.json({ error: "분석할 파일을 첨부하세요." }, { status: 400 });
    if (!file.name.toLowerCase().endsWith(".hwpx")) {
      return NextResponse.json({ error: "1차 버전은 HWPX 양식만 분석합니다(DOCX·스캔 PDF 는 후속)." }, { status: 400 });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());

    // 원본 보관 — overlay 는 값 주입 때마다 이 파일을 읽는다.
    const uid = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const sourceKey = `agreements/templates/${uid}/${sanitizeFilename(file.name)}`;
    await putContractDocument(sourceKey, Buffer.from(bytes), "application/vnd.hancom.hwpx");

    if (mode === "overlay") {
      const result = await analyzeAgreementOverlay(bytes);
      return NextResponse.json({
        mode,
        profile: result.profile,
        unmapped: result.unmapped,
        slotCount: result.profile.docs[0]?.slots.length ?? 0,
        note: result.note,
        fileName: file.name,
        sourceKey,
      });
    }
    const result = await analyzeAgreementHwpx(bytes);
    return NextResponse.json({ mode, spec: result.spec, note: result.note, fileName: file.name, sourceKey });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
