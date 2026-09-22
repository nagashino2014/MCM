import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listSupplyReviews, listSupplyReviewHistory, previewSupplyReview, saveSupplyReview, withdrawSupplyReview } from "@/lib/finance/supply-reviews";
import { supplyReviewError } from "@/lib/finance/supply-review-pure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function canManage() { try { await requirePermission("finance.manage"); return true; }
  catch (error) { if ((error as { status?: number }).status === 403) return false; throw error; } }
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const p = req.nextUrl.searchParams, keys = [...p.keys()];
    if (keys.some(k => !["caseId", "subjectId", "sourceOffset"].includes(k)) || new Set(keys).size !== keys.length
      || p.has("caseId") && keys.length !== 1 || p.has("sourceOffset") && (!p.has("subjectId") || !/^(0|[1-9]\d{0,6})$/.test(p.get("sourceOffset")!))) throw supplyReviewError("조회 조건을 확인하세요.");
    if (p.has("caseId")) return NextResponse.json(await listSupplyReviewHistory(p.get("caseId")!));
    return NextResponse.json({ ...await listSupplyReviews(p.get("subjectId") ?? undefined, Number(p.get("sourceOffset") ?? 0)), canManage: await canManage() });
  } catch (error) { return authErrorToResponse(error); }
}
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("finance.manage"), reader = req.body?.getReader();
    if (!reader) throw supplyReviewError("요청 본문이 필요합니다.");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > 512000) { await reader.cancel(); throw supplyReviewError("요청 본문이 너무 큽니다."); } chunks.push(part.value); }
    let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw supplyReviewError("요청 본문을 확인하세요."); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw supplyReviewError("요청 본문을 확인하세요.");
    const { action, ...input } = body as Record<string, unknown>;
    if (action === "preview") return NextResponse.json(await previewSupplyReview(input));
    if (action === "save") return NextResponse.json(await saveSupplyReview(input, actor.userId));
    if (action === "withdraw") return NextResponse.json(await withdrawSupplyReview(input, actor.userId));
    throw supplyReviewError("지원하지 않는 작업입니다.");
  } catch (error) { return authErrorToResponse(error); }
}
