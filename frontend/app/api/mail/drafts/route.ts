import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { deleteDraft, listDrafts, saveDraft } from "@/lib/mail/drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 드래프트 목록(임시보관함).
export async function GET() {
  try {
    const ctx = await requireSession();
    return NextResponse.json({ drafts: await listDrafts(ctx.userId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 드래프트 upsert(자동저장). body: {draftId?, to, cc, subject, bodyHtml, inReplyTo?}
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => ({}))) as {
      draftId?: string | null;
      to?: string;
      cc?: string;
      subject?: string;
      bodyHtml?: string;
      inReplyTo?: string | null;
    };
    const draftId = await saveDraft(ctx.userId, {
      draftId: body.draftId ?? null,
      to: String(body.to ?? ""),
      cc: String(body.cc ?? ""),
      subject: String(body.subject ?? ""),
      bodyHtml: String(body.bodyHtml ?? ""),
      inReplyTo: body.inReplyTo ?? null,
    });
    return NextResponse.json({ ok: true, draftId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE ?id= : 드래프트 삭제.
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const id = String(req.nextUrl.searchParams.get("id") ?? "");
    if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
    await deleteDraft(ctx.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
