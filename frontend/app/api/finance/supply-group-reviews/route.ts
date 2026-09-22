import { NextRequest, NextResponse } from 'next/server';
import { authErrorToResponse, requirePermission } from '@/lib/auth/guards';
import { listSupplyGroup, listSupplyGroupDocuments, previewSupplyGroup, verifySupplyGroup, withdrawSupplyGroup } from '@/lib/finance/supply-group-reviews';
import { groupConflictResponse } from '@/lib/finance/supply-group-diagnostics';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const invalid = () => Object.assign(new Error('전체 대응 검토 요청을 확인하세요.'), { status: 400 });
function failure(error: unknown, action?: string) {
  const status = (error as { status?: number })?.status;
  if (status === 409) return NextResponse.json(groupConflictResponse(error, action), { status, headers: { 'Cache-Control': 'no-store' } });
  return authErrorToResponse([400,401,403,404,503].includes(status ?? 0) ? error : Object.assign(new Error('전체 대응 검토를 처리할 수 없습니다.'), { status: 503 }));
}
export async function GET(req: NextRequest) {
  try {
    await requirePermission('finance.view'); const q = req.nextUrl.searchParams, names = [...q.keys()];
    const catalog = q.get('catalog') === 'documents';
    if (!q.has('subjectId') || new Set(names).size !== names.length || names.some(k => !(catalog ? ['subjectId','catalog','cursor'] : ['subjectId','caseId','cursor']).includes(k))) throw invalid();
    let canManage = false; try { await requirePermission('finance.manage'); canManage = true; } catch (e) { if ((e as {status?:number}).status !== 403) throw e; }
    const data = catalog ? await listSupplyGroupDocuments(q.get('subjectId')!, q.get('cursor') ?? undefined) : await listSupplyGroup(q.get('subjectId')!, q.get('caseId') ?? undefined, q.get('cursor') ?? undefined);
    return NextResponse.json({ ...data, canManage }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return failure(e); }
}
export async function POST(req: NextRequest) {
  let action: string | undefined;
  try {
    const actor = await requirePermission('finance.manage'), reader = req.body?.getReader(); if (!reader) throw invalid();
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const v = await reader.read(); if (v.done) break; size += v.value.length; if (size > 128 * 1024) { await reader.cancel(); throw invalid(); } chunks.push(v.value); }
    let body: unknown; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw invalid(); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid();
    const { action: value, ...input } = body as Record<string, unknown>;
    if (!['preview','verify','withdraw'].includes(String(value)) || typeof value !== 'string') throw invalid(); action = value;
    const result = action === 'preview' ? await previewSupplyGroup(input) : action === 'verify' ? await verifySupplyGroup(input, actor.userId) : await withdrawSupplyGroup(input, actor.userId);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return failure(e, action); }
}
