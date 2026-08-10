import { NextRequest, NextResponse } from "next/server";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import {
  ChatAccessError,
  listMessages,
  listPushTargets,
  postFileMessage,
  postTextMessage,
  postUploadedFileMessage,
  pushInfoForMessage,
} from "@/lib/chat/queries";
import { sendPush } from "@/lib/notify/push-expo";
import { getS3Client } from "@/lib/storage/logo-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 첨부 업로드 한도 — API 경유 25MB(초과 대용량은 MSG-P2 presigned 경로). */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function parseRoomId(v: string): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// 메시지 조회 — ?before=<id>(과거 페이징) / ?after=<id>(증분 폴링) / &limit. 오름차순 반환.
export async function GET(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  try {
    const { userId } = await requireSession();
    const roomId = parseRoomId((await ctx.params).roomId);
    if (!roomId) return NextResponse.json({ error: "잘못된 대화방입니다." }, { status: 400 });
    const sp = req.nextUrl.searchParams;
    const before = sp.get("before") ? Number(sp.get("before")) : undefined;
    const after = sp.get("after") ? Number(sp.get("after")) : undefined;
    const limit = sp.get("limit") ? Number(sp.get("limit")) : undefined;
    const messages = await listMessages(roomId, userId, { before, after, limit });
    return NextResponse.json({ messages });
  } catch (err) {
    if (err instanceof ChatAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return authErrorToResponse(err);
  }
}

/** 커밋 후 fire-and-forget 푸시 — 실패가 전송 자체를 막지 않는다(approval notify 정책). */
function firePush(roomId: number, senderId: string, messageId: number, preview: string): void {
  void (async () => {
    try {
      const targets = await listPushTargets(roomId, senderId);
      if (!targets.length) return;
      const info = await pushInfoForMessage(roomId, senderId);
      const title =
        info.roomType === "group" && info.roomName
          ? `${info.roomName}: ${info.senderName}`
          : info.senderName;
      await sendPush(targets, {
        event: "chat.message",
        title,
        body: preview,
        link: `/chat/${roomId}`,
        targetRef: `chat:${roomId}`,
        dedupKey: `chat:${roomId}:${messageId}`,
      });
    } catch (e) {
      console.error("[chat] 푸시 발송 실패:", e);
    }
  })();
}

// 메시지 전송.
// - JSON { body, replyTo? } : 텍스트
// - multipart(file + caption?) : 첨부(25MB, image/* 는 image 버블) — MSG-P1
export async function POST(req: NextRequest, ctx: { params: Promise<{ roomId: string }> }) {
  try {
    const { userId } = await requireSession();
    const roomId = parseRoomId((await ctx.params).roomId);
    if (!roomId) return NextResponse.json({ error: "잘못된 대화방입니다." }, { status: 400 });

    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "file 파트가 필요합니다." }, { status: 400 });
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        return NextResponse.json(
          { error: "첨부는 25MB 이하만 보낼 수 있습니다. (대용량 전송은 준비 중)" },
          { status: 413 }
        );
      }
      const caption = typeof form.get("caption") === "string" ? String(form.get("caption")) : "";
      const buffer = Buffer.from(await file.arrayBuffer());
      const messageId = await postFileMessage(
        roomId,
        userId,
        {
          buffer,
          fileName: file.name || "file",
          contentType: file.type || "application/octet-stream",
          byteSize: file.size,
        },
        caption
      );
      firePush(roomId, userId, messageId, `${file.type.startsWith("image/") ? "🖼" : "📎"} ${file.name}`);
      return NextResponse.json({ messageId }, { status: 201 });
    }

    const body = (await req.json().catch(() => null)) as
      | {
          body?: unknown;
          replyTo?: unknown;
          upload?: { storageKey?: unknown; fileName?: unknown; contentType?: unknown; byteSize?: unknown };
        }
      | null;

    // presigned 업로드 확정(MSG-P2) — S3 에 실제로 올라갔는지 확인 후 메시지를 만든다.
    if (body?.upload && typeof body.upload.storageKey === "string") {
      const up = body.upload;
      const storageKey = String(up.storageKey);
      const fileName = typeof up.fileName === "string" && up.fileName ? up.fileName : "file";
      const contentType =
        typeof up.contentType === "string" && up.contentType ? up.contentType : "application/octet-stream";
      const bucket = process.env.MCM_STORAGE_BUCKET?.trim();
      if (!bucket) return NextResponse.json({ error: "스토리지 미설정" }, { status: 500 });
      let byteSize = typeof up.byteSize === "number" ? up.byteSize : 0;
      try {
        const head = await getS3Client().send(new HeadObjectCommand({ Bucket: bucket, Key: storageKey }));
        if (typeof head.ContentLength === "number") byteSize = head.ContentLength;
      } catch {
        return NextResponse.json({ error: "업로드된 파일을 찾을 수 없습니다. 다시 시도해 주세요." }, { status: 400 });
      }
      const caption = typeof body.body === "string" ? body.body : "";
      const messageId = await postUploadedFileMessage(
        roomId,
        userId,
        { storageKey, fileName, contentType, byteSize },
        caption
      );
      firePush(roomId, userId, messageId, `${contentType.startsWith("image/") ? "🖼" : "📎"} ${fileName}`);
      return NextResponse.json({ messageId }, { status: 201 });
    }

    const text = typeof body?.body === "string" ? body.body : "";
    const replyTo = typeof body?.replyTo === "number" ? body.replyTo : null;
    const messageId = await postTextMessage(roomId, userId, text, replyTo);
    firePush(roomId, userId, messageId, text.replace(/\s+/g, " ").slice(0, 80));
    return NextResponse.json({ messageId }, { status: 201 });
  } catch (err) {
    if (err instanceof ChatAccessError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
