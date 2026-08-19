"use client";

// 발송공문 목록(양식별 문서 조회 '발송공문' 탭) + 공문 뷰어 모달.
// 목록: official_letters 대장(시스템 생성 + 과거 이관 imported). 행 클릭 → PDF 미리보기 팝업.
// 팝업: iframe PDF + PDF/HWPX 다운로드 아이콘 버튼(사업장 마스터 30px 아이콘 패턴,
// FacilityListPanel.tsx:304) + 발송 상태·재발송 + 수신처·참조 사후 편집(백필 문서 메일 보완).

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { RecipientEditGrid } from "@/components/approval/LetterRecipientGrid";
import { LetterImportModal } from "@/components/approval/LetterImportModal";
import { LETTER_SEND_STATUS_LABEL, type LetterRecipient, type LetterSendStatus, type OfficialLetterRow } from "@/lib/letter/types";

const short = (s: string | null) => (s ? s.slice(0, 10) : "-");

function statusBadge(status: LetterSendStatus) {
  const color =
    status === "sent"
      ? "border-[color:var(--cd-success,#13DEB9)] text-[color:var(--cd-success,#13DEB9)]"
      : status === "failed"
        ? "border-[color:var(--cd-danger,#FA896B)] text-[color:var(--cd-danger,#FA896B)]"
        : status === "archived"
          ? "cd-border-c cd-text-faint"
          : "border-[color:var(--cd-warning,#FFAE1F)] text-[color:var(--cd-warning,#FFAE1F)]";
  return <span className={`text-[10.5px] rounded-full px-2 py-0.5 border ${color}`}>{LETTER_SEND_STATUS_LABEL[status] ?? status}</span>;
}

function recipientsSummary(list: LetterRecipient[]): string {
  if (!list.length) return "-";
  const first = [list[0].facilityName, list[0].name].filter(Boolean).join(" ");
  return list.length > 1 ? `${first} 외 ${list.length - 1}` : first;
}

