import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { applyRecognitionReview, listRecognitionReviewDocuments, listRecognitionReviews, previewRecognitionReview } from "@/lib/finance/recognition-reviews";
import { recognitionError } from "@/lib/finance/recognition-review-pure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function canManage() {
  try { await requirePermission("finance.manage"); return true; }
  catch (error) { if ((error as { status?: number }).status === 403) return false; throw error; }
}
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const params = req.nextUrl.searchParams;
    const keys = [...params.keys()];
    if (keys.some(key => !["subjectId", "from", "to"].includes(key)) || new Set(keys).size !== keys.length
      || params.has("subjectId") && (params.has("from") || params.has("to"))) throw recognitionError("조회 조건이 올바르지 않습니다.", 400);
    if (params.has("subjectId")) return NextResponse.json(await listRecognitionReviewDocuments(params.get("subjectId")!));
    const result = await listRecognitionReviews({ from: params.get("from") ?? undefined, to: params.get("to") ?? undefined });
    return NextResponse.json({ ...result, permissions: { manage: await canManage() } });
  } catch (error) { return authErrorToResponse(error); }
}
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("finance.manage");
    const reader = req.body?.getReader();
    if (!reader) throw recognitionError("요청 본문이 필요합니다.", 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 32768) { await reader.cancel(); throw recognitionError("요청 본문이 너무 큽니다.", 400); }
      chunks.push(part.value);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw recognitionError("요청 본문이 올바르지 않습니다.", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) throw recognitionError("요청 본문이 올바르지 않습니다.", 400);
    const { action, ...input } = body as Record<string, unknown>;
    if (action === "preview") return NextResponse.json(await previewRecognitionReview(input));
    if (action === "apply") return NextResponse.json(await applyRecognitionReview(input, actor.userId));
    throw recognitionError("지원하지 않는 작업입니다.", 400);
  } catch (error) { return authErrorToResponse(error); }
}
