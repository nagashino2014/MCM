import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import type { SemanticConceptItem } from "@/lib/approval/semantic-concepts";
import { listSemanticConcepts, saveSemanticConcepts } from "@/lib/approval/semantic-concepts-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET: 시맨틱 개념 사전 — 빌더(태깅 드롭다운)·관리 화면 공용. ?all=1 이면 비활성 포함
export async function GET(req: NextRequest) {
  try {
    await requirePermission("approval.view");
    const all = req.nextUrl.searchParams.get("all") === "1";
    return NextResponse.json({ concepts: await listSemanticConcepts(!all) });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// POST: 사전 전체 저장(admin) — 고객사/규정 변화에 맞춰 관리자가 개념을 가감한다
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("approval.manage", { fallbackRoles: ["admin"] });
    const body = (await req.json().catch(() => ({}))) as { concepts?: SemanticConceptItem[] };
    if (!Array.isArray(body.concepts)) return NextResponse.json({ error: "concepts 배열이 필요합니다." }, { status: 400 });
    const count = await saveSemanticConcepts(body.concepts, actor.userId);
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "approval_semantic_update",
      targetTable: "semantic_concepts",
      targetId: "catalog",
      after: { saved: count },
    });
    return NextResponse.json({ saved: count });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
