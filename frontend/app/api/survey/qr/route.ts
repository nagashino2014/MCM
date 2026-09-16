import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { generateQrDataUrl } from "@/lib/survey/qr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 링크 → QR PNG(data URI). 배포 이미지 편집기가 링크 입력 즉시 호출한다.
export async function POST(req: NextRequest) {
  try {
    await requirePermission("survey.manage", { fallbackRoles: ["admin"] });
    const body = await req.json();
    const url = String(body?.url ?? "").trim();
    const dataUrl = await generateQrDataUrl(url, Number(body?.width) || 880);
    return NextResponse.json({ dataUrl });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
