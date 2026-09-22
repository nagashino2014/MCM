import { NextRequest, NextResponse } from 'next/server';
import { authErrorToResponse, requirePermission } from '@/lib/auth/guards';
import { loadVatSameSupplyWorkspace, readVatSameSupplyExact, resolveVatSameSupplyCase } from '@/lib/finance/vat-same-supply-workspace';
import { sameSupplyErrorResponse } from '@/lib/finance/vat-same-supply-diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const invalid = () => Object.assign(new Error('조회 입력을 확인하세요.'), { status: 400, code: 'vat_same_supply_input' });
export async function GET(req: NextRequest) {
  try {
    await requirePermission('finance.view');
    const q = req.nextUrl.searchParams, names = [...q.keys()], view = q.get('view') ?? 'candidates';
    const allowed = view === 'candidates' ? ['view', 'basisSnapshotId', 'kind', 'cursor']
      : view === 'exact' ? ['view', 'subjectId', 'kind', 'caseId', 'revisionId']
        : view === 'resolve' ? ['view', 'subjectId', 'kind', 'portionIds'] : [];
    if (!allowed.length || new Set(names).size !== names.length || names.some(name => !allowed.includes(name))) throw invalid();
    let canManage = false;
    try { await requirePermission('finance.manage'); canManage = true; } catch (error) { if ((error as { status?: number }).status !== 403) throw error; }
    let data;
    if (view === 'exact') data = await readVatSameSupplyExact(q.get('subjectId')!, q.get('kind')!, q.get('caseId')!, q.get('revisionId')!);
    else if (view === 'resolve') {
      let portions: unknown; try { portions = JSON.parse(q.get('portionIds') ?? ''); } catch { throw invalid(); }
      data = await resolveVatSameSupplyCase(q.get('subjectId')!, q.get('kind')!, portions);
    } else data = await loadVatSameSupplyWorkspace(q.get('basisSnapshotId')!, q.get('kind')!, q.get('cursor') ?? undefined);
    return NextResponse.json({ ...data, canManage }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if ([401, 403].includes((error as { status?: number })?.status ?? 0)) return authErrorToResponse(error);
    const safe = sameSupplyErrorResponse(error);
    return NextResponse.json(safe.body, { status: safe.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
