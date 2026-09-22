"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, FileCheck2, History, RefreshCw } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";

export type MerchantStatus = "original" | "corrected" | "review_required";
export interface MerchantCorrectionSummary {
  originalCorpNum: string | null;
  effectiveCorpNum: string | null;
  status: MerchantStatus;
}
interface CorrectionView {
  cardTxnId: string;
  originalCorpNum: string | null;
  effectiveCorpNum: string | null;
  merchantStatus: MerchantStatus;
  version: number;
  sourceHash: string;
  active: boolean;
  permissions: { manage: boolean };
  history: Array<{ eventId: string; version: number; action: "correct" | "withdraw"; corpNum: string | null; reason: string; evidence: string; actorUserId: string; createdAt: string }>;
  impact: {
    canApply: boolean;
    blockers: Array<{ code: string; message: string; sourceId?: string }>;
    affectedCardIds: string[];
    journalEntries: Array<{ entryId: string; sourceKind: string; sourceId: string; date: string; status: string }>;
    vatReturns: Array<{ returnId: string; from: string; to: string; status: string; origin?: "legacy_return" | "external_filing" | "basis_snapshot" }>;
    closedYears: number[];
    reviewRequiredIds: string[];
  };
}

const ENDPOINT = "/api/finance/card-merchant-corrections";
const displayNumber = (value: string | null) => {
  if (!value) return "번호 없음";
  return /^\d{10}$/.test(value) ? `${value.slice(0, 3)}-${value.slice(3, 5)}-${value.slice(5)}` : value;
};
const statusText = (status: MerchantStatus) => status === "corrected" ? "정정" : status === "original" ? "원본" : "재검토";
const documentStatuses: Record<string, string> = { confirmed: "확정", pending: "확정 대기", draft: "초안", closed: "마감", cancelled: "취소" };
const documentStatus = (value: string) => documentStatuses[value] ?? value;
const vatProtectionLabel = (row: CorrectionView["impact"]["vatReturns"][number]) => {
  if (row.origin === "basis_snapshot") return "신고 근거 보관";
  if (row.origin === "external_filing") return "외부 신고 접수 확인";
  if (row.origin && row.origin !== "legacy_return") return "자료 종류 확인 필요";
  return row.status === "confirmed" ? "신고서 내부 확정" : row.status === "draft" ? "신고서 초안" : `신고서 ${documentStatus(row.status)}`;
};

