import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listSupplySame, previewSupplySame, verifySupplySame, withdrawSupplySame } from "@/lib/finance/supply-same-reviews";

import { sameConflictResponse } from "@/lib/finance/supply-same-diagnostics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const invalid = (message = "동일 공급 확인 요청을 확인하세요.") => Object.assign(new Error(message), { status: 400 });
function failure(error: unknown, action?: string) {
  const status = (error as { status?: number })?.status;
  if (status === 409) return NextResponse.json(sameConflictResponse(error, action), { status: 409 });
  return authErrorToResponse([400, 401, 403, 404, 409, 503].includes(status ?? 0) ? error : Object.assign(new Error("동일 공급 확인 자료를 읽을 수 없습니다."), { status: 503 }));
}
async function canManage() {
  try { await requirePermission("finance.manage"); return true; }
  catch (error) { if ((error as { status?: number }).status === 403) return false; throw error; }
}
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const query = req.nextUrl.searchParams, names = [...query.keys()];
    if (!query.has("subjectId") || new Set(names).size !== names.length || names.some(name => !["subjectId", "caseId", "cursor"].includes(name))) throw invalid();
    return NextResponse.json({ ...await listSupplySame(query.get("subjectId")!, query.get("caseId") ?? undefined, query.get("cursor") ?? undefined), canManage: await canManage() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  let attemptedAction: string | undefined;
  try {
    const actor = await requirePermission("finance.manage"), reader = req.body?.getReader();
    if (!reader) throw invalid();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 16000) { await reader.cancel(); throw invalid("요청 본문이 너무 큽니다."); }
      chunks.push(next.value);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw invalid(); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalid();
    const { action, ...input } = parsed as Record<string, unknown>;
    if (action === "preview") return NextResponse.json(await previewSupplySame(input));
    if (action === "verify") return NextResponse.json(await verifySupplySame(input, actor.userId));
    if (action === "withdraw") { attemptedAction = action; return NextResponse.json(await withdrawSupplySame(input, actor.userId)); }
    throw invalid("지원하지 않는 동일 공급 확인 작업입니다.");
  } catch (error) { return failure(error, attemptedAction); }
}
