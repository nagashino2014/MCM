import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { deleteSignature, listSignatures, saveSignature } from "@/lib/mail/signatures";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 내 서명 템플릿 목록(기본 서명 우선 정렬).
export async function GET() {
  try {
    const ctx = await requireSession();
    return NextResponse.json({ signatures: await listSignatures(ctx.userId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 서명 upsert — body: { signatureId?, name, bodyHtml, isDefault?, subjectPrefix? }
export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = (await req.json().catch(() => ({}))) as {
      signatureId?: string | null;
      name?: string;
      bodyHtml?: string;
      isDefault?: boolean;
      subjectPrefix?: string | null;
    };
    const signatureId = await saveSignature(ctx.userId, {
      signatureId: body.signatureId ?? null,
      name: String(body.name ?? ""),
      bodyHtml: String(body.bodyHtml ?? ""),
      isDefault: body.isDefault === true,
      subjectPrefix: body.subjectPrefix != null ? String(body.subjectPrefix) : null,
    });
    return NextResponse.json({ ok: true, signatureId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE ?id= : 서명 삭제.
export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const id = String(req.nextUrl.searchParams.get("id") ?? "");
    if (!id) return NextResponse.json({ error: "id 가 필요합니다." }, { status: 400 });
    await deleteSignature(ctx.userId, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
