import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { ensureMailbox } from "@/lib/mail/mailbox";
import { listFolders } from "@/lib/mail/messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 폴더 목록 + 안읽음/전체 카운트(3-pane 좌측 트리). 첫 진입 시 mailbox 보장.
export async function GET() {
  try {
    const ctx = await requireSession();
    await ensureMailbox(ctx.userId);
    const res = await listFolders(ctx.userId);
    return NextResponse.json(res);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
