import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { readContractDocument } from "@/lib/storage/contract-document-storage";
import { attachmentContentType } from "@/lib/approval/attachments";
import { createRoom, postFileMessage } from "@/lib/chat/queries";
import { getPersonalDoc } from "@/lib/files/personal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/personal-docs/send — 개인문서함 파일을 임직원 DM 으로 발송(메신저 전송, 복수 대상).
// body: { docIds: string[], targetUserIds: string[], caption?: string }
//   대상은 조직도 트리에서 고른 임직원의 userId — 거래처 담당자는 메신저 전송 불가(메일만).
// 메일 전송은 이 라우트를 쓰지 않는다 — /mail/compose?attach= 프리필(작성창 삽입) 방식.
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => ({}))) as {
      docIds?: string[];
      targetUserIds?: string[];
      caption?: string;
    };
    const docIds = Array.isArray(body.docIds) ? body.docIds.filter((v) => typeof v === "string") : [];
    const targetUserIds = [
      ...new Set(
        (Array.isArray(body.targetUserIds) ? body.targetUserIds : [])
          .filter((v) => typeof v === "string" && v && v !== ctx.userId)
      ),
    ];
    if (!docIds.length) return NextResponse.json({ error: "전송할 파일을 선택해 주세요." }, { status: 400 });
    if (!targetUserIds.length) return NextResponse.json({ error: "받는 사람을 선택해 주세요." }, { status: 400 });

    // 파일 소유권 검증 + 버퍼 선로딩(대상이 여러 명이어도 S3 는 1회만 읽는다).
    const docs: Array<{ fileName: string; contentType: string; buffer: Buffer }> = [];
    for (const id of docIds) {
      const doc = await getPersonalDoc(ctx.userId, id);
      if (!doc) return NextResponse.json({ error: "선택한 파일 중 찾을 수 없는 항목이 있습니다." }, { status: 404 });
      const buffer = await readContractDocument(doc.storageKey);
      if (!buffer) return NextResponse.json({ error: `'${doc.fileName}' 파일 본문을 읽지 못했습니다.` }, { status: 500 });
      docs.push({
        fileName: doc.fileName,
        contentType: doc.contentType || attachmentContentType(doc.fileName),
        buffer,
      });
    }

    const caption = String(body.caption ?? "").trim();
    let sent = 0;
    for (const targetUserId of targetUserIds) {
      // 대상별 DM 방 확보 → 파일 메시지 발송(첨부는 chat/{roomId}/ 키로 복제 저장).
      const { roomId } = await createRoom(ctx.userId, [targetUserId]);
      for (let i = 0; i < docs.length; i += 1) {
        const doc = docs[i];
        await postFileMessage(
          roomId,
          ctx.userId,
          { buffer: doc.buffer, fileName: doc.fileName, contentType: doc.contentType, byteSize: doc.buffer.length },
          i === 0 ? caption : undefined
        );
        sent += 1;
      }
    }
    return NextResponse.json({ ok: true, targets: targetUserIds.length, sent });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
