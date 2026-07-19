import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { saveCreditImage } from "@/lib/company/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// POST: 신용평가 등급 확인서 이미지(등급 표시부 크롭) 업로드/교체 — 패키지 생성 시 서식에 삽입
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("org.edit", { fallbackRoles: ["admin"] });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "이미지 파일이 필요합니다." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "이미지는 10MB 이하만 업로드할 수 있습니다." }, { status: 400 });
    }
    if (file.type && !IMAGE_TYPES.has(file.type)) {
      return NextResponse.json({ error: "PNG/JPG/WebP 이미지만 업로드할 수 있습니다." }, { status: 400 });
    }
    const saved = await saveCreditImage({
      fileName: file.name || "credit-image.png",
      contentType: file.type || "image/png",
      bytes: new Uint8Array(await file.arrayBuffer()),
      actorUserId: actor.userId,
    });
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "company_profile_update",
      targetTable: "company_profile",
      targetId: "default",
      after: { kind: "credit_image", fileName: saved.fileName },
    });
    return NextResponse.json({ creditImage: saved });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
