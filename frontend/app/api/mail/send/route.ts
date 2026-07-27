import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { sendMail, type SendAttachmentInput } from "@/lib/mail/send";
import { deleteDraft } from "@/lib/mail/drafts";
import type { MailAddress } from "@/lib/mail/mime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 첨부 총량 상한(요청 전체). SES 원문 메시지 상한(~10MB, base64 오버헤드 감안)에 여유를 둔다.
const MAX_TOTAL_ATTACH_BYTES = 7 * 1024 * 1024;

/** "이름 <addr>" 또는 "addr" 형태의 문자열들을 MailAddress 로 파싱. 콤마/세미콜론 구분. */
function parseRecipients(raw: string | null): MailAddress[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((token) => {
      const m = token.match(/^(.*)<([^>]+)>$/);
      if (m) {
        const name = m[1].trim().replace(/^"|"$/g, "");
        return { name: name || undefined, address: m[2].trim() };
      }
      return { address: token };
    })
    .filter((a) => /.+@.+\..+/.test(a.address));
}

// POST: 메일 발송(multipart/form-data). fields: to, cc, bcc, subject, bodyHtml, idempotencyKey, files[]
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const form = await req.formData();

    const to = parseRecipients(form.get("to") as string | null);
    const cc = parseRecipients(form.get("cc") as string | null);
    const bcc = parseRecipients(form.get("bcc") as string | null);
    const subject = String(form.get("subject") ?? "");
    const bodyHtml = String(form.get("bodyHtml") ?? "");
    const idempotencyKey = (form.get("idempotencyKey") as string | null) ?? undefined;
    const draftId = (form.get("draftId") as string | null) ?? null;
    const inReplyTo = (form.get("inReplyTo") as string | null) || null;
    const referencesRaw = (form.get("references") as string | null) ?? "";
    const references = referencesRaw ? referencesRaw.split(/\s+/).filter(Boolean) : [];

    if (!to.length) return NextResponse.json({ error: "받는 사람이 필요합니다." }, { status: 400 });

    const attachments: SendAttachmentInput[] = [];
    let totalBytes = 0;
    for (const f of form.getAll("files")) {
      if (typeof f === "string") continue;
      const buf = Buffer.from(await f.arrayBuffer());
      totalBytes += buf.length;
      if (totalBytes > MAX_TOTAL_ATTACH_BYTES) {
        return NextResponse.json({ error: "첨부 파일 총량이 7MB 를 초과했습니다." }, { status: 400 });
      }
      attachments.push({ filename: f.name || "attachment", contentType: f.type || "application/octet-stream", content: buf });
    }

    // 인라인 이미지(cid) — inlineFiles 와 같은 순서의 inlineCids(JSON 배열)로 매핑.
    const inlineCids: string[] = (() => {
      try {
        const p = JSON.parse(String(form.get("inlineCids") ?? "[]"));
        return Array.isArray(p) ? p.map(String) : [];
      } catch {
        return [];
      }
    })();
    const inlineFiles = form.getAll("inlineFiles");
    for (let i = 0; i < inlineFiles.length; i++) {
      const f = inlineFiles[i];
      if (typeof f === "string" || !inlineCids[i]) continue;
      const buf = Buffer.from(await f.arrayBuffer());
      totalBytes += buf.length;
      if (totalBytes > MAX_TOTAL_ATTACH_BYTES) {
        return NextResponse.json({ error: "첨부(이미지 포함) 총량이 7MB 를 초과했습니다." }, { status: 400 });
      }
      attachments.push({
        filename: f.name || `image-${i + 1}.png`,
        contentType: f.type || "image/png",
        content: buf,
        contentId: inlineCids[i],
      });
    }

    const result = await sendMail({ userId: ctx.userId, to, cc, bcc, subject, bodyHtml, attachments, idempotencyKey, inReplyTo, references });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "발송에 실패했습니다." }, { status: 502 });
    }
    if (result.duplicate) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    // 발송 성공 → 연결된 드래프트 정리(실패해도 발송 결과에는 영향 없음).
    if (draftId) {
      try {
        await deleteDraft(ctx.userId, draftId);
      } catch {
        /* noop */
      }
    }

    await recordAuditLog({
      actorUserId: ctx.userId,
      action: "mail_send",
      targetTable: "mail_messages",
      targetId: result.messageId ?? "",
      after: { to: to.map((a) => a.address), subject, sesMessageId: result.sesMessageId, attachments: attachments.length },
    });

    return NextResponse.json({ ok: true, messageId: result.messageId, sesMessageId: result.sesMessageId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
