import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { binaryResponse, readStorageObject } from "@/lib/contracts/document-bundle";
import { generateLetterArtifacts } from "@/lib/letter/generate";
import { getLetterById } from "@/lib/letter/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET: 공문 한글 원본 다운로드 — 시스템 생성분은 HWPX, 백필(imported)은 hwp 원본.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ letterId: string }> }) {
  try {
    await requirePermission("approval.view");
    const { letterId } = await params;
    const letter = await getLetterById(letterId);
    if (!letter) return NextResponse.json({ error: "공문을 찾을 수 없습니다." }, { status: 404 });
    const base = `(${letter.letterNo ?? "미채번"})${letter.title ?? "공문"}`;

    if (letter.hwpxKey) {
      const bytes = await readStorageObject(letter.hwpxKey).catch(() => null);
      if (bytes) return binaryResponse(bytes, "application/vnd.hancom.hwpx", `${base}.hwpx`);
    }
    if (letter.hwpKey) {
      const bytes = await readStorageObject(letter.hwpKey).catch(() => null);
      if (bytes) return binaryResponse(bytes, "application/x-hwp", `${base}.hwp`);
    }
    if (letter.docId) {
      const artifacts = await generateLetterArtifacts(letter.docId, { persist: false });
      if (artifacts.hwpxBytes) return binaryResponse(artifacts.hwpxBytes, "application/vnd.hancom.hwpx", `${base}.hwpx`);
    }
    return NextResponse.json({ error: "한글 원본이 없습니다(HWPX 템플릿 미배치 또는 이관 시 hwp 미보관)." }, { status: 404 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
