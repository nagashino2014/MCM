import { NextRequest, NextResponse } from "next/server";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { attachmentContentType } from "@/lib/approval/attachments";
import {
  buildUserSharedRecord,
  ChatAccessError,
  type ChatSharedRecord,
  listMentionedMembers,
  listMessages,
  listPushTargets,
  postFileMessage,
  postTextMessage,
  postUploadedFileMessage,
  pushInfoForMessage,
} from "@/lib/chat/queries";
import { getPersonalDoc } from "@/lib/files/personal";
import { sendPush } from "@/lib/notify/push-expo";
import { readContractDocument } from "@/lib/storage/contract-document-storage";
import { getS3Client } from "@/lib/storage/logo-storage";
import { assertAttachmentsAllowed } from "@/lib/security/attachment-policy";

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

/**
 * 커밋 후 fire-and-forget 푸시 — 실패가 전송 자체를 막지 않는다(approval notify 정책).
 * mentionText(본문·캡션)에서 `@이름` 으로 불린 멤버는 방 알림을 꺼 뒀어도 "멘션" 알림을 받고, 일반 알림 대상에서는 뺀다(한 메시지에 한 번).
 */
function firePush(roomId: number, senderId: string, messageId: number, preview: string, mentionText = ""): void {
  void (async () => {
    try {
      const mentioned = mentionText ? await listMentionedMembers(roomId, senderId, mentionText) : [];
      const targets = (await listPushTargets(roomId, senderId)).filter((id) => !mentioned.includes(id));
      if (!targets.length && !mentioned.length) return;
      const info = await pushInfoForMessage(roomId, senderId);
      const title =
        info.roomType === "group" && info.roomName
          ? `${info.roomName}: ${info.senderName}`
          : info.senderName;
      const common = {
        body: preview,
        link: `/chat/${roomId}`,
        targetRef: `chat:${roomId}`,
        dedupKey: `chat:${roomId}:${messageId}`,
        // 앱 아이콘 배지 숫자(안읽은 대화+메일+미결재) — iOS 는 푸시에 실어야 꺼진 앱에서도 숫자가 맞는다(2026-11-12).
        appBadge: true,
      };
      if (mentioned.length) {
        await sendPush(mentioned, { ...common, event: "chat.mention", title: `${title}님이 나를 언급했습니다` });
      }
      if (targets.length) await sendPush(targets, { ...common, event: "chat.message", title });
    } catch (e) {
      console.error("[chat] 푸시 발송 실패:", e);
    }
  })();
}

// 메시지 전송.
// - JSON { body, replyTo?, sharedRecord? } : 텍스트. sharedRecord({ type, id, title })를 주면 사내 기록 카드가 붙는다
// - JSON { personalDocId, body? } : 내 개인 문서함 파일을 이 방의 첨부로 보낸다(body 는 캡션)
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
          { error: "25MB 를 넘는 첨부는 대용량 업로드 경로로 보내야 합니다. 앱을 최신으로 업데이트해 주세요." },
          { status: 413 }
        );
      }
      await assertAttachmentsAllowed(userId, [file.name || "file"]); // 첨부 확장자 정책(262)
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
      firePush(roomId, userId, messageId, `${file.type.startsWith("image/") ? "🖼" : "📎"} ${file.name}`, caption);
      return NextResponse.json({ messageId }, { status: 201 });
    }

    const body = (await req.json().catch(() => null)) as
      | {
          body?: unknown;
          replyTo?: unknown;
          sharedRecord?: unknown;
          personalDocId?: unknown;
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
      await assertAttachmentsAllowed(userId, [fileName]); // 첨부 확장자 정책(262)
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
      firePush(roomId, userId, messageId, `${contentType.startsWith("image/") ? "🖼" : "📎"} ${fileName}`, caption);
      return NextResponse.json({ messageId }, { status: 201 });
    }

    // 개인 문서함 파일 보내기 — 본인 문서만. 본문은 서버가 문서함에서 읽어 이 방의 첨부로 복제한다(문서함 원본은 그대로).
    if (typeof body?.personalDocId === "string" && body.personalDocId) {
      const doc = await getPersonalDoc(userId, body.personalDocId);
      if (!doc) return NextResponse.json({ error: "문서함에서 파일을 찾을 수 없습니다." }, { status: 404 });
      await assertAttachmentsAllowed(userId, [doc.fileName]); // 첨부 확장자 정책(262)
      const buffer = await readContractDocument(doc.storageKey);
      if (!buffer) {
        return NextResponse.json({ error: `'${doc.fileName}' 파일 본문을 읽지 못했습니다.` }, { status: 500 });
      }
      const contentType = doc.contentType || attachmentContentType(doc.fileName);
      const caption = typeof body.body === "string" ? body.body : "";
      const messageId = await postFileMessage(
        roomId,
        userId,
        { buffer, fileName: doc.fileName, contentType, byteSize: buffer.length },
        caption
      );
      firePush(roomId, userId, messageId, `${contentType.startsWith("image/") ? "🖼" : "📎"} ${doc.fileName}`, caption);
      return NextResponse.json({ messageId }, { status: 201 });
    }

    const text = typeof body?.body === "string" ? body.body : "";
    const replyTo = typeof body?.replyTo === "number" ? body.replyTo : null;
    let sharedRecord: ChatSharedRecord | undefined;
    if (body?.sharedRecord != null) {
      const built = buildUserSharedRecord(body.sharedRecord);
      if (!built) return NextResponse.json({ error: "공유할 문서를 확인하세요." }, { status: 400 });
      sharedRecord = built;
    }
    const messageId = await postTextMessage(roomId, userId, text, replyTo, sharedRecord);
    firePush(roomId, userId, messageId, text.replace(/\s+/g, " ").slice(0, 80), text);
    return NextResponse.json({ messageId }, { status: 201 });
  } catch (err) {
    if (err instanceof ChatAccessError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return authErrorToResponse(err);
  }
}
