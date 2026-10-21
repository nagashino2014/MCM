import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { ensureMailbox } from "@/lib/mail/mailbox";
import { getMailboxUsage, listFolders } from "@/lib/mail/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 폴더 목록 + 안읽음/전체 카운트(3-pane 좌측 트리). 첫 진입 시 mailbox 보장.
//   usage = 메일함 사용량·총용량·전체/안읽음 건수(좌측 [메일 설정] 아래 게이지).
export async function GET() {
  try {
    const ctx = await requireSession();
    await ensureMailbox(ctx.userId);
    const [res, usage] = await Promise.all([listFolders(ctx.userId), getMailboxUsage(ctx.userId)]);
    return NextResponse.json({ ...res, usage });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
