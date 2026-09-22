import { NextRequest, NextResponse } from 'next/server';
import { authErrorToResponse, requirePermission } from '@/lib/auth/guards';
import { inspectSupplyGroupEvidence, readSupplyGroupPage, readSupplyGroupEvidenceDiagnostics, registerSupplyGroupEvidence } from '@/lib/finance/supply-group-reviews';
import { groupConflictResponse } from '@/lib/finance/supply-group-diagnostics';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const invalid = () => Object.assign(new Error('PDF 원문 위치 요청을 확인하세요.'), { status: 400 });
function failure(error: unknown) {
  const status = (error as {status?:number})?.status;
  if (status === 409) return NextResponse.json(groupConflictResponse(error), { status, headers });
  return authErrorToResponse([400,401,403,404,503].includes(status ?? 0) ? error : Object.assign(new Error('PDF 원문을 확인할 수 없습니다.'), { status: 503 }));
}
export async function GET(req: NextRequest) {
  try {
    await requirePermission('finance.view'); const q = req.nextUrl.searchParams, keys = [...q.keys()];
    if (q.has('manifestId')) {
      if (keys.length !== 2 || new Set(keys).size !== 2 || keys.some(k => !['subjectId','manifestId'].includes(k))) throw invalid();
      return NextResponse.json(await readSupplyGroupEvidenceDiagnostics(q.get('subjectId')!, q.get('manifestId')!), { headers });
    }
    if (keys.length !== 3 || new Set(keys).size !== 3 || keys.some(k => !['subjectId','documentId','pageNumber'].includes(k)) || !/^[1-9]\d*$/.test(q.get('pageNumber') ?? '')) throw invalid();
    const result = await readSupplyGroupPage(q.get('subjectId')!, q.get('documentId')!, Number(q.get('pageNumber')));
    return new NextResponse(new Uint8Array(result.png), { headers: { ...headers, 'Content-Type': 'image/png', 'Content-Length': String(result.png.length) } });
  } catch (e) { return failure(e); }
}
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission('finance.manage'), reader = req.body?.getReader(); if (!reader) throw invalid();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const v = await reader.read(); if (v.done) break; size += v.value.length; if (size > 1024 * 1024) { await reader.cancel(); throw invalid(); } chunks.push(v.value); }
    let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw invalid(); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid();
    const { action, ...input } = body as Record<string, unknown>;
    if (action === 'inspect') return NextResponse.json(await inspectSupplyGroupEvidence(input), { headers });
    if (action === 'register') return NextResponse.json(await registerSupplyGroupEvidence(input, actor.userId), { headers });
    throw invalid();
  } catch (e) { return failure(e); }
}
