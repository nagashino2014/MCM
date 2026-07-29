import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { putLogoObject } from "@/lib/storage/logo-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/svg+xml", ".svg"],
]);
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    await requirePermission("org.edit");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "파일이 필요합니다." }, { status: 400 });
    }
    const ext = ALLOWED.get(file.type);
    if (!ext) {
      return NextResponse.json({ error: "png, jpg, webp, svg 이미지만 업로드할 수 있습니다." }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "로고 파일은 2MB 이하만 업로드할 수 있습니다." }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = crypto.randomUUID() + ext;
    // S3 (`uploads/logos/<key>`) 로 직접 저장. 컨테이너 로컬 fs 는 ephemeral 이라 사용 불가.
    await putLogoObject(filename, buffer, file.type);
    // 응답 path 형식은 기존(`/uploads/logos/<key>`) 그대로 유지한다.
    // next.config.mjs 의 rewrites 가 같은 경로를 인증 프록시 GET 라우트로 라우팅한다.
    return NextResponse.json({ path: "/uploads/logos/" + filename });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
