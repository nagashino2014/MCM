import { NextRequest, NextResponse } from "next/server";
import { authErrorToResponse, requirePermission } from "@/lib/auth/guards";
import { listVatFilingDocuments, readVatFilingDocument, uploadVatFilingDocument, VAT_FILING_DOCUMENT_MAX_BYTES } from "@/lib/finance/vat-filing-documents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const invalid = (message: string) => Object.assign(new Error(message), { status: 400, code: "vat_filing_document_input" });
function errorResponse(error: unknown) {
  const response = authErrorToResponse(error);
  Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
  return response;
}
// Content-Length가 없는 요청도 파일 한도와 작은 multipart 부가정보 범위까지만 읽는다.
async function multipart(req: NextRequest): Promise<FormData> {
  const type = req.headers.get("content-type") ?? "", maximum = VAT_FILING_DOCUMENT_MAX_BYTES + 256 * 1024;
  if (!/^multipart\/form-data\s*;/i.test(type) || !req.body) throw invalid("파일 첨부 형식의 요청이 필요합니다.");
  const declared = req.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw invalid("첨부 요청 크기가 허용 범위를 넘었습니다.");
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw invalid("첨부 요청 크기가 허용 범위를 넘었습니다."); }
      chunks.push(next.value);
    }
    return await new Response(Buffer.concat(chunks), { headers: { "Content-Type": type } }).formData();
  } catch (error) {
    if ((error as { status?: number }).status) throw error;
    throw invalid("파일 첨부 요청을 해석할 수 없습니다.");
  } finally { reader.releaseLock(); }
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission("finance.view");
    const subjectId = req.nextUrl.searchParams.get("subjectId") ?? "", documentId = req.nextUrl.searchParams.get("documentId");
    if (!subjectId) throw invalid("신고 주체를 선택하세요.");
    if (documentId !== null) {
      const document = await readVatFilingDocument(documentId, subjectId);
      const fileName = encodeURIComponent(document.fileName).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
      return new NextResponse(new Uint8Array(document.bytes), { headers: { ...headers, "Content-Type": document.contentType, "Content-Length": String(document.sizeBytes), "Content-Disposition": `attachment; filename="vat-document"; filename*=UTF-8''${fileName}` } });
    }
    return NextResponse.json({ documents: await listVatFilingDocuments(subjectId) }, { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission("finance.manage"), form = await multipart(req);
    if ([...form.keys()].some(k => !["subjectId", "requestId", "file"].includes(k)) || ["subjectId", "requestId", "file"].some(k => form.getAll(k).length !== 1)) throw invalid("주체·요청 식별자와 파일을 각각 하나씩 첨부하세요.");
    const subjectId = form.get("subjectId"), requestId = form.get("requestId"), file = form.get("file");
    if (typeof subjectId !== "string" || typeof requestId !== "string" || !(file instanceof File)) throw invalid("주체·요청 식별자와 증빙 파일이 필요합니다.");
    if (!file.size || file.size > VAT_FILING_DOCUMENT_MAX_BYTES) throw invalid("증빙 파일은 비어 있지 않은 10 MiB 이하 파일이어야 합니다.");
    const result = await uploadVatFilingDocument({ subjectId, requestId, fileName: file.name, contentType: file.type, bytes: Buffer.from(await file.arrayBuffer()) }, actor.userId);
    return NextResponse.json(result, { headers });
  } catch (error) { return errorResponse(error); }
}
