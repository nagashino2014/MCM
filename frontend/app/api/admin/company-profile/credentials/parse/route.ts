import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { parseCredentialWithLlm } from "@/lib/company/credential-llm";
import { storeCredentialFile } from "@/lib/company/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 20 * 1024 * 1024;

// POST: 면허/인증 문서 LLM 분석(multipart: file) → 명칭·번호·취득일·유효기간·발급기관 프리필.
// 올린 문서는 증빙으로 보관하고 file(storageKey·fileName)을 돌려준다 — [추가]/[수정 저장] 때 함께 기록된다.
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
    const stored = await storeCredentialFile({
      fileName: file.name || "credential.pdf",
      contentType: file.type || "application/octet-stream",
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    const fields = await parseCredentialWithLlm(file);
    if (!fields) {
      return NextResponse.json({
        fields: null,
        file: stored,
        warning: "LLM 분석이 설정되지 않았습니다(ANTHROPIC_API_KEY). 증빙 파일은 붙였으니 항목은 수기로 입력하세요.",
      });
    }
    return NextResponse.json({ fields, file: stored });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
