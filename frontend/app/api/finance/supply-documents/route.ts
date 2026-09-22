import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listSupplyDocuments, previewSupplyDocument, registerSupplyDocument } from "@/lib/finance/supply-documents";
import { documentError, documentUnavailable } from "@/lib/finance/supply-document-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(error: unknown) {
  const status = (error as { status?: number })?.status;
  return authErrorToResponse([400, 401, 403, 404, 409, 503].includes(status ?? 0) ? error : documentUnavailable());
}
async function canManage() {
  try { await requirePermission("finance.manage"); return true; }
  catch (error) { if ((error as { status?: number }).status === 403) return false; throw error; }
}
export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const query = req.nextUrl.searchParams, keys = [...query.keys()];
    if (!query.has("subjectId") || new Set(keys).size !== keys.length || keys.some(k => !["subjectId", "documentId"].includes(k))) {
      throw documentError("조회할 회사 기준과 문서를 확인하세요.");
    }
    return NextResponse.json({ ...await listSupplyDocuments(query.get("subjectId")!, query.get("documentId") ?? undefined), canManage: await canManage() });
  } catch (error) { return failure(error); }
}
export async function POST(req: NextRequest) {
  try {
    // 권한 확인을 요청 해석보다 먼저 수행해 미리보기의 존재·건수도 노출하지 않는다.
    const actor = await requirePermission("finance.manage"), reader = req.body?.getReader();
    if (!reader) throw documentError("요청 본문이 필요합니다.");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 16000) { await reader.cancel(); throw documentError("요청 본문이 너무 큽니다."); }
      chunks.push(next.value);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw documentError("요청 본문을 확인하세요."); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw documentError("요청 본문을 확인하세요.");
    const { action, ...input } = parsed as Record<string, unknown>;
    if (action === "preview") return NextResponse.json(await previewSupplyDocument(input));
    if (action === "register") return NextResponse.json(await registerSupplyDocument(input, actor.userId));
    throw documentError("지원하지 않는 문서 등록 작업입니다.");
  } catch (error) { return failure(error); }
}