export function LetterViewModal({ letterId, theme, onClose, onChanged }: { letterId: string; theme: string; onClose: () => void; onChanged?: () => void }) {
  const [letter, setLetter] = useState<OfficialLetterRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [recipients, setRecipients] = useState<LetterRecipient[]>([]);
  const [ccRefs, setCcRefs] = useState<LetterRecipient[]>([]);
  const [busy, setBusy] = useState<"save" | "resend" | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/letters/${encodeURIComponent(letterId)}`, { cache: "no-store" });
    const data = await res.json();
    if (res.ok) {
      setLetter(data.letter);
      setRecipients(data.letter.recipients ?? []);
      setCcRefs(data.letter.ccRefs ?? []);
    }
  }, [letterId]);
  useEffect(() => {
    void load();
  }, [load]);

  const saveMeta = async () => {
    setBusy("save");
    try {
      const res = await fetch(`/api/letters/${encodeURIComponent(letterId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients, ccRefs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      setLetter(data.letter);
      setEditing(false);
      onChanged?.();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const resend = async () => {
    // 발송 완료 건은 회수 → 수정 → 재결재 경유(2026-08-19 사용자 확정) — 즉시 재송부는
    // 발주처 입장에서 "왜 똑같은 공문을 또 보냈지"가 되므로 지원하지 않는다.
    if (letter?.sendStatus === "sent") {
      if (!letter.docId) {
        alert("과거 이관 공문은 재발송 대상이 아닙니다.");
        return;
      }
      const nth = letter.sendHistory.length + 1;
      if (!window.confirm(`공문을 회수해 수정 후 재발송합니다(${nth}차). 회수하면 결재를 다시 받아야 하며, 승인되면 자동으로 재발송됩니다. 진행할까요?`)) return;
      setBusy("resend");
      try {
        const res = await fetch(`/api/approval/docs/${encodeURIComponent(letter.docId)}/recall`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "회수 실패");
        // 착수계·준공계 연계 공문 — 서류 재작성이 먼저이므로 작성 화면으로 회귀(2026-08-19)
        const dlv = (data.deliverables ?? []) as { deliverableId: string }[];
        window.location.href = dlv.length
          ? `/contracts/deliverables?deliverable=${encodeURIComponent(dlv[0].deliverableId)}`
          : `/approval/letter?docId=${encodeURIComponent(letter.docId)}`;
      } catch (err) {
        alert((err as Error).message);
        setBusy(null);
      }
      return;
    }
    if (!window.confirm("이 공문을 수신처 메일로 재발송할까요?")) return;
    setBusy("resend");
    try {
      const res = await fetch(`/api/letters/${encodeURIComponent(letterId)}/send`, { method: "POST" });
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

  const removeImported = async () => {
    if (!window.confirm("이 이관 등록을 삭제할까요? 공문번호가 다시 결번이 됩니다.")) return;
    setBusy("save");
    try {
      const res = await fetch(`/api/letters/${encodeURIComponent(letterId)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "삭제 실패");
      onChanged?.();
      onClose();
    } catch (err) {
      alert((err as Error).message);
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
              {letter ? `${letter.letterNo ?? "미채번"} · ${letter.title ?? ""}` : "불러오는 중..."}
            </span>
            <span className="text-[11px] cd-text-faint flex items-center gap-1.5">
              {letter && statusBadge(letter.sendStatus)}
              {/* 발송 이력(194) — 1차부터 N차까지 합산 관리. 2회 이상이면 회차를 표기한다 */}
              {letter?.sentAt ? (
                <span>
                  {letter.sendHistory.length > 1 ? `${letter.sendHistory.length}차 ` : ""}발송 {short(letter.sentAt)}
                </span>
              ) : null}
              {(letter?.sendHistory.length ?? 0) > 0 && (
                <button type="button" className="underline decoration-dotted hover:cd-text" onClick={() => setHistoryOpen((v) => !v)}>
                  {historyOpen ? "이력 닫기" : "발송 이력"}
                </button>
              )}
              {letter?.source === "imported" && <span>과거 이관 문서</span>}
              {letter?.sendError && <span className="text-[color:var(--cd-danger,#FA896B)]">{letter.sendError}</span>}
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* PDF·HWPX 다운로드 — 사업장 마스터 30px 아이콘 버튼 패턴 */}
            <button
              type="button"
              className="flex items-center justify-center"
              style={{ width: 30, height: 30 }}
              title="PDF 다운로드"
              onClick={() => window.open(`/api/letters/${encodeURIComponent(letterId)}/pdf`, "_blank")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/pdfico.png" alt="PDF" style={{ width: 30, height: 30 }} />
            </button>
            <button
              type="button"
              className="flex items-center justify-center"
              style={{ width: 30, height: 30 }}
              title="한글 파일 다운로드(HWPX/HWP)"
              onClick={() => window.open(`/api/letters/${encodeURIComponent(letterId)}/hwpx`, "_blank")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/hwpxico.png" alt="HWPX" style={{ width: 30, height: 30 }} />
            </button>
            {letter && letter.source === "system" && letter.sendStatus !== "archived" && (
              <button
                type="button"
                className="cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[11px] flex items-center gap-1 disabled:opacity-50"
                disabled={busy != null}
                onClick={resend}
                title="수신처 메일로 재발송"
              >
                <RefreshCw className="w-3 h-3" /> {busy === "resend" ? "처리 중..." : letter?.sendStatus === "sent" ? "수정 후 재발송" : "재발송"}
              </button>
            )}
            <button type="button" className="cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[11px] flex items-center gap-1" onClick={() => setEditing((v) => !v)} title="수신처·참조 정보 편집(메일주소 보완)">
              <Pencil className="w-3 h-3" /> 수신처 편집
            </button>
            {letter && letter.source === "imported" && (
              <button
                type="button"
                className="cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[11px] flex items-center gap-1 disabled:opacity-50"
                style={{ color: "var(--cd-danger, #FA896B)" }}
                disabled={busy != null}
                onClick={removeImported}
                title="이관 등록 취소(오등록 정정) — 번호가 다시 결번이 됩니다."
              >
                <Trash2 className="w-3 h-3" /> 등록 삭제
              </button>
            )}
            <button type="button" className="cd-btn rounded-lg border cd-border-c p-1.5" onClick={onClose}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {historyOpen && letter && letter.sendHistory.length > 0 && (
          <div className="px-5 py-3 border-b cd-border-c flex flex-col gap-1.5 max-h-[26vh] overflow-auto">
            <span className="text-[11px] font-bold cd-text">발송 이력 — 이 공문의 모든 발송이 한 건으로 합산 관리됩니다</span>
            {letter.sendHistory.map((h, i) => (
              <div key={i} className="flex items-baseline gap-2 text-[11.5px]">
                <span className="font-mono cd-text shrink-0">{i + 1}차</span>
                <span className="font-mono cd-text-faint shrink-0">{(h.sentAt ?? "").slice(0, 16).replace("T", " ")}</span>
                <span className="cd-text-faint truncate">
                  {(h.to ?? []).join(", ")}
                  {h.cc?.length ? ` (참조 ${h.cc.length}명)` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
        {editing && (
          <div className="px-5 py-3.5 border-b cd-border-c flex flex-col gap-3 max-h-[38vh] overflow-auto">
            <RecipientEditGrid label="수신처" list={recipients} onChange={setRecipients} />
            <RecipientEditGrid label="참조" list={ccRefs} onChange={setCcRefs} />
            <div className="flex items-center gap-2">
              <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50" disabled={busy != null} onClick={saveMeta}>
                {busy === "save" ? "저장 중..." : "저장"}
              </button>
              <button
                type="button"
                className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs"
                onClick={() => {
                  setEditing(false);
                  setRecipients(letter?.recipients ?? []);
                  setCcRefs(letter?.ccRefs ?? []);
                }}
              >
                취소
              </button>
              <span className="text-[10.5px] cd-text-faint">과거 이관 공문은 원본에 메일주소가 없으므로 여기서 보완 입력합니다.</span>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-[420px] bg-[color:var(--cd-surface)]">
          {letter &&
            (letter.pdfKey || letter.docId ? (
              <iframe title="공문 미리보기" src={`/api/letters/${encodeURIComponent(letterId)}/pdf?disposition=inline`} className="w-full h-full min-h-[60vh]" />
            ) : (
              <div className="flex flex-col items-center justify-center h-full min-h-[420px] gap-2 cd-text-faint text-sm">
                <p>PDF 미리보기가 없습니다 (과거 이관 문서 — hwp 원본만 보관).</p>
                <p className="text-[11px]">우상단 한글 아이콘으로 원본을 다운로드하세요.</p>
              </div>
            ))}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function LetterRecordsTable({
  letters,
  loading,
  theme,
  onChanged,
}: {
  letters: OfficialLetterRow[];
  loading: boolean;
  theme: string;
  onChanged: () => void;
}) {
  const [viewId, setViewId] = useState<string | null>(null);
  // 이관 등록(커스텀 마이그레이션) — 관리자만. 결번 = 사외에서 발번돼 앱에 없는 번호 자리.
  const [importNo, setImportNo] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [canImport, setCanImport] = useState(false);
  const [gaps, setGaps] = useState<string[]>([]);

  const loadNumbering = useCallback(() => {
    fetch("/api/letters/next-no", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        setCanImport(d?.canAssign === true);
        setGaps(Array.isArray(d?.gaps) ? d.gaps : []);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadNumbering();
  }, [loadNumbering]);

  const openImport = (no: string | null) => {
    setImportNo(no);
    setImportOpen(true);
  };

  if (loading) return <p className="text-sm cd-text-faint">조회 중입니다.</p>;
  return (
    <>
      {canImport && (
        <div className="flex items-center gap-2 flex-wrap pb-2.5">
          <button
            type="button"
            className="cd-btn rounded-lg border cd-border-c px-3 py-1.5 text-[11.5px] flex items-center gap-1"
            onClick={() => openImport(null)}
            title="앱 밖에서 발송된 공문을 대장에 등록합니다(파일·수신처 포함)."
          >
            <Plus className="w-3.5 h-3.5" /> 공문 이관 등록
          </button>
          {gaps.length > 0 && (
            <>
              <span className="text-[11px] cd-text-faint">결번(미등록 번호)</span>
              {gaps.slice(-12).map((no) => (
                <button
                  key={no}
                  type="button"
                  className="cd-btn rounded-full border border-dashed cd-border-c px-2.5 py-1 text-[10.5px] font-mono cd-text-faint"
                  onClick={() => openImport(no)}
                  title="이 번호로 이관 등록"
                >
                  {no}
                </button>
              ))}
              {gaps.length > 12 && <span className="text-[10.5px] cd-text-faint">외 {gaps.length - 12}건</span>}
            </>
          )}
        </div>
      )}
      <div className="overflow-x-auto min-h-0">
        <table className="w-full text-[12px] whitespace-nowrap">
          <thead>
            <tr className="text-left cd-text-faint text-[11px]">
              <th className="py-1.5 pr-3 font-semibold">공문번호</th>
              <th className="py-1.5 pr-3 font-semibold">제목</th>
              <th className="py-1.5 pr-3 font-semibold">수신처</th>
              <th className="py-1.5 pr-3 font-semibold">유형</th>
              <th className="py-1.5 pr-3 font-semibold">기안자</th>
              <th className="py-1.5 pr-3 font-semibold">시행일</th>
              <th className="py-1.5 pr-3 font-semibold">발송 상태</th>
            </tr>
          </thead>
          <tbody>
            {letters.map((l) => (
              <tr key={l.letterId} className="border-t cd-border-c cursor-pointer hover:bg-[color:var(--cd-surface)]" onClick={() => setViewId(l.letterId)}>
                <td className="py-2 pr-3 font-mono text-[11px] cd-text-faint">{l.letterNo ?? "-"}</td>
                <td className="py-2 pr-3 cd-text max-w-[340px] overflow-hidden text-ellipsis" title={l.title ?? ""}>
                  {l.title ?? "-"}
                </td>
                <td className="py-2 pr-3 cd-text max-w-[220px] overflow-hidden text-ellipsis">{recipientsSummary(l.recipients)}</td>
                <td className="py-2 pr-3 cd-text-faint">{l.letterKind === "proof" ? "내용증명" : "일반"}</td>
                <td className="py-2 pr-3 cd-text">{l.drafterName ?? "-"}</td>
                <td className="py-2 pr-3 font-mono text-[11px] cd-text-faint">{l.issueDate ?? "-"}</td>
                <td className="py-2 pr-3">
                  {statusBadge(l.sendStatus)}
                  {l.sendHistory.length > 1 && <span className="ml-1.5 text-[10.5px] cd-text-faint">{l.sendHistory.length}차</span>}
                  {l.sendStatus === "failed" && <span className="ml-1.5 text-[10.5px] text-[color:var(--cd-danger,#FA896B)]">클릭 후 재발송</span>}
                </td>
              </tr>
            ))}
            {letters.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center cd-text-faint text-sm">
                  발송된 공문이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {viewId && (
        <LetterViewModal
          letterId={viewId}
          theme={theme}
          onClose={() => setViewId(null)}
          onChanged={() => {
            onChanged();
            loadNumbering();
          }}
        />
      )}
      {importOpen && (
        <LetterImportModal
          theme={theme}
          initialNo={importNo}
          onClose={() => setImportOpen(false)}
          onSaved={() => {
            onChanged();
            loadNumbering();
          }}
        />
      )}
    </>
  );
}