export function CardMerchantCorrectionPanel({ cardTxnId, storeName, onClose, onSaved }: {
  cardTxnId: string; storeName: string | null; onClose: () => void; onSaved: () => void;
}) {
  const [data, setData] = useState<CorrectionView | null>(null);
  const [action, setAction] = useState<"correct" | "withdraw">("correct");
  const [corpNum, setCorpNum] = useState("");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  // An uncertain network response may already have committed. Keep the same
  // request id for an identical retry; a changed payload receives a new id.
  const pendingRequest = useRef<{ payload: string; requestId: string } | null>(null);

  const load = useCallback(async (resetInput = false, keepNotice = false) => {
    const current = ++sequence.current;
    controller.current?.abort();
    const nextController = new AbortController(); controller.current = nextController;
    setLoading(true); setData(null); setReviewConfirmed(false); setError(null);
    if (!keepNotice) setNotice(null);
    try {
      const res = await fetch(`${ENDPOINT}?${new URLSearchParams({ cardTxnId })}`, { cache: "no-store", signal: nextController.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? body.message ?? "사업자번호 정정 영향을 불러오지 못했습니다.");
      if (body.cardTxnId !== cardTxnId || !Number.isSafeInteger(body.version) || body.version < 0 || typeof body.sourceHash !== "string" || !body.sourceHash || !body.impact || typeof body.impact.canApply !== "boolean" || ![body.impact.blockers, body.impact.affectedCardIds, body.impact.journalEntries, body.impact.vatReturns, body.impact.closedYears, body.impact.reviewRequiredIds, body.history].every(Array.isArray)) throw new Error("정정 근거를 확인할 수 없습니다. 영향을 다시 조회하세요.");
      if (current !== sequence.current) return;
      setData(body as CorrectionView); setNeedsReload(false);
      if (resetInput) setCorpNum(body.effectiveCorpNum ?? "");
      if (!body.active) setAction("correct");
    } catch (err) {
      if (current !== sequence.current || nextController.signal.aborted) return;
      setNeedsReload(true); setError(err instanceof Error ? err.message : String(err));
    } finally { if (current === sequence.current) setLoading(false); }
  }, [cardTxnId]);

  useEffect(() => {
    void load(true);
    return () => { sequence.current++; controller.current?.abort(); };
  }, [load]);

  const canManage = data?.permissions?.manage === true;
  const normalizedNumber = corpNum.trim().replaceAll("-", "");
  const validNumber = /^(?:\d{10}|\d{3}-\d{2}-\d{5})$/.test(corpNum.trim()) && normalizedNumber !== "0000000000";
  const currentNumber = data?.effectiveCorpNum ?? "";
  const sameNumber = !!data && !!normalizedNumber && data.merchantStatus !== "review_required" && /^[\d\s-]+$/.test(currentNumber) && normalizedNumber === currentNumber.replace(/[\s-]/g, "");
  const validReason = reason.trim().length >= 1 && reason.trim().length <= 2000;
  const validEvidence = evidence.trim().length >= 1 && evidence.trim().length <= 1000;
  const validAction = action === "withdraw" ? !!data?.active : validNumber && !sameNumber;
  const canSubmit = canManage && !!data?.impact.canApply && data.impact.blockers.length === 0 && !loading && !busy && !needsReload && validAction && validReason && validEvidence && reviewConfirmed;
  const fieldDisabled = !canManage || loading || busy;

  const submit = async () => {
    if (!data || !canSubmit || inFlight.current) return;
    const payload = { action, cardTxnId, ...(action === "correct" ? { corpNum: normalizedNumber } : {}), reason: reason.trim(), evidence: evidence.trim(), reviewConfirmed: true, expectedVersion: data.version, expectedSourceHash: data.sourceHash };
    const serialized = JSON.stringify(payload);
    if (pendingRequest.current?.payload !== serialized) pendingRequest.current = { payload: serialized, requestId: globalThis.crypto.randomUUID() };
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestId: pendingRequest.current.requestId }) });
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 409 || res.status === 503) { setNeedsReload(true); setReviewConfirmed(false); }
        if (res.status === 403) { setData(previous => previous ? { ...previous, permissions: { manage: false } } : null); setReviewConfirmed(false); }
        throw new Error(body.error ?? body.message ?? `정정 요청을 처리하지 못했습니다. (${res.status})`);
      }
      if (body.status !== "applied" && body.status !== "already_applied") throw new Error("처리 결과를 확인할 수 없습니다. 같은 요청을 다시 확인하세요.");
      pendingRequest.current = null; setReason(""); setEvidence(""); setReviewConfirmed(false);
      setNotice(action === "withdraw" ? "정정을 철회했습니다. 수집 원본 번호와 관련 재검토 항목을 확인하세요." : "정정 근거를 저장했습니다. 관련 전표와 부가세 공제 검토를 다시 확인하세요.");
      onSaved();
      await load(true, true);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { inFlight.current = false; setBusy(false); }
  };

  const close = () => { if (!inFlight.current) onClose(); };
  const changeAction = (next: "correct" | "withdraw") => { setAction(next); setReviewConfirmed(false); setNotice(null); };

  return <CdModal open onClose={close} closeOnBackdrop={false} size="xl" title="가맹점 사업자번호 정정"
    footer={<><button type="button" className="cd-btn cd-btn-ghost" disabled={busy} onClick={close}>닫기</button><button type="button" className="cd-btn cd-btn-primary" style={{ background: "var(--cd-primary)", color: "var(--cd-card-solid)", boxShadow: "none" }} disabled={!canSubmit} onClick={() => void submit()}><FileCheck2 className="w-4 h-4" />{busy ? "처리 중…" : action === "withdraw" ? "정정 철회" : "정정 적용"}</button></>}>
    <div className="space-y-5" aria-busy={loading || busy}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="font-semibold cd-text">{storeName || "가맹점명 없음"}</p><p className="text-xs cd-text-muted mt-1">수집 원본은 보존됩니다. 증빙을 확인한 이 거래의 사업자번호만 정정합니다.</p></div>
        <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={loading || busy} onClick={() => void load()}><RefreshCw className="w-4 h-4" />{loading ? "영향 조회 중…" : "영향 다시 조회"}</button>
      </header>
      {error && <div role="alert" className="rounded-xl p-3 text-sm" style={{ color: "var(--cd-error)", background: "var(--cd-error-soft)" }}>{error}</div>}
      {notice && <p role="status" className="rounded-xl p-3 text-sm" style={{ color: "var(--cd-primary)", background: "var(--cd-primary-soft)" }}>{notice}</p>}
      {needsReload && <p className="text-sm cd-text-muted">현재 원천과 정정 이력을 다시 조회한 후 영향을 확인하고 검토 확인을 새로 선택하세요.</p>}
      {loading && <p role="status" className="text-sm cd-text-muted">원본·정정 이력과 보호 중인 자료를 확인하고 있습니다.</p>}
      {data && <>
        <section aria-label="사업자번호 현황" className="rounded-xl border cd-border-c p-4" style={{ background: "var(--cd-surface)" }}>
          <div className="flex items-center gap-2 mb-3"><h3 className="font-semibold">현재 사업자번호</h3><span className={`cd-pill ${data.merchantStatus === "review_required" ? "cd-pill-warn" : "cd-pill-info"}`}>{statusText(data.merchantStatus)}</span></div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm"><div><dt className="cd-text-muted">수집 원본</dt><dd className="font-medium mt-1">{displayNumber(data.originalCorpNum)}</dd></div><div><dt className="cd-text-muted">현재 적용 번호</dt><dd className="font-medium mt-1">{displayNumber(data.effectiveCorpNum)}</dd></div></dl>
          {data.merchantStatus === "review_required" && <p className="text-xs mt-3 cd-text-muted">원본 또는 기존 정정 근거를 다시 확인해야 합니다. 번호 표시만으로 거래처와 공제 검토가 완료되지는 않습니다.</p>}
        </section>
        <section aria-label="사업자번호 정정 영향" className="space-y-3">
          <h3 className="font-semibold">변경 영향</h3>
          <p className="text-xs cd-text-muted">현재 연결과 보호 자료를 조회한 결과입니다. 입력 번호를 바꿔도 같은 보호 범위를 확인하며, 적용 시 서버가 다시 검사합니다.</p>
          <div className="flex flex-wrap gap-2 text-xs"><span className="cd-pill cd-pill-info">관련 카드 {data.impact.affectedCardIds.length}건</span><span className="cd-pill cd-pill-info">전표 {data.impact.journalEntries.length}건</span><span className="cd-pill cd-pill-info">부가세 신고·근거 자료 {data.impact.vatReturns.length}건</span><span className="cd-pill cd-pill-warn">검토 확인 대상 {data.impact.reviewRequiredIds.length}건</span></div>
          {data.impact.closedYears.length > 0 && <p className="text-sm">마감 연도: {data.impact.closedYears.join(", ")}년</p>}
          {(!data.impact.canApply || data.impact.blockers.length > 0) && <div className="rounded-xl p-3 text-sm" style={{ color: "var(--cd-warning)", background: "var(--cd-warning-soft)" }}><p className="flex items-center gap-2 font-medium"><AlertTriangle className="w-4 h-4" />현재 정정·철회를 적용할 수 없습니다.</p><ul className="list-disc pl-5 mt-2 space-y-1">{data.impact.blockers.map((blocker, index) => <li key={`${blocker.code}:${index}`}>{blocker.message}</li>)}</ul></div>}
          <details className="rounded-xl border cd-border-c p-3"><summary className="text-sm cursor-pointer">관련 자료 상세 확인</summary><div className="mt-3 space-y-3 text-xs">
            <p className="cd-text-muted break-all">관련 카드: {data.impact.affectedCardIds.join(", ") || "없음"}</p>
            <div className="overflow-x-auto"><table className="w-full text-left"><caption className="text-left font-medium mb-2">전표</caption><thead className="cd-text-muted"><tr><th className="py-2 pr-3">일자</th><th className="pr-3">상태</th><th>전표 / 원천 식별자</th></tr></thead><tbody>{data.impact.journalEntries.map(row => <tr key={row.entryId} className="border-b cd-border-c last:border-0"><td className="py-2 pr-3 whitespace-nowrap">{row.date}</td><td className="pr-3">{documentStatus(row.status)}</td><td className="break-all">{row.entryId} / {row.sourceId}</td></tr>)}</tbody></table>{!data.impact.journalEntries.length && <p className="cd-text-muted">관련 전표 없음</p>}</div>
            <div className="overflow-x-auto"><table className="w-full text-left"><caption className="text-left font-medium mb-2">부가세 신고·근거 자료</caption><thead className="cd-text-muted"><tr><th className="py-2 pr-3">기간</th><th className="pr-3">종류·상태</th><th>자료 식별자</th></tr></thead><tbody>{data.impact.vatReturns.map(row => <tr key={`${row.origin ?? "legacy_return"}:${row.returnId}`} className="border-b cd-border-c last:border-0"><td className="py-2 pr-3 whitespace-nowrap">{row.from} ~ {row.to}</td><td className="pr-3">{vatProtectionLabel(row)}{row.origin === "basis_snapshot" && <span className="block text-xs cd-text-muted mt-1">세액 신고서 확정 아님</span>}</td><td className="break-all">{row.returnId}</td></tr>)}</tbody></table>{!data.impact.vatReturns.length && <p className="cd-text-muted">관련 신고·근거 자료 없음</p>}</div>
            <p className="cd-text-muted break-all">검토 확인 대상: {data.impact.reviewRequiredIds.join(", ") || "없음"}</p>
          </div></details>
          <p className="text-sm cd-text-muted">사업자번호를 정정하거나 철회하면 기존 부가세 공제 검토 근거를 다시 확인해야 합니다. 전표·신고 자료의 검토 완료를 대신하지 않습니다.</p>
        </section>
        {!canManage && <p className="rounded-xl p-3 text-sm" style={{ background: "var(--cd-surface)" }}>조회 전용 권한입니다. 정정·철회 입력은 재무 관리 권한이 필요합니다.</p>}
        <fieldset disabled={fieldDisabled} className="space-y-3">
          <legend className="font-semibold mb-3">정정 근거 입력</legend>
          <div className="flex flex-wrap gap-4 text-sm"><label className="flex gap-2 items-center"><input type="radio" name={`merchant-action-${cardTxnId}`} checked={action === "correct"} onChange={() => changeAction("correct")} />번호 정정</label><label className="flex gap-2 items-center"><input type="radio" name={`merchant-action-${cardTxnId}`} checked={action === "withdraw"} disabled={fieldDisabled || !data.active} onChange={() => changeAction("withdraw")} />기존 정정 철회</label></div>
          {action === "correct" ? <label className="block text-sm">정정 사업자번호<input className="cd-input mt-1" inputMode="numeric" autoComplete="off" maxLength={12} value={corpNum} onChange={event => { setCorpNum(event.target.value); setReviewConfirmed(false); }} placeholder="000-00-00000" /><span className="block text-xs cd-text-muted mt-1">숫자 10자리 또는 000-00-00000 형식. 사업자 실재성은 증빙으로 확인하세요.</span>{corpNum && !validNumber && <span className="block text-xs cd-error-text mt-1">사업자번호 형식을 확인하세요. 0으로만 된 번호는 사용할 수 없습니다.</span>}{sameNumber && <span className="block text-xs cd-text-muted mt-1">현재 적용 번호와 같습니다.</span>}</label> : <p className="text-sm cd-text-muted">정정을 철회하면 수집 원본 {displayNumber(data.originalCorpNum)}를 기준으로 다시 검토합니다. 원본에 번호가 없으면 결측 상태가 유지됩니다.</p>}
          <label className="block text-sm">{action === "withdraw" ? "철회 사유" : "정정 사유"}<textarea aria-label={action === "withdraw" ? "철회 사유" : "정정 사유"} className="cd-textarea mt-1" rows={2} maxLength={2000} value={reason} onChange={event => { setReason(event.target.value); setReviewConfirmed(false); }} placeholder="증빙과 원본을 비교한 근거를 입력하세요." /></label>
          <label className="block text-sm">증빙 참조<input className="cd-input mt-1" maxLength={1000} value={evidence} onChange={event => { setEvidence(event.target.value); setReviewConfirmed(false); }} placeholder="영수증·세금계산서 문서번호, 보관 위치 또는 링크" /></label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={reviewConfirmed} onChange={event => setReviewConfirmed(event.target.checked)} /><span>증빙의 사업자번호와 위 변경 영향을 직접 확인했습니다.</span></label>
        </fieldset>
        <details className="rounded-xl border cd-border-c p-4"><summary className="font-semibold cursor-pointer"><History className="inline w-4 h-4 mr-2" />정정·철회 이력 {data.history.length}건</summary><div className="space-y-3 mt-3">
          {data.history.map(item => <article key={item.eventId} className="text-sm border-b cd-border-c last:border-0 pb-3 last:pb-0"><div className="flex flex-wrap items-center gap-2"><span className="cd-pill cd-pill-info">{item.action === "correct" ? "정정" : "철회"}</span><span className="font-medium">{displayNumber(item.corpNum)}</span><span className="text-xs cd-text-muted">{item.createdAt} · 이력 {item.version}</span></div><p className="mt-2 whitespace-pre-wrap break-words">사유: {item.reason}</p><p className="text-xs cd-text-muted mt-1 whitespace-pre-wrap break-all">증빙: {item.evidence}</p><p className="text-xs cd-text-muted mt-1 break-all">처리자 식별자: {item.actorUserId}</p></article>)}
          {!data.history.length && <p className="text-sm cd-text-muted">등록된 정정 이력이 없습니다.</p>}
        </div></details>
      </>}
    </div>
  </CdModal>;
}
