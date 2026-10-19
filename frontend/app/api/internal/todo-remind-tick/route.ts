import { NextRequest, NextResponse } from "next/server";
import { dispatchTodoDigest, dispatchTodoReminders } from "@/lib/todo/notify";
import { dispatchTodoWeekly } from "@/lib/todo/weekly";
import { dispatchTodoRules } from "@/lib/todo/rules";
import { snapshotBoardProgress } from "@/lib/todo/snapshots";
import { archiveCompletedItems } from "@/lib/todo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 할 일 알림 틱(§9) — instrumentation.ts 5분 타이머가 자기호출(localhost).
 * instrumentation 은 edge 로도 번들되어 pg 직접 import 불가 → 라우트로 위임. AUTH_SECRET 헤더 가드.
 * 리마인드(remind_at 도래·스누즈 고려, remind_sent_at 선점) → 아침 요약(KST 일 1회, 0건 미발송) → 완료 30일 보관.
 * 각 단계는 독립 실패(한 단계 오류가 다음을 막지 않음).
 */
export async function POST(req: NextRequest) {
  const key = req.headers.get("x-cron-key") ?? "";
  const secret = process.env.AUTH_SECRET ?? "";
  if (!secret || key !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const reminders = await dispatchTodoReminders().catch((e) => {
      console.error("[todo-remind] reminders error", e);
      return { remindersSent: 0, candidates: 0 };
    });
    const digest = await dispatchTodoDigest().catch((e) => {
      console.error("[todo-remind] digest error", e);
      return { digestsSent: 0, evaluated: 0 };
    });
    // §29-3 주간 리포트(295) — 요일·시각 도래 시 사람당 주 1회
    const weekly = await dispatchTodoWeekly().catch((e) => {
      console.error("[todo-remind] weekly error", e);
      return { weeklySent: 0, weeklyEvaluated: 0 };
    });
    // §29-2 자동화 시간 트리거(마감 N일 전, 296)
    const rules = await dispatchTodoRules().catch((e) => {
      console.error("[todo-remind] rules error", e);
      return { rulesRun: 0, rulesEvaluated: 0 };
    });
    // 297 보드 진척 일일 스냅샷(날짜당 보드마다 1행)
    const snap = await snapshotBoardProgress().catch((e) => {
      console.error("[todo-remind] snapshot error", e);
      return { snapshots: 0 };
    });
    const archive = await archiveCompletedItems().catch((e) => {
      console.error("[todo-remind] archive error", e);
      return { archived: 0 };
    });
    return NextResponse.json({ ...reminders, ...digest, ...weekly, ...rules, ...snap, ...archive });
  } catch (err) {
    console.error("[todo-remind] tick error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
