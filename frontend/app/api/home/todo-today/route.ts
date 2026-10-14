import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listTodayForHome } from "@/lib/todo/store";
import { listMyPendingApprovals, listTodoApprovalEvents } from "@/lib/todo/approval-events";
import type { TodoApprovalEvent } from "@/lib/todo/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 홈 위젯 H12 "오늘 할 일"(§7.1) — 지연·오늘·이번 주 상위 5건 + 건수 + 오늘 결재 일정(§11, 회색 읽기 전용 행)
//   + 내가 결재할 차례인 문서(kind "pending", 결재 대기 — 일정 앞에).
export async function GET() {
  try {
    const ctx = await requireSession();
    const summary = await listTodayForHome(ctx.userId);
    // 오늘 결재 일정(휴가·출장·교육·초과근무 등) — 실패해도 할 일 목록은 살린다.
    let approvalEvents: TodoApprovalEvent[] = [];
    try {
      approvalEvents = await listTodoApprovalEvents(ctx.userId, summary.today, summary.today);
    } catch (e) {
      console.error("[todo-today] 결재 일정 조회 실패", e);
    }
    try {
      approvalEvents = [...(await listMyPendingApprovals(ctx.userId)), ...approvalEvents];
    } catch (e) {
      console.error("[todo-today] 결재 대기 조회 실패", e);
    }
    return NextResponse.json({ ...summary, approvalEvents });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
