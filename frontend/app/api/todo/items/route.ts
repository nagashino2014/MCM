import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { createItem, listItems } from "@/lib/todo/store";
import { listBoardApprovalEvents, listMyPendingApprovals, listTodoApprovalEvents } from "@/lib/todo/approval-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 할 일 목록·생성(274). GET ?view=my|board|shared&board=&from=&to=&done=1&withApproval=1 / POST 생성.
// 가시성은 lib/todo/visibility.ts 단일 진입점. withApproval=1 이면 결재 일정(휴가·출장·교육·초과근무)을 approvalEvents 로 동봉 —
//   view=board 는 그 보드 멤버 전원의 문서 중 보드 contract_id 와 일치하는 것만(§19-12), 그 외는 내 문서.
//   view=my 는 여기에 내가 결재할 차례인 문서(kind "pending", 결재 대기)를 앞에 합친다 — 보드 모드는 제외.
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const sp = req.nextUrl.searchParams;
    const viewRaw = sp.get("view") ?? "my";
    const view = viewRaw === "board" || viewRaw === "shared" ? viewRaw : "my";
    const from = sp.get("from");
    const to = sp.get("to");
    const { items, boards } = await listItems(ctx.userId, {
      view,
      boardId: sp.get("board"),
      from,
      to,
      done: sp.get("done") === "1",
      includeArchived: sp.get("archived") === "1",
    });
    let approvalEvents: Awaited<ReturnType<typeof listTodoApprovalEvents>> = [];
    if (sp.get("withApproval") === "1") {
      // 구간이 없으면 KST 이번 달 기준 ±1개월.
      const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const f = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : `${today.slice(0, 7)}-01`;
      const t = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : (() => {
        const d = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() + 2);
        d.setUTCDate(0);
        return d.toISOString().slice(0, 10);
      })();
      try {
        const boardId = sp.get("board");
        approvalEvents =
          view === "board" && boardId ? await listBoardApprovalEvents(ctx.userId, boardId, f, t) : await listTodoApprovalEvents(ctx.userId, f, t);
      } catch (e) {
        console.error("[todo] 결재 일정 조회 실패", e);
      }
      if (view === "my") {
        // 결재 대기(내 차례) — 일정과 별개로 항상 동봉. 실패해도 일정·할 일은 살린다.
        try {
          approvalEvents = [...(await listMyPendingApprovals(ctx.userId)), ...approvalEvents];
        } catch (e) {
          console.error("[todo] 결재 대기 조회 실패", e);
        }
      }
    }
    return NextResponse.json({ items, boards, approvalEvents });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireSession();
    const body = await req.json().catch(() => ({}));
    const item = await createItem(ctx.userId, body ?? {});
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
