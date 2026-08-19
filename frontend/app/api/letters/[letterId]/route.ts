import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { deleteImportedLetter, getLetterById, updateLetterMeta } from "@/lib/letter/store";
import type { LetterRecipient } from "@/lib/letter/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 공문 대장 단건 / PATCH: 수신처·참조·제목·시행일 사후 편집(백필 문서 메일주소 보완).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ letterId: string }> }) {
  try {
    await requirePermission("approval.manage");
    const { letterId } = await params;
    const letter = await getLetterById(letterId);
    if (!letter) return NextResponse.json({ error: "공문을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ letter });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ letterId: string }> }) {
  try {
    await requirePermission("approval.manage");
    const { letterId } = await params;
    const letter = await getLetterById(letterId);
    if (!letter) return NextResponse.json({ error: "공문을 찾을 수 없습니다." }, { status: 404 });
    const body = (await req.json()) as {
      title?: string;
      issueDate?: string | null;
      recipients?: LetterRecipient[];
      ccRefs?: LetterRecipient[];
    };
    await updateLetterMeta(letterId, {
      title: typeof body.title === "string" ? body.title : undefined,
      issueDate: body.issueDate !== undefined ? body.issueDate : undefined,
      recipients: Array.isArray(body.recipients) ? body.recipients : undefined,
      ccRefs: Array.isArray(body.ccRefs) ? body.ccRefs : undefined,
    });
    return NextResponse.json({ letter: await getLetterById(letterId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// DELETE: 이관(imported) 등록 문서 삭제 — 오등록 정정용. 시스템 생성(결재 문서 연결) 공문은 대상 아님.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ letterId: string }> }) {
  try {
    const ctx = await requirePermission("approval.manage");
    const { letterId } = await params;
    const letter = await getLetterById(letterId);
    if (!letter) return NextResponse.json({ error: "공문을 찾을 수 없습니다." }, { status: 404 });
    if (letter.source !== "imported") {
      return NextResponse.json({ error: "이관 등록 문서만 삭제할 수 있습니다(시스템 발송 공문은 결재 문서에서 관리)." }, { status: 400 });
    }
    const deleted = await deleteImportedLetter(letterId);
    if (deleted) {
      await recordAuditLog({
        actorUserId: ctx.userId,
        action: "letter_import_delete",
        targetTable: "official_letters",
        targetId: letterId,
        before: { letterNo: letter.letterNo, title: letter.title },
      });
    }
    return NextResponse.json({ ok: deleted });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
