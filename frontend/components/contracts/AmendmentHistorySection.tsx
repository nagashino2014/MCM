"use client";

// 변경 이력 카드(278, 2026-10-14 사용자 요청) — 변경계약은 여러 번 생길 수 있어 차수별로 변경 내용과
// 변경계약서를 보관·열람한다. 차수 = 변경계약서 단위, 차수에 묶이지 않은 이벤트는 '정보 정정'.

import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Download, FileText, Upload } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { CdHelp } from "@/components/cdash/CdHelp";
import { roundAmountChange, summarizeChangeEvent } from "@/lib/contracts/change-summary";

type Row = Record<string, unknown>;

const text = (v: unknown) => String(v ?? "").trim();
const day = (v: unknown) => text(v).slice(0, 10);
const eventDay = (e: Row) => day(e.changed_at) || day(e.created_at);
/** 같은 날 여러 번 저장한 기록을 구분하는 저장 시각(KST HH:MM). 형식이 다른 옛 값은 생략. */
const eventTime = (e: Row) => {
  const d = new Date(text(e.created_at));
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
};
// .cd-input 의 width:100% 가 Tailwind 폭 유틸리티보다 우선해 목록박스가 행 전체로 늘어났다 — 폭은 인라인으로 고정.
const ROUND_SELECT_STYLE = { width: 112 } as const;

