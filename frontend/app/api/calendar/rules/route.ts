// 정기 회의 규칙(주간회의·간부간담회 등, 219) — GET 목록(누구나) / PUT 일괄 저장(관리자·임원).
// 규칙이 바뀌면 오늘 이후의 미수정 occurrence 가 지워지고 다음 월 조회에서 새 규칙대로 재생성된다.

import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listRules, loadEntryAccess, saveRules, type RuleInput } from "@/lib/calendar/entries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession();
    return NextResponse.json({ rules: await listRules() });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function PUT(req: Request) {
  try {
    const ctx = await requireSession();
    const access = await loadEntryAccess(ctx.userId);
    if (!access.meeting) return NextResponse.json({ error: "정기 회의 규칙은 관리자·임원만 설정할 수 있습니다." }, { status: 403 });
    const body = (await req.json()) as { rules?: RuleInput[] };
    const rules = await saveRules(Array.isArray(body.rules) ? body.rules : [], access);
    return NextResponse.json({ rules });
  } catch (err) {
    if (err instanceof Error && !("status" in err)) return NextResponse.json({ error: err.message }, { status: 400 });
    return authErrorToResponse(err);
  }
}
