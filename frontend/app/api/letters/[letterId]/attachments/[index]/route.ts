import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { rawResponse } from "@/lib/approval/attachment-preview";
import { listLetterAttachments } from "@/lib/letter/bundle";
import { getLetterById } from "@/lib/letter/store";
import { readContractDocument } from "@/lib/storage/contract-document-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 공문 첨부서류 1건 원본 내려받기(2026-11-03) — 문서함 공문 뷰어의 첨부 목록에서 하나씩 받는다.
// index 는 발송 메일 동봉 순서(시스템 공문) 또는 이관 등록 순서(과거 이관 공문).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ letterId: string; index: string }> }) {
  try {
    await requirePermission("approval.view");
    const { letterId, index } = await params;
    const letter = await getLetterById(letterId);
    if (!letter) return NextResponse.json({ error: "공문을 찾을 수 없습니다." }, { status: 404 });
    const att = (await listLetterAttachments(letter))[Number(index)];
    if (!att) return NextResponse.json({ error: "첨부서류를 찾을 수 없습니다." }, { status: 404 });
    const body = await readContractDocument(att.key);
    if (!body) return NextResponse.json({ error: "첨부 원본을 읽을 수 없습니다." }, { status: 404 });
    return rawResponse(body, att.name, true);
  } catch (err) {
    return authErrorToResponse(err);
  }
}
