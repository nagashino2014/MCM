/*
 * To-do 라우트 공용 오류 응답(276) — 완료 조건 미충족(store assertCompletable 이 던지는 409, code complete_rules)을
 * { error, code, missing, openSubtasks } 본문으로 그대로 전달한다. authErrorToResponse 는 { error } 만 싣기 때문에 분리.
 */
import { NextResponse } from "next/server";
import { authErrorToResponse } from "@/lib/auth/guards";

export function completeRulesErrorToResponse(err: unknown): NextResponse {
  const e = err as { code?: unknown; status?: unknown; message?: string; detail?: { missing?: unknown; openSubtasks?: unknown } };
  if (e?.code === "complete_rules" && e.status === 409) {
    return NextResponse.json(
      {
        error: e.message ?? "완료 조건을 충족하지 않았습니다.",
        code: "complete_rules",
        missing: Array.isArray(e.detail?.missing) ? e.detail.missing : [],
        openSubtasks: Number(e.detail?.openSubtasks ?? 0),
      },
      { status: 409 }
    );
  }
  return authErrorToResponse(err);
}
