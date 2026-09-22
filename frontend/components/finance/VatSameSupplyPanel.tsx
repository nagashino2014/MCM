"use client";

import { useEffect, useRef, useState } from 'react';
import { CdHelp } from '@/components/cdash/CdHelp';
import type { VatSameSupplyCalculation, VatSameSupplySelection } from '@/lib/finance/vat-same-supply-types';
import type { VatSameReviewKind, VatSameSupplyCandidate, VatSameSupplyExact, VatSameSupplyWorkspace } from '@/lib/finance/vat-same-supply-workspace-types';
import type { SupplySameRecord } from '@/lib/finance/supply-same-types';
import type { SupplyGroupRecord, SupplyGroupEvidenceDiagnostics } from '@/lib/finance/supply-group-types';
import type { JournalUseListItem, JournalUsePreview } from '@/lib/finance/journal-use-types';

const API = '/api/finance/vat-same-supply';
const won = (value: number) => Number.isSafeInteger(value) ? `${value.toLocaleString('ko-KR')}원` : '확인 필요';
const key = (row: { kind: string; caseId: string; revisionId: string }) => `${row.kind}:${row.caseId}:${row.revisionId}`;
type Basis = { basisSnapshotId: string; subjectId: string; scopeHash: string; kind: 'pre' | 'final' };
type Archive = { returnId: string; status: string; origin: 'legacy' | 'basis_return' };
type Workspace = VatSameSupplyWorkspace & { canManage: boolean };
type Exact = VatSameSupplyExact & { evidence?: { documentId: string; manifestId: string | null } };
async function read<T>(params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API}?${new URLSearchParams(params)}`, { cache: 'no-store', signal });
  const value = await response.json();
  if (!response.ok) throw new Error(response.status === 503 ? '보관 근거를 확인할 수 없습니다. 원문과 적용 구조를 확인한 뒤 다시 조회하세요.' : response.status === 403 ? '이 자료를 조회할 권한이 없습니다.' : value.error ?? '같은 공급 자료를 읽지 못했습니다.');
  return value;
}
export function VatSameSupplyPanel({ basis, selection, onSelectionChange, calculation, archive, canManage, locked, onOpenReturn }: {
  basis: Basis | null; selection: VatSameSupplySelection | null; onSelectionChange: (value: VatSameSupplySelection | null) => void;
  calculation?: VatSameSupplyCalculation; archive: Archive | null; canManage: boolean; locked: boolean; onOpenReturn: (returnId: string) => void;
}) {
  const [kind, setKind] = useState<VatSameReviewKind>('same'), [rows, setRows] = useState<VatSameSupplyCandidate[]>([]);
  const [cursor, setCursor] = useState<string | null>(null), [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null), [manage, setManage] = useState(false);
  const [exact, setExact] = useState<Exact | null>(null), [evidence, setEvidence] = useState<SupplyGroupEvidenceDiagnostics | null>(null);
  const [journalUses, setJournalUses] = useState<JournalUseListItem[]>([]), [journalPreview, setJournalPreview] = useState<JournalUsePreview | null>(null);
  const [journalBusy, setJournalBusy] = useState(false);
  const [refresh, setRefresh] = useState(0); const epoch = useRef(0), detailsEpoch = useRef(0);
  const context = archive ? `archive:${archive.returnId}` : `basis:${basis?.basisSnapshotId ?? ''}:${basis?.scopeHash ?? ''}`;
  const currentContext = useRef(context); currentContext.current = context;
  const enabled = !archive && basis?.kind === 'final';
  const validateWorkspace = (value: Workspace): Workspace => {
    if (!value || !basis || value.basis?.basisSnapshotId !== basis.basisSnapshotId || value.basis.subjectId !== basis.subjectId || value.basis.scopeHash !== basis.scopeHash || value.kind !== kind || !Array.isArray(value.records)
      || typeof value.hasMore !== 'boolean' || value.hasMore !== (typeof value.nextCursor === 'string' && value.nextCursor.length > 0) || !value.hasMore && value.nextCursor !== null) throw Error('조회한 검토 목록과 신고 근거가 일치하지 않습니다.');
    return value;
  };
  useEffect(() => {
    const sequence = ++epoch.current, controller = new AbortController(); detailsEpoch.current++; setExact(null); setEvidence(null); setJournalUses([]); setJournalPreview(null);
    setRows([]); setCursor(null); setHasMore(false); setError(null); setManage(false);
    if (!enabled || !basis) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    void read<Workspace>({ basisSnapshotId: basis.basisSnapshotId, kind }, controller.signal).then(validateWorkspace).then(value => {
      if (sequence !== epoch.current || controller.signal.aborted) return;
      setRows(value.records); setCursor(value.nextCursor); setHasMore(value.hasMore); setManage(value.canManage === true);
    }).catch(cause => { if (!controller.signal.aborted && sequence === epoch.current) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (!controller.signal.aborted && sequence === epoch.current) setLoading(false); });
    return () => { controller.abort(); detailsEpoch.current++; };
  // The complete immutable basis key is the read boundary; changing selection does not refetch a page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, kind, refresh]);
  const more = async () => {
    if (!cursor || !basis || loading || locked) return; const sequence = epoch.current; setLoading(true); setError(null);
    try {
      const value = validateWorkspace(await read<Workspace>({ basisSnapshotId: basis.basisSnapshotId, kind, cursor }));
      if (sequence !== epoch.current) return;
      setRows(old => [...old, ...value.records.filter(row => !old.some(item => item.caseId === row.caseId))]); setCursor(value.nextCursor); setHasMore(value.hasMore);
    } catch (cause) { if (sequence === epoch.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (sequence === epoch.current) setLoading(false); }
  };
  const toggle = (row: VatSameSupplyCandidate, checked: boolean) => {
    if (!basis || !enabled || !canManage || !manage || locked || loading || !row.canSelectForCalculation) return;
    const old = selection?.subjectId === basis.subjectId ? selection.reviews : [];
    const reviews = checked ? [...old.filter(item => !(item.kind === row.kind && item.caseId === row.caseId)), { kind: row.kind, caseId: row.caseId, revisionId: row.revisionId }] : old.filter(item => key(item) !== key(row));
    if (reviews.length > 100) { setError('한 신고서에는 확인판 100개까지 선택할 수 있습니다.'); return; }
    onSelectionChange(reviews.length ? { version: 'vat-same-supply-selection-v1', subjectId: basis.subjectId, reviews } : null);
  };
  const openExact = async (row: { kind: VatSameReviewKind; caseId: string; revisionId: string }) => {
    const subjectId = calculation?.plan.subjectId ?? basis?.subjectId;
    if (!subjectId || locked) return; const captured = currentContext.current, sequence = ++detailsEpoch.current; setError(null); setExact(null); setEvidence(null); setJournalPreview(null);
    try {
      const value = await read<Exact>({ view: 'exact', subjectId, kind: row.kind, caseId: row.caseId, revisionId: row.revisionId });
      if (value.kind !== row.kind || value.record?.revisionId !== row.revisionId || value.record.caseId !== row.caseId || value.record.draft.subjectId !== subjectId || value.record.financialUseSupported !== false || !Array.isArray(value.uses)) throw Error('요청한 당시 확인판과 조회 결과가 일치하지 않습니다.');
      if (captured !== currentContext.current || sequence !== detailsEpoch.current) return;
      const journalParams = new URLSearchParams({ subjectId });
      value.uses.forEach(use => journalParams.append('journalVatUseId', use.useId));
      const journalResponse = value.uses.length
        ? await fetch(`/api/finance/journal-use?${journalParams}`, { cache: 'no-store' })
        : null;
      const journalValue = journalResponse ? await journalResponse.json() : { uses: [] };
      if ((journalResponse && !journalResponse.ok) || !Array.isArray(journalValue.uses)) throw Error(journalResponse?.status === 503 ? '전표 사용 근거를 확인할 수 없습니다. 잠시 후 다시 조회하거나 담당자에게 문의하세요.' : journalValue.error ?? '전표 사용 상태를 읽지 못했습니다.');
      let nextEvidence: SupplyGroupEvidenceDiagnostics | null = null;
      if (row.kind === 'group') {
        const manifestId = (value.record as SupplyGroupRecord).draft.evidenceManifestId;
        const response = await fetch(`/api/finance/supply-group-evidence?${new URLSearchParams({ subjectId, manifestId })}`, { cache: 'no-store' });
        const diagnostic = await response.json();
        if (!response.ok || diagnostic.manifestId !== manifestId || !Number.isSafeInteger(diagnostic.noTextDetailCount)) throw Error('보관된 원문 위치의 안내를 확인할 수 없습니다.');
        nextEvidence = diagnostic;
      }
      if (captured === currentContext.current && sequence === detailsEpoch.current) { setExact(value); setJournalUses(journalValue.uses); setEvidence(nextEvidence); }
    } catch (cause) { if (captured === currentContext.current && sequence === detailsEpoch.current) { setExact(null); setEvidence(null); setJournalUses([]); setJournalPreview(null); setError(cause instanceof Error ? cause.message : String(cause)); } }
  };
  const downloadExact = () => {
    if (!exact) return;
    const blob = new Blob([JSON.stringify(exact, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = '같은공급_사용당시확인판.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const previewJournal = async (vatUseId: string) => {
    if (locked || journalBusy) return; setJournalBusy(true); setError(null); setJournalPreview(null);
    try {
      const response = await fetch(`/api/finance/journal-use?${new URLSearchParams({ vatUseId })}`, { cache: 'no-store' }), value = await response.json();
      if (!response.ok) throw Error(value.error ?? '전표 사용 미리보기를 만들지 못했습니다.');
      setJournalPreview(value);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setJournalBusy(false); }
  };
  const applyJournal = async () => {
    if (!journalPreview || locked || journalBusy) return; setJournalBusy(true); setError(null);
    try {
      const response = await fetch('/api/finance/journal-use', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'apply', vatUseId: journalPreview.plan.vatUseId, expectedPlanHash: journalPreview.plan.planHash, requestId: crypto.randomUUID() }) }), value = await response.json();
      if (!response.ok) throw Error(value.error ?? '전표 사용을 적용하지 못했습니다.');
      setJournalPreview(null); if (exact) await openExact({ kind: exact.kind, caseId: exact.record.caseId, revisionId: exact.record.revisionId });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setJournalBusy(false); }
  };
  const releaseJournal = async (journalUseId: string) => {
    if (locked || journalBusy) return; const reason = window.prompt('전표 사용 해제 사유를 5자 이상 입력하세요.'); if (!reason) return;
    setJournalBusy(true); setError(null);
    try {
      const response = await fetch('/api/finance/journal-use', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'release', journalUseId, reason, requestId: crypto.randomUUID() }) }), value = await response.json();
      if (!response.ok) throw Error(value.error ?? '전표 사용을 해제하지 못했습니다.');
      if (exact) await openExact({ kind: exact.kind, caseId: exact.record.caseId, revisionId: exact.record.revisionId });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setJournalBusy(false); }
  };
  const selected = selection?.reviews ?? [];
  const stored = calculation?.plan.selections ?? [];
  const canManageJournal = canManage && (archive !== null || manage);
  const documentId = exact?.evidence?.documentId ?? (exact?.kind === 'same' ? (exact.record as SupplySameRecord).draft.evidence.documentId : null);
  return <section className="cd-card p-4 space-y-3" aria-label="같은 공급 중복 공제 조정">
    <div className="flex items-center gap-2"><h3 className="text-base font-semibold cd-text">같은 공급 중복 공제 조정</h3><CdHelp label="같은 공급 공제 조정 도움말"><p>같은 공급으로 확인한 계산서와 카드 중 계산서의 공제를 남기고 카드의 중복 공제만 제외합니다. 공제 여부와 신고 귀속은 별도로 검증합니다.</p><p className="mt-2">과거의 실제 별개 공급을 확인하는 후행 검토와 다른 기능입니다. 전표·지급일·비용 인식은 변경하지 않습니다.</p></CdHelp></div>
    <p className="text-sm cd-text-muted">계산서 한 장과 카드 전체의 1:1 또는 1:N 대응 · 전표 미적용</p>
    {error && <p role="alert" className="text-sm cd-error-text">{error}</p>}
    {enabled ? <>
      <div className="flex flex-wrap gap-2">{(['same', 'group'] as const).map(item => <button type="button" key={item} className="cd-btn cd-btn-sm" aria-pressed={kind === item} disabled={locked || loading} onClick={() => setKind(item)}>{item === 'same' ? '두 문서 전체' : '여러 문서 전체'}</button>)}<button type="button" className="cd-btn cd-btn-sm" disabled={locked || loading} onClick={() => setRefresh(value => value + 1)}>검토 목록 새로 읽기</button></div>
      <p className="text-sm cd-text">관계 확인판 {selected.length}개 선택. 실제 사용 가능 여부와 금액은 신고 계산에서 다시 대조합니다.</p>
      {!canManage && <p className="text-sm cd-text-muted">조회 권한입니다. 선택 변경과 신고서 저장은 관리 담당자가 진행합니다.</p>}
      {rows.length > 0 ? <div className="overflow-x-auto"><table className="cd-table w-full text-sm"><thead><tr><th>선택</th><th>확인 내용</th><th>문서</th><th>판</th><th>근거</th></tr></thead><tbody>{rows.map(row => <tr key={key(row)} className="h-11"><td className="p-3"><input type="checkbox" aria-label={`${row.kind === 'same' ? '두 문서' : '전체 대응'} ${row.version}판 선택: ${row.reason}`} checked={selected.some(item => key(item) === key(row))} disabled={locked || loading || !canManage || !manage || !row.canSelectForCalculation} onChange={event => toggle(row, event.target.checked)} /></td><td className="p-3 min-w-[160px]"><p className="break-words">{row.reason}</p>{row.state === 'withdrawn' && <span className="cd-text-muted">철회된 확인판</span>}</td><td className="p-3 min-w-[180px]">{row.documents.map((doc, index) => <p key={index}>{doc.label} · {doc.date} · 세액 {won(doc.tax)}</p>)}</td><td className="p-3 whitespace-nowrap">{row.version}판</td><td className="p-3"><button type="button" className="cd-btn cd-btn-sm whitespace-nowrap" disabled={locked} onClick={() => void openExact(row)}>당시 근거 보기</button></td></tr>)}</tbody></table></div> : !loading && !error && <p className="text-sm cd-text-muted">이 종류의 확인 기록이 없습니다. 공급 근거 기록에서 먼저 관계를 확인하세요.</p>}
      {hasMore && <button type="button" className="cd-btn cd-btn-sm" disabled={locked || loading} onClick={() => void more()}>이전 확인 관계 더 보기</button>}
      {!!selected.length && <div className="space-y-2"><p className="text-sm cd-text">선택한 정확한 판</p>{selected.map(row => <div key={key(row)} className="flex flex-wrap items-center gap-2 text-sm"><span>{row.kind === 'same' ? '두 문서 관계' : '전체 대응 관계'}</span><button type="button" className="cd-btn cd-btn-sm" disabled={locked} onClick={() => void openExact(row)}>선택한 판 보기</button><button type="button" className="cd-btn cd-btn-sm" disabled={locked || !canManage} onClick={() => { const reviews = selected.filter(item => key(item) !== key(row)); onSelectionChange(reviews.length ? { ...selection!, reviews } : null); }}>선택 해제</button></div>)}</div>}
    </> : !calculation && <p className="text-sm cd-text-muted">{archive ? '이 저장본에는 같은 공급 공제 조정 선택이 없습니다. 새 선택을 과거 저장본에 덧붙이지 않습니다.' : '봉인 근거가 있는 확정신고를 선택하면 같은 공급 확인판을 사용할 수 있습니다. 예정신고는 이 기능의 지원 범위가 아닙니다.'}</p>}
    {calculation && <section className="space-y-2 rounded-lg border cd-border-c p-3" aria-label="같은 공급 공제 적용 내역"><h4 className="text-sm font-semibold cd-text">{archive?.status === 'confirmed' ? '이 확정 신고서에서 사용한 근거' : archive ? '저장 당시 선택 · 아직 실제 사용 아님' : '현재 계산 미리보기 · 아직 실제 사용 아님'}</h4><div className="overflow-x-auto"><table className="cd-table w-full min-w-[640px] text-sm"><thead><tr><th>원천</th><th>귀속일</th><th className="text-right">원 세액</th><th className="text-right">신고 공제</th><th className="text-right">중복 제외</th></tr></thead><tbody>{calculation.claimEffects.map(effect => { const source = calculation.rawClaims.find(row => row.sourceId === effect.sourceId && row.kind === (effect.sourceType === 'card' ? 'card' : 'hometax')); return <tr key={`${effect.sourceType}:${effect.sourceId}`} className="h-11"><td className="p-3 min-w-[160px]">{effect.sourceType === 'card' ? '카드' : '대표 계산서'}{source?.partyName ? ` · ${source.partyName}` : ''}</td><td className="p-3 whitespace-nowrap">{effect.taxDate}</td><td className="p-3 text-right whitespace-nowrap tabular-nums">{won(effect.rawTaxAmount)}</td><td className="p-3 text-right whitespace-nowrap tabular-nums">{won(effect.claimedTaxAmount)}</td><td className="p-3 text-right whitespace-nowrap tabular-nums">{won(effect.suppressedTaxAmount)}</td></tr>; })}</tbody></table></div><div className="flex flex-wrap gap-2">{stored.map(row => <button type="button" key={key(row)} className="cd-btn cd-btn-sm" disabled={locked} onClick={() => void openExact(row)}>{row.kind === 'same' ? '두 문서' : '전체 대응'} {row.version}판 사용 근거 보기</button>)}</div><p className="text-sm cd-text-muted">부가세 공제 조정만 표시합니다. 전표·지급 배부에는 적용하지 않았고 원문 금액도 바꾸지 않았습니다.</p></section>}
    {exact && <section className="rounded-lg border cd-border-c p-3 space-y-2" aria-label="사용 당시 정확한 확인판"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold cd-text">{exact.kind === 'same' ? '두 문서' : '전체 대응'} · {exact.record.version}판</h4><button type="button" className="cd-btn cd-btn-sm" onClick={downloadExact}>당시 확인판 내려받기</button></div><p className="text-sm cd-text">{exact.record.draft.reason}</p><p className="text-sm cd-text-muted">저장 당시의 확인판입니다. 현재 원천을 다시 진단한 결과나 최신 편집판으로 바꾸지 않았습니다.</p>{documentId && <a className="cd-action cd-btn cd-btn-sm inline-flex" href={`/api/finance/vat-filing-documents?${new URLSearchParams({ subjectId: exact.record.draft.subjectId, documentId })}`} target="_blank" rel="noreferrer">보관 원문 열기</a>}{evidence && evidence.noTextDetailCount > 0 && <aside className="text-sm cd-text rounded-lg border cd-border-c p-3" aria-label="원문 글자 추출 안내">세부 영역 {evidence.noTextDetailCount}곳에서 글자를 추출하지 못했습니다. 스캔본의 검토를 차단하지 않습니다. 보관 원문과 담당자의 확인 내용을 함께 살펴보세요.</aside>}{exact.uses.length ? exact.uses.map(use => { const journal = journalUses.find(row => row.vatUseId === use.useId); return <div className="text-sm cd-text space-y-2 rounded-lg border cd-border-c p-2" key={use.useId}><p>확정 신고서에서 사용됨 · {journal?.status === 'applied' ? '확정 카드 전표에 적용됨' : journal?.status === 'stale' ? '원천 변경으로 재검토 필요' : journal?.status === 'released' ? '전표 사용 해제됨' : '전표 미적용'}</p>{journal?.status === 'stale' && <p role="alert" className="cd-error-text">{journal.diagnosticMessage ?? '저장 뒤 원천 또는 전표가 변경되었습니다. 마감 전 사용을 해제하고 다시 검토하세요.'}</p>}<div className="flex flex-wrap gap-2"><button type="button" className="cd-btn cd-btn-sm" disabled={locked} onClick={() => onOpenReturn(use.returnId)}>사용한 신고서 열기</button>{!journal && canManageJournal && <button type="button" className="cd-btn cd-btn-sm" disabled={locked || journalBusy} onClick={() => void previewJournal(use.useId)}>전표 적용 미리보기</button>}{(journal?.status === 'applied' || journal?.status === 'stale') && canManageJournal && <button type="button" className="cd-btn cd-btn-sm" disabled={locked || journalBusy} onClick={() => void releaseJournal(journal.journalUseId)}>{journal.status === 'stale' ? '변경된 전표 사용 해제' : '전표 사용 해제'}</button>}</div>{journalPreview?.plan.vatUseId === use.useId && <div className="space-y-2"><p>확정 전표 {journalPreview.totals.entries}건 · 공급가액 {won(journalPreview.totals.supply)} · 매입세액 {won(journalPreview.totals.tax)}</p><p className="cd-text-muted">새 분개를 만들지 않고 표시된 카드 전표를 대표 계산서의 회계 근거로 결속합니다.</p><button type="button" className="cd-btn cd-btn-sm" disabled={journalBusy} onClick={() => void applyJournal()}>확인한 전표로 적용</button></div>}</div>; }) : <p className="text-sm cd-text-muted">이 판의 확정 신고 사용 내역이 없습니다. 계산이나 초안 선택은 실제 사용이 아닙니다.</p>}</section>}
  </section>;
}
