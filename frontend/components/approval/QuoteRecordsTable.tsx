"use client";

// 발송견적 목록(양식별 문서 조회 '발송견적' 탭) + 견적 뷰어 모달 — LetterRecordsTable 복제.
// 목록: quotations 대장(136). 행 클릭 → PDF 미리보기 팝업.
// 팝업: iframe PDF + PDF/xlsx 다운로드 + 발송 상태·재발송(직접 제출 건은 수동 메일 발송) +
// 수신처·참조 사후 편집 + 수주 결과(pending/won/lost/dropped) 기입.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FileSpreadsheet, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { QUOTE_SEND_STATUS_LABEL, type QuoteRecipient, type QuoteSendStatus, type QuotationRow } from "@/lib/quote/types";

const short = (s: string | null) => (s ? s.slice(0, 10) : "-");
const won = (n: number | null) => (n != null ? n.toLocaleString("ko-KR") : "-");

function statusBadge(status: QuoteSendStatus) {
  const color =
    status === "sent"
      ? "border-[color:var(--cd-success,#13DEB9)] text-[color:var(--cd-success,#13DEB9)]"
      : status === "failed"
        ? "border-[color:var(--cd-danger,#FA896B)] text-[color:var(--cd-danger,#FA896B)]"
        : status === "generated"
          ? "border-[color:var(--cd-primary,#5D87FF)] text-[color:var(--cd-primary,#5D87FF)]"
          : "border-[color:var(--cd-warning,#FFAE1F)] text-[color:var(--cd-warning,#FFAE1F)]";
  return <span className={`text-[10.5px] rounded-full px-2 py-0.5 border ${color}`}>{QUOTE_SEND_STATUS_LABEL[status] ?? status}</span>;
}

const RESULT_LABEL: Record<QuotationRow["result"], string> = {
  pending: "진행 중",
  won: "수주",
  lost: "실주",
  dropped: "중단",
};

function resultBadge(result: QuotationRow["result"]) {
  const color =
    result === "won"
      ? "border-[color:var(--cd-success,#13DEB9)] text-[color:var(--cd-success,#13DEB9)]"
      : result === "lost"
        ? "border-[color:var(--cd-danger,#FA896B)] text-[color:var(--cd-danger,#FA896B)]"
        : "cd-border-c cd-text-faint";
  return <span className={`text-[10.5px] rounded-full px-2 py-0.5 border ${color}`}>{RESULT_LABEL[result]}</span>;
}

function recipientsSummary(list: QuoteRecipient[]): string {
  if (!list.length) return "-";
  const first = [list[0].facilityName, list[0].name].filter(Boolean).join(" ");
  return list.length > 1 ? `${first} 외 ${list.length - 1}` : first;
}