export function AmendmentHistorySection({
  contractId,
  amendments,
  changes,
  documents,
  onOpenDocument,
  onChanged,
}: {
  contractId: string;
  amendments: Row[];
  changes: Row[];
  documents: Row[];
  /** 계약서 뷰어를 이 문서 탭으로 연다 */
  onOpenDocument: (documentId: string) => void;
  /** 업로드·차수 지정 뒤 상세 재조회 */
  onChanged: () => void;
}) {
  const toast = useToast();
  const [openRounds, setOpenRounds] = useState<Record<string, boolean>>({});
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const rounds = useMemo(
    () =>
      [...amendments]
        .sort((a, b) => Number(b.round_no) - Number(a.round_no))
        .map((a) => {
          const id = text(a.amendment_id);
          return {
            id,
            roundNo: Number(a.round_no),
            amendedAt: day(a.amended_at),
            summary: text(a.summary),
            docs: documents
              .filter((d) => text(d.amendment_id) === id)
              .sort((x, y) => text(x.created_at).localeCompare(text(y.created_at))),
            events: changes
              .filter((e) => text(e.amendment_id) === id)
              .sort((x, y) => text(x.created_at).localeCompare(text(y.created_at))),
          };
        }),
    [amendments, changes, documents]
  );
  const corrections = useMemo(
    () =>
      changes
        .filter((e) => !text(e.amendment_id))
        .sort((x, y) => text(y.created_at).localeCompare(text(x.created_at))),
    [changes]
  );

  const uploadAmendment = async (file: File, opts: { amendmentId: string; changeEventId?: string; documentDate: string }) => {
    setBusy(opts.changeEventId ?? opts.amendmentId);
    try {
      const form = new FormData();
      form.set("documentType", "amendment");
      form.set("documentDate", opts.documentDate);
      form.set("amendmentId", opts.amendmentId);
      if (opts.changeEventId) form.set("changeEventId", opts.changeEventId);
      form.set("file", file);
      const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/documents`, { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { error?: string; roundNo?: number | null; deduplicated?: boolean };
      if (!res.ok) throw new Error(body.error ?? "HTTP " + res.status);
      toast.show(
        body.deduplicated
          ? "이미 올라간 변경계약서와 같은 파일이라 새로 저장하지 않았습니다."
          : body.roundNo
            ? `${body.roundNo}차 변경계약서를 저장했습니다.`
            : "변경계약서를 저장했습니다.",
        "success"
      );
      onChanged();
    } catch (err) {
      toast.show("변경계약서 업로드 실패: " + (err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const assignRound = async (changeId: string, amendmentId: string | null) => {
    setBusy(changeId);
    try {
      const res = await fetch(
        `/api/contracts/${encodeURIComponent(contractId)}/changes/${encodeURIComponent(changeId)}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amendmentId }) }
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "HTTP " + res.status);
      onChanged();
    } catch (err) {
      toast.show("차수 지정 실패: " + (err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const roundSelect = (event: Row) => {
    const changeId = text(event.change_id);
    return (
      <select
        className="cd-input py-1 text-xs"
        style={ROUND_SELECT_STYLE}
        value={text(event.amendment_id)}
        disabled={busy === changeId}
        onChange={(e) => assignRound(changeId, e.target.value || null)}
        title="이 변경을 어느 차수에 넣을지 고릅니다"
      >
        <option value="">정보 정정</option>
        {[...rounds].reverse().map((r) => (
          <option key={r.id} value={r.id}>
            {r.roundNo}차 변경
          </option>
        ))}
      </select>
    );
  };

  /** 변경 기록 한 줄 — 날짜·저장 시각 | 번호 매긴 변경 내용 | 차수 지정(·추가 동작) */
  const eventRow = (event: Row, actions: ReactNode, className = "") => {
    const lines = summarizeChangeEvent(event);
    const time = eventTime(event);
    return (
      <div key={text(event.change_id)} className={"flex flex-wrap items-start gap-x-3 gap-y-2 text-xs sm:flex-nowrap " + className}>
        <div className="shrink-0 w-[84px] tabular-nums leading-5">
          <div className="cd-text-muted">{eventDay(event)}</div>
          {time && <div className="cd-text-faint">{time} 저장</div>}
        </div>
        {lines.length ? (
          <ol className="flex-1 min-w-[160px] list-decimal pl-4 grid gap-0.5 leading-5 cd-text">
            {lines.map((line, i) => (
              <li key={i} className="break-words pl-0.5">{line}</li>
            ))}
          </ol>
        ) : (
          <p className="flex-1 min-w-[160px] leading-5 cd-text-faint">변경 내용 없음(저장 기록만 있음)</p>
        )}
        {/* 좁은 화면에서는 차수 지정·업로드 버튼이 다음 줄로 내려가 카드 밖으로 넘치지 않는다 */}
        <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-1 sm:w-auto">{actions}</div>
      </div>
    );
  };

  return (
    <div className="rounded-lg border cd-border-c p-4">
      <div className="flex items-baseline gap-2 mb-3">
        <h3 className="font-semibold cd-text">변경 이력</h3>
        <span className="text-[11px] cd-text-faint">
          변경계약 {rounds.length}회{corrections.length ? ` · 정보 정정 ${corrections.length}건` : ""}
        </span>
        <CdHelp label="변경 이력 도움말">
          <p>변경계약서를 올릴 때마다 차수(1차, 2차…)가 생기고, 그 변경계약에서 바꾼 금액·단계·기간이 차수에 묶입니다.</p>
          <p className="mt-2">
            변경계약서 없이 저장한 수정은 &lsquo;정보 정정&rsquo;으로 남으며 대행 실적 변경 보고 대상이 아닙니다. 지난
            정정을 차수에 넣거나, 변경계약서를 올려 새 차수로 만들 수 있습니다.
          </p>
        </CdHelp>
      </div>

      {rounds.length === 0 && (
        <p className="text-xs cd-text-faint">
          등록된 변경계약이 없습니다. 변경계약 입력에서 변경계약서 PDF를 첨부하면 1차 변경계약으로 기록됩니다.
        </p>
      )}

      <div className="grid gap-2">
        {rounds.map((r) => {
          const amount = roundAmountChange(r.events);
          const open = !!openRounds[r.id];
          return (
            <div key={r.id} className="rounded-lg border cd-border-c cd-surface-bg">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <button
                  type="button"
                  className="cd-action flex items-center gap-1 font-semibold cd-text"
                  onClick={() => setOpenRounds((prev) => ({ ...prev, [r.id]: !open }))}
                  aria-expanded={open}
                >
                  {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  {r.roundNo}차 변경
                </button>
                <span className="text-xs cd-text-faint tabular-nums">{r.amendedAt || "-"}</span>
                {amount && (
                  <span className="text-xs cd-text-muted tabular-nums">
                    {amount.previous.toLocaleString()} → {amount.next.toLocaleString()}원
                  </span>
                )}
                {r.summary && <span className="text-xs cd-text-muted truncate max-w-[360px]">{r.summary}</span>}
                <div className="ml-auto flex flex-wrap items-center gap-1">
                  {r.docs.map((d, i) => (
                    <span key={text(d.document_id)} className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        className="cd-action cd-btn cd-btn-ghost px-2 py-1 text-xs cd-text-muted flex items-center gap-1"
                        onClick={() => onOpenDocument(text(d.document_id))}
                        title={text(d.display_name)}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        변경계약서{r.docs.length > 1 ? ` ${i + 1}` : ""}
                      </button>
                      <a
                        href={text(d.public_path)}
                        download={text(d.display_name) || true}
                        className="cd-action cd-btn cd-btn-ghost px-1.5 py-1 text-xs cd-text-muted flex items-center"
                        title="다운로드"
                        aria-label={`${r.roundNo}차 변경계약서 다운로드`}
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    </span>
                  ))}
                  <label
                    className="cd-action cd-btn cd-btn-ghost px-2 py-1 text-xs cd-text-muted flex items-center gap-1 cursor-pointer"
                    title={`${r.roundNo}차에 변경계약서를 추가로 올립니다(서명본·별첨 등)`}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {busy === r.id ? "올리는 중…" : "문서 추가"}
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      className="hidden"
                      disabled={busy === r.id}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) void uploadAmendment(file, { amendmentId: r.id, documentDate: r.amendedAt || day(new Date().toISOString()) });
                      }}
                    />
                  </label>
                </div>
              </div>
              {open && (
                <div className="border-t cd-border-c px-3 py-2 grid gap-2">
                  {r.events.length === 0 && (
                    <p className="text-xs cd-text-faint">이 차수에 묶인 변경 내용이 없습니다. 아래 정보 정정에서 차수를 지정할 수 있습니다.</p>
                  )}
                  {r.events.map((e, i) => eventRow(e, roundSelect(e), i > 0 ? "border-t cd-border-c pt-2" : ""))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {corrections.length > 0 && (
        <div className="mt-3">
          <button
            type="button"
            className="cd-action flex items-center gap-1 text-xs font-semibold cd-text-muted"
            onClick={() => setCorrectionsOpen((v) => !v)}
            aria-expanded={correctionsOpen}
          >
            {correctionsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            정보 정정 {corrections.length}건
          </button>
          {correctionsOpen && (
            <div className="mt-2 grid gap-2">
              {corrections.map((e) => {
                const changeId = text(e.change_id);
                return eventRow(
                  e,
                  <>
                      {rounds.length > 0 && roundSelect(e)}
                      <label
                        className="cd-action cd-btn cd-btn-ghost px-2 py-1 text-xs cd-text-muted flex items-center gap-1 cursor-pointer whitespace-nowrap"
                        title="이 변경의 변경계약서를 올려 새 차수로 기록합니다"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        {busy === changeId ? "올리는 중…" : "변경계약서로 새 차수"}
                        <input
                          type="file"
                          accept="application/pdf,.pdf"
                          className="hidden"
                          disabled={busy === changeId}
                          onChange={(ev) => {
                            const file = ev.target.files?.[0];
                            ev.target.value = "";
                            if (file) {
                              void uploadAmendment(file, {
                                amendmentId: "new",
                                changeEventId: changeId,
                                documentDate: eventDay(e) || day(new Date().toISOString()),
                              });
                            }
                          }}
                        />
                      </label>
                  </>,
                  "rounded-lg border cd-border-c px-3 py-2"
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
