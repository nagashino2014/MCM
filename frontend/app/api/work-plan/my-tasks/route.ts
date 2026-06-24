import { NextResponse } from "next/server";
import { authErrorToResponse, requireSession } from "@/lib/auth/guards";
import { listMyTasks } from "@/lib/work-plan/tasks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 진행 Task = 로그인 사용자가 수행인력으로 매핑된 Task 목록.
export async function GET() {
  try {
    const ctx = await requireSession();
    return NextResponse.json({ tasks: await listMyTasks(ctx.userId) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
