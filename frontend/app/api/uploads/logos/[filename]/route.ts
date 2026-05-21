/**
 * 사업장 로고 인증 프록시 GET 라우트.
 *
 * - DB 의 `logo_path` 값은 `/uploads/logos/<key>` 형식.
 *   `next.config.mjs` 의 rewrites 가 동일 경로를 이 라우트로 위임하여
 *   기존 컴포넌트 / 클라이언트 코드를 변경하지 않고 S3 객체를 노출한다.
 * - S3 객체는 비공개이며, ECS task IAM (`s3:GetObject`) 으로 가져와
 *   인증된 세션(viewer 이상)에게만 스트리밍한다.
 */

import { NextResponse } from "next/server";
import { authErrorToResponse, requireAuthenticated } from "@/lib/auth/guards";
import { getLogoObject } from "@/lib/storage/logo-storage";
import { S3ServiceException } from "@aws-sdk/client-s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ filename: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    await requireAuthenticated();
    const { filename } = await ctx.params;
    const obj = await getLogoObject(filename);
    if (!obj.body) {
      return NextResponse.json({ error: "로고를 찾을 수 없습니다." }, { status: 404 });
    }
    const headers = new Headers();
    headers.set("Content-Type", obj.contentType);
    if (obj.contentLength != null) {
      headers.set("Content-Length", String(obj.contentLength));
    }
    headers.set("Cache-Control", obj.cacheControl ?? "private, max-age=86400");
    if (obj.etag) headers.set("ETag", obj.etag);
    if (obj.lastModified) headers.set("Last-Modified", obj.lastModified.toUTCString());
    return new NextResponse(obj.body, { status: 200, headers });
  } catch (err) {
    if (err instanceof S3ServiceException) {
      const code = err.name;
      if (code === "NoSuchKey" || code === "NotFound") {
        return NextResponse.json({ error: "로고를 찾을 수 없습니다." }, { status: 404 });
      }
    }
    return authErrorToResponse(err);
  }
}
