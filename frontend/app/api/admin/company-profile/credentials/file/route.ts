import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { getCredential } from "@/lib/company/profile";
import { readContractDocument } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPE_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

// GET ?credentialId= : 면허·인증 증빙 원본(문서 분석 때 보관한 파일)
export async function GET(req: NextRequest) {
  try {
    await requirePermission("org.view", { fallbackRoles: ["admin"] });
    const credential = await getCredential(String(req.nextUrl.searchParams.get("credentialId") ?? ""));
    if (!credential?.file) return NextResponse.json({ error: "증빙 파일이 없습니다." }, { status: 404 });
    const buf = await readContractDocument(credential.file.storageKey);
    if (!buf) return NextResponse.json({ error: "파일을 읽지 못했습니다." }, { status: 404 });
    const fileName = credential.file.fileName;
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": TYPE_BY_EXT[ext] ?? "application/octet-stream",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
