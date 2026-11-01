import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { recordAuditLog } from "@/lib/auth/audit";
import { proposalAi } from "@/lib/proposal/ai/server";
import type { AiAction, AiScope } from "@/lib/proposal/ai/ops";
import { ProposalError, validateProposalDocument, validateProposalId } from "@/lib/proposal/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const MAX_BYTES = 2 * 1024 * 1024;
const ACTIONS: AiAction[] = ["polish", "bullets", "shorten", "expand", "client", "free"];

async function bodyOf(req: NextRequest): Promise<Record<string, unknown>> {
  if (Number(req.headers.get("content-length")) > MAX_BYTES) throw new ProposalError("요청이 2 MB를 넘습니다. 그림을 빼고 보내 주세요.", 413);
  const text = await req.text();
  if (text.length > MAX_BYTES) throw new ProposalError("요청이 2 MB를 넘습니다. 그림을 빼고 보내 주세요.", 413);
  try { const b = JSON.parse(text); if (b && typeof b === "object" && !Array.isArray(b)) return b; } catch { /* 아래에서 알림 */ }
  throw new ProposalError("요청 형식이 올바르지 않습니다.");
}

// POST: [AI로 고치기] 제안 { context(문서 머리·변수), section(그 쪽), scope, blockId?, action, instruction, neighbors? } → 검토할 op
//   저장 전 편집도 대상이라 문서를 DB 에서 읽지 않고 받은 쪽을 다시 검증한다. 응답 원문은 저장하지 않는다.
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const b = await bodyOf(req);
    const ctx = (b.context && typeof b.context === "object" ? b.context : {}) as Record<string, unknown>;
    const scope: AiScope = b.scope === "page" ? "page" : "block";
    const action = ACTIONS.includes(b.action as AiAction) ? (b.action as AiAction) : "free";
    // 받은 쪽 하나로 문서를 만들어 저장 검증과 같은 검사를 거친다(형식·길이·id).
    const doc = validateProposalDocument({ ...ctx, schemaVersion: 2, id: validateProposalId(ctx.id), sections: [b.section] });
    const n = (b.neighbors && typeof b.neighbors === "object" ? b.neighbors : {}) as Record<string, unknown>;
    const result = await proposalAi.propose({
      doc, sectionId: doc.sections[0].id, scope, blockId: typeof b.blockId === "string" ? b.blockId : undefined, action,
      instruction: typeof b.instruction === "string" ? b.instruction : "",
      neighbors: { prev: typeof n.prev === "string" ? n.prev.slice(0, 200) : undefined, next: typeof n.next === "string" ? n.next.slice(0, 200) : undefined },
      userId: actor.userId,
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return authErrorToResponse(err);
  }
}

// PUT: 채택 기록 { documentId, applied, review, source, action } — 바꾼 칸 수만 남기고 글은 남기지 않는다(쟁점 D7).
export async function PUT(req: NextRequest) {
  try {
    const actor = await requirePermission("catalog.manage");
    const b = await bodyOf(req);
    const count = (v: unknown) => Math.max(0, Math.min(500, Math.floor(Number(v) || 0)));
    await recordAuditLog({
      actorUserId: actor.userId,
      action: "proposal_ai_apply",
      targetTable: "proposal_documents",
      targetId: validateProposalId(b.documentId),
      after: { applied: count(b.applied), review: count(b.review), stale: count(b.stale), source: b.source === "rule" ? "rule" : "ai", action: ACTIONS.includes(b.action as AiAction) ? b.action : "free", scope: b.scope === "page" ? "page" : "block" },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return authErrorToResponse(err);
  }
}
