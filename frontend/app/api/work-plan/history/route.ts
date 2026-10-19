import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";
import { requireSubjectScope } from "@/lib/auth/scope-guards";
import { listSubjectHistory } from "@/lib/work-plan/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 지난 추진 내역 이력 — 한 용역/Task의 1차 보고 전 회차 추진내역(작성·감독·임원 공통 모달용).
export async function GET(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams;
    const kind = sp.get("kind") === "task" ? "task" : "contract";
    const id = sp.get("id") ?? "";
    if (!id) return NextResponse.json({ entries: [] });
    await requireSubjectScope("work_plan.view", kind, id); // 주제 부서 범위(2026-10-19 §7.7)
    return NextResponse.json({ entries: await listSubjectHistory(kind, id) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
