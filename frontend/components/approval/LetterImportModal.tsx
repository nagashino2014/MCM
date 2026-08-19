"use client";

// 공문 이관 등록(커스텀 마이그레이션) — 앱 밖에서 발송된 공문을 대장에 직접 올린다.
// 그룹웨어 전사 런칭 전이라 사외(다우오피스 등)에서 발번·발송되는 공문이 섞이는데,
// 앱에서 그 번호를 건너뛰고(작성 화면 '번호 직접 지정') 남긴 결번을 여기서 메운다.
// 저장 = POST /api/letters/import(multipart) — scripts/import_letters.py 와 같은 관문.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Paperclip, Trash2, Upload, X } from "lucide-react";
import { RecipientEditGrid } from "@/components/approval/LetterRecipientGrid";
import { LETTER_NO_RE, type LetterRecipient } from "@/lib/letter/types";

type Slot = "pdf" | "hwp" | "hwpx";

const SLOT_LABEL: Record<Slot, string> = { pdf: "공문 PDF", hwp: "HWP 원본", hwpx: "HWPX 원본" };
const SLOT_ACCEPT: Record<Slot, string> = { pdf: ".pdf", hwp: ".hwp", hwpx: ".hwpx" };

function FileSlot({ slot, file, onPick }: { slot: Slot; file: File | null; onPick: (f: File | null) => void }) {
  return (
    <label className="flex items-center gap-2 rounded-xl border border-dashed cd-border-c px-3 py-2 cursor-pointer min-w-0">
      <Upload className="w-3.5 h-3.5 cd-text-faint shrink-0" />
      <span className="text-[11px] cd-text-faint shrink-0">{SLOT_LABEL[slot]}</span>
      <span className="text-[11.5px] cd-text truncate">{file ? file.name : "선택"}</span>
      {file && (
        <button
          type="button"
          className="ml-auto cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)]"
          onClick={(e) => {
            e.preventDefault();
            onPick(null);
          }}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
      <input type="file" className="hidden" accept={SLOT_ACCEPT[slot]} onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
    </label>
  );
}

export function LetterImportModal({
  theme,
  initialNo,
  onClose,
  onSaved,
}: {
  theme: string;
  initialNo?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [letterNo, setLetterNo] = useState(initialNo ?? "");
  const [title, setTitle] = useState("");
  const [letterKind, setLetterKind] = useState<"general" | "proof">("general");
  const [issueDate, setIssueDate] = useState("");
  const [drafterName, setDrafterName] = useState("");
  const [recipients, setRecipients] = useState<LetterRecipient[]>([{ name: "" }]);
  const [ccRefs, setCcRefs] = useState<LetterRecipient[]>([]);
  const [files, setFiles] = useState<Record<Slot, File | null>>({ pdf: null, hwp: null, hwpx: null });
  const [attaches, setAttaches] = useState<File[]>([]);
  const [check, setCheck] = useState<{ available: boolean; usedBy: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  // 번호 중복 확인 — 대장 + 결재 문서(수동 지정 draft 포함) 합집합 기준
  useEffect(() => {
    const no = letterNo.trim();
    if (!LETTER_NO_RE.test(no)) {
      setCheck(null);
      return;
    }
    const timer = setTimeout(() => {
      fetch(`/api/letters/next-no?year=${no.slice(0, 4)}&check=${encodeURIComponent(no)}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setCheck(d?.check ?? null))
        .catch(() => {});
    }, 350);
    return () => clearTimeout(timer);
  }, [letterNo]);

  const save = useCallback(async () => {
    const no = letterNo.trim();
    if (!LETTER_NO_RE.test(no)) {
      alert("공문번호 형식이 올바르지 않습니다(예: 2026-대외-01034).");
      return;
    }
    if (!title.trim()) {
      alert("제목을 입력하세요.");
      return;
    }
    if (check && !check.available) {
      alert(`이미 등록된 공문번호입니다 — ${check.usedBy}`);
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append(
        "meta",
        JSON.stringify({
          letterNo: no,
          title: title.trim(),
          letterKind,
          issueDate: issueDate.trim() || null,
          drafterName: drafterName.trim() || null,
          recipients: recipients.filter((r) => r.name.trim() || r.facilityName?.trim()),
          ccRefs: ccRefs.filter((r) => r.name.trim() || (r.email ?? "").trim()),
        })
      );
      for (const slot of ["pdf", "hwp", "hwpx"] as Slot[]) {
        const f = files[slot];
        if (f) form.append(slot, f);
      }
      for (const f of attaches) form.append("attach", f);
      const res = await fetch("/api/letters/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "등록 실패");
      if (data.skipped) {
        alert(`이미 등록된 공문번호입니다(${no}).`);
        return;
      }
      alert(`공문 ${no} 을(를) 대장에 등록했습니다.`);
      onSaved();
      onClose();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }, [letterNo, title, letterKind, issueDate, drafterName, recipients, ccRefs, files, attaches, check, onSaved, onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    // 포털 모달 — .cdash 밖이라 cdash-vars + cd-fields-white + data-theme 부여(UI 규칙)
    <div
      className="cdash-vars cd-fields-white fixed inset-0 z-[85] flex items-center justify-center p-4"
      data-theme={theme}
      style={{ background: "rgba(15,20,34,0.45)" }}
      onClick={onClose}
    >
      <div
        className="cd-card rounded-3xl w-full max-w-[860px] max-h-[90vh] overflow-y-auto flex flex-col gap-4 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <h3 className="text-[15px] font-bold cd-text">공문 이관 등록</h3>
          <span className="text-[11px] cd-text-faint">앱 밖에서 발송된 공문을 대장에 올립니다(결번 메우기).</span>
          <button type="button" className="ml-auto cd-text-faint hover:cd-text" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-2.5">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] cd-text-faint">공문번호 *</span>
            <input className="cd-input font-mono" placeholder="2026-대외-01034" value={letterNo} onChange={(e) => setLetterNo(e.target.value)} />
            {letterNo.trim() && !LETTER_NO_RE.test(letterNo.trim()) ? (
              <span className="text-[10.5px]" style={{ color: "var(--cd-danger, #FA896B)" }}>형식: 2026-대외-01034</span>
            ) : check == null ? null : check.available ? (
              <span className="text-[10.5px]" style={{ color: "var(--cd-success, #13DEB9)" }}>등록 가능한 번호입니다</span>
            ) : (
              <span className="text-[10.5px]" style={{ color: "var(--cd-danger, #FA896B)" }}>이미 사용 중 — {check.usedBy}</span>
            )}
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <span className="text-[11px] cd-text-faint">제목 *</span>
            <input className="cd-input" placeholder="공문 제목" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] cd-text-faint">시행일</span>
            <input className="cd-input font-mono" placeholder="2026-08-19" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] cd-text-faint">기안자</span>
            <input className="cd-input" placeholder="성명" value={drafterName} onChange={(e) => setDrafterName(e.target.value)} />
          </div>
          <div className="flex items-end gap-3 md:col-span-3">
            <span className="text-[11px] cd-text-faint pb-2">유형</span>
            {(
              [
                ["general", "일반"],
                ["proof", "내용증명"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5 text-[12.5px] cd-text cursor-pointer pb-1.5">
                <input type="radio" name="importLetterKind" checked={letterKind === k} onChange={() => setLetterKind(k)} /> {label}
              </label>
            ))}
          </div>
        </div>

        <RecipientEditGrid label="수신처(업체/기관)" list={recipients} onChange={setRecipients} />
        <RecipientEditGrid label="참조(담당자)" list={ccRefs} onChange={setCcRefs} />

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold cd-text">원본 파일</span>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {(["pdf", "hwp", "hwpx"] as Slot[]).map((slot) => (
              <FileSlot key={slot} slot={slot} file={files[slot]} onPick={(f) => setFiles((prev) => ({ ...prev, [slot]: f }))} />
            ))}
          </div>
          <label className="flex items-center gap-2 rounded-xl border border-dashed cd-border-c px-3 py-2 cursor-pointer">
            <Paperclip className="w-3.5 h-3.5 cd-text-faint shrink-0" />
            <span className="text-[11px] cd-text-faint shrink-0">동봉 첨부(복수)</span>
            <span className="text-[11.5px] cd-text truncate">{attaches.length ? attaches.map((f) => f.name).join(", ") : "선택"}</span>
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => setAttaches((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
            />
          </label>
          {attaches.length > 0 && (
            <button type="button" className="self-start text-[11px] cd-text-faint hover:cd-text" onClick={() => setAttaches([])}>
              첨부 비우기
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <span className="text-[10.5px] cd-text-faint">
            등록 후에는 목록에서 수신처·메일주소를 보완할 수 있습니다. 잘못 등록하면 상세에서 삭제하세요.
          </span>
          <button type="button" className="ml-auto cd-btn rounded-lg border cd-border-c px-3 py-2 text-xs" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-50"
            disabled={busy}
            onClick={save}
          >
            {busy ? "등록 중..." : "대장에 등록"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
