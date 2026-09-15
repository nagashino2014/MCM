// 직접 등록 일정 단건 — GET 상세 / PUT 수정 / DELETE 삭제(정기 occurrence 는 '미시행' 처리).

import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { deleteEntry, getEntry, loadEntryAccess, updateEntry } from "@/lib/calendar/entries";
import { deleteResume } from "@/lib/storage/calendar-resume-storage";
import type { CalendarEntryInput } from "@/lib/calendar/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ entryId: string }> };

function domainError(err: unknown): NextResponse | null {
  if (err instanceof Error && !("status" in err)) return NextResponse.json({ error: err.message }, { status: 400 });
  return null;
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requireSession();
    const { entryId } = await params;
    const access = await loadEntryAccess(ctx.userId);
    const entry = await getEntry(entryId, access);
    if (!entry) return NextResponse.json({ error: "일정을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ entry });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const ctx = await requireSession();
    const { entryId } = await params;
    const access = await loadEntryAccess(ctx.userId);
    const body = (await req.json()) as Partial<CalendarEntryInput>;
    const entry = await updateEntry(entryId, body, access);
    return NextResponse.json({ entry });
  } catch (err) {
    return domainError(err) ?? authErrorToResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const ctx = await requireSession();
    const { entryId } = await params;
    const access = await loadEntryAccess(ctx.userId);
    const result = await deleteEntry(entryId, access);
    if (!result.canceled && result.row.extra.resume?.storageKey) await deleteResume(result.row.extra.resume.storageKey);
    return NextResponse.json({ ok: true, canceled: result.canceled });
  } catch (err) {
    return domainError(err) ?? authErrorToResponse(err);
  }
}
