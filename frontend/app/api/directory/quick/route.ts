import { NextRequest, NextResponse } from "next/server";
import { AuthError, authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { hasPermission } from "@/lib/auth/rbac";
import { getDb, withDbWrite } from "@/lib/db";
import {
  listQuickRegistrations,
  lookupQuickContact,
  quickRegister,
  QuickRegisterConflict,
  type QuickRegisterInput,
} from "@/lib/contact-quick/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 주소록 간이 등록(357, 2026-11-12) — 메일 주소를 눌러 업체부터 정하고 담당자를 넣는다.
// 등록은 담당자 추가와 같은 권한(contact.edit 또는 facility.edit, 전 직원). 목록은 관리자(facility.edit)는 전체, 그 외는 본인 등록분.

async function requireContactEditor() {
  const ctx = await requireSession();
  const admin = await hasPermission(ctx.userId, "facility.edit");
  if (admin || (await hasPermission(ctx.userId, "contact.edit"))) return { ...ctx, admin };
  throw new AuthError("주소록에 등록할 권한이 없습니다.", 403);
}

/** ?lookup=<메일 주소> → 양식 처음 상태(이미 있는 담당자·업체 후보). 그 외 → 간이 등록 목록(?status=open|done). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireContactEditor();
    const params = req.nextUrl.searchParams;
    const db = await getDb();
    const lookup = params.get("lookup");
    if (lookup != null) {
      try {
        return NextResponse.json(await lookupQuickContact(db, lookup));
      } catch (err) {
        return NextResponse.json({ error: (err as Error).message }, { status: (err as { status?: number }).status ?? 400 });
      }
    }
    const status = params.get("status") === "done" ? "done" : "open";
    const data = await listQuickRegistrations(db, { userId: ctx.userId, all: ctx.admin, status });
    return NextResponse.json({ ...data, canReview: ctx.admin, userId: ctx.userId });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireContactEditor();
    const body = (await req.json().catch(() => ({}))) as QuickRegisterInput;
    if (!body || typeof body !== "object" || !body.person) return NextResponse.json({ error: "담당자 정보를 입력하세요." }, { status: 400 });
    try {
      const result = await withDbWrite((db) => quickRegister(db, body, ctx.userId));
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof QuickRegisterConflict) return NextResponse.json({ error: err.message, candidates: err.candidates }, { status: 409 });
      const status = (err as { status?: number }).status;
      if (status) return NextResponse.json({ error: (err as Error).message }, { status });
      throw err;
    }
  } catch (err) {
    return authErrorToResponse(err);
  }
}
