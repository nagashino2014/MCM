import { NextRequest, NextResponse } from 'next/server';
import { authErrorToResponse, requirePermission } from '@/lib/auth/guards';
import { applyJournalUse, listJournalUsePage, previewJournalUse, releaseJournalUse } from '@/lib/finance/journal-use';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function response(error: unknown) {
  const e = error as { status?: number; code?: string; message?: string };
  const status = [400, 403, 404, 409, 503].includes(e.status ?? 0) ? e.status! : 500;
  return NextResponse.json({ error: status === 500 ? '전표 사용 처리 중 오류가 발생했습니다.' : e.message, code: e.code ?? 'journal_use_error' }, { status, headers: { 'Cache-Control': 'no-store' } });
}
export async function GET(req: NextRequest) {
  try {
    await requirePermission('finance.view');
    const q = req.nextUrl.searchParams, keys = [...q.keys()];
    if (keys.some(key => !['vatUseId', 'subjectId', 'journalVatUseId'].includes(key))
      || q.getAll('vatUseId').length > 1 || q.getAll('subjectId').length > 1
      || (!!q.get('vatUseId') === !!q.get('subjectId'))
      || q.has('journalVatUseId') && (!q.get('subjectId') || q.getAll('journalVatUseId').length > 100)) throw Object.assign(new Error('조회 입력을 확인하세요.'), { status: 400, code: 'journal_use_input' });
    if (q.get('vatUseId')) return NextResponse.json(await previewJournalUse(q.get('vatUseId')), { headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json(await listJournalUsePage(q.get('subjectId'), q.getAll('journalVatUseId')), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if ([401, 403].includes((error as { status?: number }).status ?? 0)) return authErrorToResponse(error);
    return response(error);
  }
}
export async function POST(req: NextRequest) {
  try {
    const ctx = await requirePermission('finance.manage');
    let body: Record<string, unknown>;
    try { body = await req.json() as Record<string, unknown>; }
    catch { throw Object.assign(new Error('요청 본문을 확인하세요.'), { status: 400, code: 'journal_use_input' }); }
    if (body.action === 'apply') return NextResponse.json(await applyJournalUse(body, ctx.userId), { headers: { 'Cache-Control': 'no-store' } });
    if (body.action === 'release') return NextResponse.json(await releaseJournalUse(body, ctx.userId), { headers: { 'Cache-Control': 'no-store' } });
    throw Object.assign(new Error('처리 종류를 확인하세요.'), { status: 400, code: 'journal_use_input' });
  } catch (error) {
    if ([401, 403].includes((error as { status?: number }).status ?? 0)) return authErrorToResponse(error);
    return response(error);
  }
}
