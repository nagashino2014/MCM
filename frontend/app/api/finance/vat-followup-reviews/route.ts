import { NextRequest, NextResponse } from 'next/server';
import { authErrorToResponse, requirePermission } from '@/lib/auth/guards';
import { previewVatFollowupReview, saveVatFollowupReview, withdrawVatFollowupReview } from '@/lib/finance/vat-followup-review';
import { getVatFollowupWorkspace, readVatFollowupJson, vatFollowupDisplayPayload } from '@/lib/finance/vat-followup-workspace';
import { normalizeVatFollowupApplication } from '@/lib/finance/vat-followup-review-pure';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const invalid = (message: string) => Object.assign(new Error(message), { status: 400, code: 'vat_followup_workspace_input' });
function errorResponse(error: unknown) {
  const e = error as { status?: number; message?: string; code?: unknown; issues?: unknown[] };
  if ([400, 404, 409, 503].includes(e.status ?? 0)) {
    const issues = Array.isArray(e.issues) ? e.issues.map(i => {
      const v = i && typeof i === 'object' ? i as Record<string, unknown> : {};
      return Object.fromEntries(['code', 'message', 'reason', 'sourceId', 'pairKey'].filter(k => typeof v[k] === 'string').map(k => [k, v[k]]));
    }) : [];
    return NextResponse.json({ error: e.message, ...(typeof e.code === 'string' ? { code: e.code } : {}), issues }, { status: e.status, headers });
  }
  return authErrorToResponse(error);
}
async function permissions() {
  try { await requirePermission('finance.manage'); return { manage: true }; }
  catch (e) { if ((e as { status?: number }).status === 403) return { manage: false }; throw e; }
}
export async function GET(req: NextRequest) {
  try {
    await requirePermission('finance.view');
    const sp = req.nextUrl.searchParams;
    if ([...sp.keys()].some(k => !['view', 'subjectId', 'year', 'term', 'kind', 'path', 'basisSnapshotId', 'page', 'recordPage', 'pageSize', 'recordPageSize'].includes(k)) || sp.has('view') && sp.get('view') !== 'workspace') throw invalid('지원하지 않는 검토 조회 항목입니다.');
    if (sp.has('pageSize') && sp.get('pageSize') !== '50' || sp.has('recordPageSize') && sp.get('recordPageSize') !== '10') throw invalid('후보는 50쌍, 기록은 10판씩 조회합니다.');
    const hasScope = ['subjectId', 'year', 'term', 'kind', 'path', 'basisSnapshotId'].some(k => sp.has(k));
    const application = hasScope ? normalizeVatFollowupApplication({ subjectId: sp.get('subjectId'), year: Number(sp.get('year')), term: Number(sp.get('term')), kind: sp.get('kind') ?? 'final', path: sp.get('path'), basisSnapshotId: sp.get('basisSnapshotId') }) : undefined;
    return NextResponse.json({ ...await getVatFollowupWorkspace(application, Number(sp.get('page') ?? 1), Number(sp.get('recordPage') ?? 1)), permissions: await permissions() }, { headers });
  } catch (e) { return errorResponse(e); }
}
export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission('finance.manage');
    const { action, ...input } = await readVatFollowupJson(req);
    let result;
    if (action === 'preview') { const preview = await previewVatFollowupReview(input as unknown as Parameters<typeof previewVatFollowupReview>[0]); result = { ...preview, payload: vatFollowupDisplayPayload(preview.payload) }; }
    else if (action === 'save') result = await saveVatFollowupReview(input as unknown as Parameters<typeof saveVatFollowupReview>[0], actor.userId);
    else if (action === 'withdraw') result = await withdrawVatFollowupReview(input as unknown as Parameters<typeof withdrawVatFollowupReview>[0], actor.userId);
    else throw invalid('지원하지 않는 후행 검토 작업입니다.');
    // 원래 C-a 저장 응답/요청 재생 원문은 보존하고, 현재 화면 연결 상태를 별도로 알린다.
    return NextResponse.json({ ...result, integrationMode: 'explicit_selection' }, { headers });
  } catch (e) { return errorResponse(e); }
}
