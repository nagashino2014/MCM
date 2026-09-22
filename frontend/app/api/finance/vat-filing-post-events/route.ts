import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, authErrorToResponse } from '@/lib/auth/guards';
import {
  getVatFilingPostOverview,
  previewVatFilingPostEvent,
  saveVatFilingPostEvent,
} from '@/lib/finance/vat-filing-post';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

function errorResponse(error: unknown) {
  const e = error as { status?: number; message?: string; code?: string; issues?: unknown[] };
  if ([400, 409, 503].includes(e.status ?? 0)) {
    return NextResponse.json({ error: e.message, code: e.code, issues: e.issues }, { status: e.status, headers });
  }
  return authErrorToResponse(error);
}

async function readInput(req: NextRequest) {
  // 원문은 기존 문서 업로드로 저장하고 여기에는 문서 식별자와 검토 내용만 받는다.
  const maximum = 256 * 1024;
  const invalid = (message: string) => Object.assign(new Error(message), { status: 400 });
  const declared = req.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) {
    throw invalid('접수·납부 기록은 256KiB 이하로 나누어 입력하세요.');
  }
  if (!req.body) throw invalid('입력 JSON이 필요합니다.');
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw invalid('접수·납부 기록은 256KiB 이하로 나누어 입력하세요.');
      }
      chunks.push(next.value);
    }
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value;
    } catch {
      throw invalid('입력 JSON 형식이 올바르지 않습니다.');
    }
  } finally {
    reader.releaseLock();
  }
}

export async function GET(req: NextRequest) {
  try {
    await requirePermission('finance.view');
    const subjectId = req.nextUrl.searchParams.get('subjectId') ?? undefined;
    let manage = false;
    try { await requirePermission('finance.manage'); manage = true; }
    catch (error) { if ((error as { status?: number }).status !== 403) throw error; }
    return NextResponse.json({ ...await getVatFilingPostOverview(subjectId), permissions: { manage } }, { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requirePermission('finance.manage');
    const { action, ...input } = await readInput(req);
    if (action === 'preview') return NextResponse.json(await previewVatFilingPostEvent(input as Parameters<typeof previewVatFilingPostEvent>[0]), { headers });
    if (action === 'save') return NextResponse.json(await saveVatFilingPostEvent(input as Parameters<typeof saveVatFilingPostEvent>[0], actor.userId), { headers });
    throw Object.assign(new Error('지원하지 않는 접수·납부 작업입니다.'), { status: 400 });
  } catch (error) { return errorResponse(error); }
}