/** 수신처/참조 인라인 편집 그리드 — LetterRecordsTable 패턴 */
function RecipientEditGrid({ label, list, onChange }: { label: string; list: QuoteRecipient[]; onChange: (next: QuoteRecipient[]) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold cd-text">{label}</span>
      {list.map((r, i) => (
        <div key={i} className="grid grid-cols-2 md:grid-cols-5 gap-1.5 items-center">
          <input className="cd-input" placeholder="업체/기관" value={r.facilityName ?? ""} onChange={(e) => onChange(list.map((x, xi) => (xi === i ? { ...x, facilityName: e.target.value } : x)))} />
          <input className="cd-input" placeholder="부서" value={r.deptName ?? ""} onChange={(e) => onChange(list.map((x, xi) => (xi === i ? { ...x, deptName: e.target.value } : x)))} />
          <input className="cd-input" placeholder="성명" value={r.name} onChange={(e) => onChange(list.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)))} />
          <input className="cd-input" placeholder="직함" value={r.title ?? ""} onChange={(e) => onChange(list.map((x, xi) => (xi === i ? { ...x, title: e.target.value } : x)))} />
          <div className="flex items-center gap-1">
            <input className="cd-input flex-1" placeholder="메일주소" value={r.email ?? ""} onChange={(e) => onChange(list.map((x, xi) => (xi === i ? { ...x, email: e.target.value } : x)))} />
            <button type="button" className="cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]" onClick={() => onChange(list.filter((_, xi) => xi !== i))}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="cd-btn rounded-lg border border-dashed cd-border-c px-3 py-1.5 text-[11px] cd-text-faint self-start" onClick={() => onChange([...list, { name: "" }])}>
        ＋ 추가
      </button>
    </div>
  );
}

export function QuoteViewModal({ quoteId, theme, onClose, onChanged }: { quoteId: string; theme: string; onClose: () => void; onChanged?: () => void }) {
  const [quote, setQuote] = useState<QuotationRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [recipients, setRecipients] = useState<QuoteRecipient[]>([]);
  const [ccRefs, setCcRefs] = useState<QuoteRecipient[]>([]);
  const [busy, setBusy] = useState<"save" | "resend" | "result" | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/quotes/${encodeURIComponent(quoteId)}`, { cache: "no-store" });
    const data = await res.json();
    if (res.ok) {
      setQuote(data.quote);
      setRecipients(data.quote.recipients ?? []);
      setCcRefs(data.quote.ccRefs ?? []);
    }
  }, [quoteId]);
  useEffect(() => {
    void load();
  }, [load]);

  const saveMeta = async () => {
    setBusy("save");
    try {
      const res = await fetch(`/api/quotes/${encodeURIComponent(quoteId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients, ccRefs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      setEditing(false);
      await load();
      onChanged?.();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const setResult = async (result: QuotationRow["result"]) => {
    setBusy("result");
    try {
      const res = await fetch(`/api/quotes/${encodeURIComponent(quoteId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? "저장 실패");
      await load();
      onChanged?.();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    const isDirect = quote?.sendMode === "direct";
    if (!window.confirm(isDirect ? "직접 제출용 건입니다. 참조자 메일로 발송(모드 전환)할까요?" : "이 견적서를 참조자 메일로 재발송할까요?")) return;
    setBusy("resend");
    try {
      const res = await fetch(`/api/quotes/${encodeURIComponent(quoteId)}/send`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "발송 실패");
      alert(data.skipped ? "이미 발송 처리 중이거나 완료된 건입니다." : "발송되었습니다.");
      await load();
      onChanged?.();
    } catch (err) {
      alert((err as Error).message);
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    // 포털 모달 — .cdash 밖이라 cdash-vars + cd-fields-white + data-theme 부여(UI 규칙)
    <div className="cdash-vars cd-fields-white fixed inset-0 z-[80] flex items-center justify-center p-4" data-theme={theme} style={{ background: "rgba(15,20,34,0.45)" }} onClick={onClose}>
      <div className="rounded-2xl bg-[color:var(--cd-card)] shadow-2xl w-full max-w-[1400px] max-h-[94vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b cd-border-c">
          <div className="flex flex-col min-w-0">
            <span className="text-[13.5px] font-bold cd-text truncate">
              {quote ? `${quote.quoteNo ?? "미채번"} · ${quote.title ?? ""}` : "불러오는 중..."}
            </span>
            <span className="text-[11px] cd-text-faint flex items-center gap-1.5 flex-wrap">
              {quote && statusBadge(quote.sendStatus)}
              {quote && resultBadge(quote.result)}
              {quote?.totalAmount != null && <span>견적 {won(quote.totalAmount)}원</span>}
              {quote?.validUntil && <span>유효 {quote.validUntil}까지</span>}
              {quote?.sentAt ? <span>발송 {short(quote.sentAt)}</span> : null}
              {quote?.sendError && <span className="text-[color:var(--cd-danger,#FA896B)]">{quote.sendError}</span>}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="flex items-center justify-center"
              style={{ width: 30, height: 30 }}
              title="PDF 다운로드(제출용)"
              onClick={() => window.open(`/api/quotes/${encodeURIComponent(quoteId)}/pdf`, "_blank")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/pdfico.png" alt="PDF" style={{ width: 30, height: 30 }} />
            </button>
            <button
              type="button"
              className="cd-btn rounded-lg border cd-border-c p-1.5"
              title="xlsx 다운로드(내부 보관용 원본)"
              onClick={() => window.open(`/api/quotes/${encodeURIComponent(quoteId)}/xlsx`, "_blank")}
            >
              <FileSpreadsheet className="w-4 h-4 cd-text-primary" />
            </button>
            <button
              type="button"
              className="cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[11px] flex items-center gap-1 disabled:opacity-50"
              disabled={busy != null}
              onClick={resend}
              title={quote?.sendMode === "direct" ? "수동 메일 발송(모드 전환)" : "참조자 메일로 재발송"}
            >
              <RefreshCw className="w-3 h-3" /> {busy === "resend" ? "발송 중..." : quote?.sendMode === "direct" ? "메일 발송" : "재발송"}
            </button>
            <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[11px] flex items-center gap-1" onClick={() => setEditing((v) => !v)} title="수신처·참조 정보 편집">
              <Pencil className="w-3 h-3" /> 수신처 편집
            </button>
            <select
              className="cd-select text-[11px]"
              style={{ width: 84 }}
              value={quote?.result ?? "pending"}
              disabled={busy != null}
              onChange={(e) => void setResult(e.target.value as QuotationRow["result"])}
              title="수주 결과 기입 — 견적-수주율 분석의 원료"
            >
              <option value="pending">진행 중</option>
              <option value="won">수주</option>
              <option value="lost">실주</option>
              <option value="dropped">중단</option>
            </select>
            <button type="button" className="cd-btn rounded-lg border cd-border-c p-1.5" onClick={onClose}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {editing && (
          <div className="px-5 py-3.5 border-b cd-border-c flex flex-col gap-3 max-h-[38vh] overflow-auto">
            <RecipientEditGrid label="수신처" list={recipients} onChange={setRecipients} />
            <RecipientEditGrid label="참조(메일 발송 대상)" list={ccRefs} onChange={setCcRefs} />
            <div className="flex items-center gap-2">
              <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50" disabled={busy != null} onClick={saveMeta}>
                {busy === "save" ? "저장 중..." : "저장"}
              </button>
              <button
                type="button"
                className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs"
                onClick={() => {
                  setEditing(false);
                  setRecipients(quote?.recipients ?? []);
                  setCcRefs(quote?.ccRefs ?? []);
                }}
              >
                취소
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-[420px] bg-[color:var(--cd-surface)]">
          {quote && <iframe title="견적서 미리보기" src={`/api/quotes/${encodeURIComponent(quoteId)}/pdf?disposition=inline`} className="w-full h-full min-h-[60vh]" />}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function QuoteRecordsTable({
  quotes,
  loading,
  theme,
  onChanged,
}: {
  quotes: QuotationRow[];
  loading: boolean;
  theme: string;
  onChanged: () => void;
}) {
  const [viewId, setViewId] = useState<string | null>(null);

  if (loading) return <p className="text-sm cd-text-faint">조회 중입니다.</p>;
  return (
    <>
      <div className="overflow-x-auto min-h-0">
        <table className="w-full text-[12px] whitespace-nowrap">
          <thead>
            <tr className="text-left cd-text-faint text-[11px]">
              <th className="py-1.5 pr-3 font-semibold">견적번호</th>
              <th className="py-1.5 pr-3 font-semibold">건명</th>
              <th className="py-1.5 pr-3 font-semibold">수신처</th>
              <th className="py-1.5 pr-3 font-semibold">세분류</th>
              <th className="py-1.5 pr-3 font-semibold text-right">견적금액(원)</th>
              <th className="py-1.5 pr-3 font-semibold">기안자</th>
              <th className="py-1.5 pr-3 font-semibold">견적일</th>
              <th className="py-1.5 pr-3 font-semibold">상태</th>
              <th className="py-1.5 pr-3 font-semibold">결과</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.quoteId} className="border-t cd-border-c cursor-pointer hover:bg-[color:var(--cd-surface)]" onClick={() => setViewId(q.quoteId)}>
                <td className="py-2 pr-3 font-mono text-[11px] cd-text-faint">{q.quoteNo ?? "-"}</td>
                <td className="py-2 pr-3 cd-text max-w-[300px] overflow-hidden text-ellipsis" title={q.title ?? ""}>
                  {q.title ?? "-"}
                </td>
                <td className="py-2 pr-3 cd-text max-w-[200px] overflow-hidden text-ellipsis">{recipientsSummary(q.recipients)}</td>
                <td className="py-2 pr-3 cd-text-faint">{q.serviceSubtype ?? "-"}</td>
                <td className="py-2 pr-3 cd-text text-right font-mono text-[11.5px]">{won(q.totalAmount)}</td>
                <td className="py-2 pr-3 cd-text">{q.drafterName ?? "-"}</td>
                <td className="py-2 pr-3 font-mono text-[11px] cd-text-faint">{q.issueDate ?? "-"}</td>
                <td className="py-2 pr-3">
                  {statusBadge(q.sendStatus)}
                  {q.sendStatus === "failed" && <span className="ml-1.5 text-[10.5px] text-[color:var(--cd-danger,#FA896B)]">클릭 후 재발송</span>}
                </td>
                <td className="py-2 pr-3">{resultBadge(q.result)}</td>
              </tr>
            ))}
            {quotes.length === 0 && (
              <tr>
                <td colSpan={9} className="py-6 text-center cd-text-faint text-sm">
                  발송된 견적서가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {viewId && <QuoteViewModal quoteId={viewId} theme={theme} onClose={() => setViewId(null)} onChanged={onChanged} />}
    </>
  );
}
