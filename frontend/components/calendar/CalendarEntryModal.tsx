"use client";

// 회의·면접·미팅 일정 등록/편집/상세 모달(219).
// - 회의: 회의명·일시(부터~까지)·장소·참석자. 정기 occurrence 는 "미시행" 토글로 취소·복구.
// - 면접: 면접자 성명·채용 공고·일시·장소·참석자 + 이력서 PDF(등록 후 첨부, 참석자는 뷰어/다운로드).
// - 미팅: 방문자·관련 업무(용역 검색 또는 자유 입력)·일시·장소·참석자.
// canEdit=false 면 읽기 전용 상세.

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Eye, FileText, Search, Trash2, Upload, X } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdButton } from "@/components/cdash/CdButton";
import { CdCheckbox, CdDateInput, CdInput, CdSelect, CdTextarea } from "@/components/cdash/CdField";
import { useCdToast } from "@/components/cdash/CdToast";
import { AttendeePicker } from "@/components/calendar/AttendeePicker";
import {
  CALENDAR_ENTRY_KIND_LABELS,
  type CalendarAccess,
  type CalendarEntry,
  type CalendarEntryInput,
  type CalendarEntryKind,
  type CalendarPerson,
} from "@/lib/calendar/types";

/** HH:mm 입력 — 숫자 4자리를 이어 치면 콜론이 붙는다(CdDateInput 과 같은 손맛). */
export function formatTimeDigits(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
}

function TimeInput({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <CdInput
      label={label}
      value={value}
      inputMode="numeric"
      placeholder="HH:MM"
      disabled={disabled}
      onChange={(e) => onChange(formatTimeDigits(e.target.value))}
      className="w-full"
    />
  );
}

interface ContractOption {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
}

export function CalendarEntryModal({
  open,
  kind,
  date,
  entry,
  access,
  onClose,
  onSaved,
}: {
  open: boolean;
  kind: CalendarEntryKind;
  /** 신규 등록 날짜 */
  date: string;
  /** 편집·상세 대상(없으면 신규) */
  entry: CalendarEntry | null;
  access: CalendarAccess;
  onClose: () => void;
  /** 저장·삭제 후(부모가 재조회) */
  onSaved: () => void;
}) {
  const { toast } = useCdToast();
  const editable = entry ? entry.canEdit : kind === "meeting" ? access.meeting : kind === "interview" ? access.interview : true;
  const [title, setTitle] = useState("");
  const [d, setD] = useState(date);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [location, setLocation] = useState("");
  const [attendees, setAttendees] = useState<CalendarPerson[]>([]);
  const [note, setNote] = useState("");
  const [canceled, setCanceled] = useState(false);
  // 면접
  const [candidateName, setCandidateName] = useState("");
  const [postingId, setPostingId] = useState("");
  const [postingTitle, setPostingTitle] = useState("");
  const [postings, setPostings] = useState<{ postingId: string; title: string }[]>([]);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeView, setResumeView] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // 미팅
  const [visitors, setVisitors] = useState("");
  const [contractId, setContractId] = useState<string | null>(null);
  const [contractTitle, setContractTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [contractQ, setContractQ] = useState("");
  const [contractOpts, setContractOpts] = useState<ContractOption[]>([]);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 열 때 초기화
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    setResumeFile(null);
    setResumeView(false);
    setContractQ("");
    setContractOpts([]);
    if (entry) {
      setTitle(entry.title);
      setD(entry.date);
      setStartTime(entry.startTime ?? "");
      setEndTime(entry.endTime ?? "");
      setLocation(entry.location ?? "");
      setAttendees(entry.attendees);
      setNote(entry.note ?? "");
      setCanceled(entry.isCanceled);
      setCandidateName(entry.extra.candidateName ?? "");
      setPostingId(entry.extra.postingId ?? "");
      setPostingTitle(entry.extra.postingTitle ?? "");
      setVisitors(entry.extra.visitors ?? "");
      setContractId(entry.extra.contractId ?? null);
      setContractTitle(entry.extra.contractTitle ?? "");
      setTopic(entry.extra.topic ?? "");
    } else {
      setTitle(kind === "meeting" ? "" : "");
      setD(date);
      setStartTime("09:00");
      setEndTime("10:00");
      setLocation(kind === "meeting" ? "회의실" : "");
      setAttendees([]);
      setNote("");
      setCanceled(false);
      setCandidateName("");
      setPostingId("");
      setPostingTitle("");
      setVisitors("");
      setContractId(null);
      setContractTitle("");
      setTopic("");
    }
  }, [open, entry, kind, date]);

  // 면접 — 채용공고 목록(면접 관리자만 조회 가능)
  useEffect(() => {
    if (!open || kind !== "interview" || !editable) return;
    fetch("/api/calendar/postings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setPostings(d.postings ?? []))
      .catch(() => {});
  }, [open, kind, editable]);

  // 미팅 — 용역(계약) 검색(2자 이상, 디바운스)
  useEffect(() => {
    if (kind !== "visit" || contractQ.trim().length < 2) {
      setContractOpts([]);
      return;
    }
    const t = window.setTimeout(() => {
      fetch(`/api/contracts?q=${encodeURIComponent(contractQ.trim())}&limit=15`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setContractOpts(Array.isArray(d?.items) ? d.items : []))
        .catch(() => setContractOpts([]));
    }, 160);
    return () => window.clearTimeout(t);
  }, [kind, contractQ]);

  const heading = useMemo(() => {
    const k = CALENDAR_ENTRY_KIND_LABELS[kind];
    if (!entry) return `${k} 일정 등록`;
    return editable ? `${k} 일정 편집` : `${k} 일정`;
  }, [kind, entry, editable]);

  const uploadResume = async (entryId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file, file.name);
    const res = await fetch(`/api/calendar/entries/${encodeURIComponent(entryId)}/resume`, { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? "이력서 업로드에 실패했습니다.");
  };

  const save = async () => {
    if (!editable) return;
    const input: CalendarEntryInput = {
      kind,
      title: title.trim(),
      date: d,
      startTime: startTime || null,
      endTime: endTime || null,
      location: location.trim() || null,
      attendeeIds: attendees.map((p) => p.employeeId),
      note: note.trim() || null,
      extra:
        kind === "interview"
          ? { candidateName: candidateName.trim(), postingId: postingId || null, postingTitle: postingTitle.trim() }
          : kind === "visit"
            ? { visitors: visitors.trim(), contractId, contractTitle: contractTitle.trim(), topic: topic.trim() }
            : {},
      isCanceled: entry?.ruleId ? canceled : undefined,
    };
    setBusy("save");
    try {
      const res = await fetch(entry ? `/api/calendar/entries/${encodeURIComponent(entry.entryId)}` : "/api/calendar/entries", {
        method: entry ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "저장에 실패했습니다.");
      const saved = data.entry as CalendarEntry;
      if (kind === "interview" && resumeFile) {
        try {
          await uploadResume(saved.entryId, resumeFile);
        } catch (err) {
          toast(`일정은 저장됐지만 ${(err as Error).message}`, "warn");
          onSaved();
          onClose();
          return;
        }
      }
      toast(entry ? "일정을 수정했습니다." : "일정을 등록했습니다.", "success");
      onSaved();
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!entry) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/calendar/entries/${encodeURIComponent(entry.entryId)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "삭제에 실패했습니다.");
      toast(data.canceled ? "정기 회의를 미시행으로 표시했습니다." : "일정을 삭제했습니다.", "success");
      onSaved();
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  const removeResume = async () => {
    if (!entry) return;
    try {
      const res = await fetch(`/api/calendar/entries/${encodeURIComponent(entry.entryId)}/resume`, { method: "DELETE" });
      if (!res.ok) throw new Error("이력서 삭제에 실패했습니다.");
      toast("이력서를 삭제했습니다.", "success");
      onSaved();
      onClose();
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  const resumeUrl = entry ? `/api/calendar/entries/${encodeURIComponent(entry.entryId)}/resume` : "";
  const ro = !editable;

  return (
    <CdModal
      open={open}
      onClose={onClose}
      title={heading}
      size="lg"
      closeOnBackdrop={false}
      footer={
        <div className="flex items-center gap-2 w-full">
          {entry && editable && (
            confirmDelete ? (
              <>
                <span className="text-[12px] cd-error-text">{entry.ruleId ? "이 회차를 미시행으로 표시할까요?" : "정말 삭제할까요?"}</span>
                <CdButton size="sm" variant="danger" loading={busy === "delete"} onClick={remove}>
                  {entry.ruleId ? "미시행 처리" : "삭제"}
                </CdButton>
                <CdButton size="sm" onClick={() => setConfirmDelete(false)}>취소</CdButton>
              </>
            ) : (
              <CdButton size="sm" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => setConfirmDelete(true)}>
                {entry.ruleId ? "미시행" : "삭제"}
              </CdButton>
            )
          )}
          <span className="flex-1" />
          <CdButton size="sm" onClick={onClose}>{ro ? "닫기" : "취소"}</CdButton>
          {editable && (
            <CdButton size="sm" variant="primary" loading={busy === "save"} onClick={save}>
              {entry ? "저장" : "등록"}
            </CdButton>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {entry?.ruleId && (
          <div className="flex items-center gap-2 rounded-xl border cd-line-c px-3 py-2 text-[12px] cd-text-muted">
            정기 회의 회차입니다{entry.isModified ? " (조정됨)" : ""}. 날짜·시간을 바꾸면 이 회차만 조정됩니다.
            {editable && (
              <label className="ml-auto flex items-center gap-1.5 cursor-pointer">
                <CdCheckbox checked={canceled} onChange={(e) => setCanceled(e.target.checked)} />
                <span className="font-bold">미시행</span>
              </label>
            )}
          </div>
        )}

        {/* 종류별 식별 필드 */}
        {kind === "meeting" && (
          <CdInput label="회의명" required value={title} disabled={ro} onChange={(e) => setTitle(e.target.value)} placeholder="주간회의 / 간부간담회 / 임시회의" list="calendar-meeting-names" />
        )}
        {kind === "meeting" && (
          <datalist id="calendar-meeting-names">
            <option value="주간회의" />
            <option value="간부간담회" />
          </datalist>
        )}
        {kind === "interview" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <CdInput label="면접자 성명" required value={candidateName} disabled={ro} onChange={(e) => setCandidateName(e.target.value)} />
            {ro ? (
              <CdInput label="채용 공고" value={postingTitle || "-"} disabled />
            ) : postings.length ? (
              <CdSelect
                label="채용 공고"
                value={postingId}
                onChange={(e) => {
                  const id = e.target.value;
                  setPostingId(id);
                  setPostingTitle(postings.find((p) => p.postingId === id)?.title ?? postingTitle);
                }}
              >
                <option value="">직접 입력</option>
                {postings.map((p) => (
                  <option key={p.postingId} value={p.postingId}>{p.title}</option>
                ))}
              </CdSelect>
            ) : null}
            {!ro && !postingId && (
              <CdInput label={postings.length ? "채용 공고명(직접 입력)" : "채용 공고명"} value={postingTitle} onChange={(e) => setPostingTitle(e.target.value)} className="sm:col-span-2" />
            )}
          </div>
        )}
        {kind === "visit" && (
          <>
            <CdInput label="방문자" required value={visitors} disabled={ro} onChange={(e) => setVisitors(e.target.value)} placeholder="예: ○○산업 김○○ 팀장 외 2명" />
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-bold cd-text-muted">관련 업무</span>
              {contractId ? (
                <div className="flex items-center gap-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--cd-primary)", background: "var(--cd-primary-soft)" }}>
                  <FileText className="w-4 h-4 shrink-0" style={{ color: "var(--cd-primary)" }} />
                  <span className="flex-1 min-w-0 text-[13px] font-bold cd-text truncate">{contractTitle}</span>
                  {!ro && (
                    <button type="button" className="p-1 cd-text-faint hover:cd-error-text" onClick={() => { setContractId(null); setContractTitle(""); }} aria-label="용역 선택 해제">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ) : ro ? (
                <CdInput value={topic || contractTitle || "-"} disabled />
              ) : (
                <>
                  <div className="relative">
                    <CdInput value={contractQ} onChange={(e) => setContractQ(e.target.value)} placeholder="용역명으로 검색(2자 이상)…" />
                    <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 cd-text-faint" />
                    {contractOpts.length > 0 && (
                      <div className="absolute left-0 right-0 z-20 mt-1 max-h-52 overflow-y-auto rounded-xl border cd-line-c cd-card-bg" style={{ boxShadow: "0 12px 32px rgba(30,42,55,.16)" }}>
                        {contractOpts.map((c) => (
                          <button
                            key={c.contractId}
                            type="button"
                            className="w-full text-left px-3 py-2 text-[12.5px] cd-row-hover"
                            onClick={() => {
                              setContractId(c.contractId);
                              setContractTitle(c.contractTitle);
                              setContractQ("");
                              setContractOpts([]);
                            }}
                          >
                            <span className="block font-bold cd-text truncate">{c.contractTitle}</span>
                            {c.counterpartyName && <span className="block text-[11px] cd-text-faint truncate">{c.counterpartyName}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <CdInput value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="관련 용역이 없으면 업무 내용을 직접 입력" hint="용역을 고르거나, 없으면 자유 입력합니다." />
                </>
              )}
            </div>
          </>
        )}

        {/* 일시·장소 */}
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr] gap-3">
          <CdDateInput label={kind === "interview" ? "면접일" : kind === "visit" ? "미팅일" : "회의일"} required value={d} onChange={setD} disabled={ro} />
          <TimeInput label="시작" value={startTime} onChange={setStartTime} disabled={ro} />
          <TimeInput label="종료" value={endTime} onChange={setEndTime} disabled={ro} />
        </div>
        <CdInput label={kind === "interview" ? "면접장소" : kind === "visit" ? "미팅장소" : "회의장소"} value={location} disabled={ro} onChange={(e) => setLocation(e.target.value)} placeholder="회의실" />

        {/* 참석자 */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] font-bold cd-text-muted">참석자 <span className="font-medium cd-text-faint">(회사 직원 — 조직도에서 선택)</span></span>
          <AttendeePicker value={attendees} onChange={setAttendees} readOnly={ro} />
        </div>

        {/* 면접 이력서 */}
        {kind === "interview" && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] font-bold cd-text-muted">이력서(PDF)</span>
            {entry?.extra.resume ? (
              <div className="flex items-center gap-2 rounded-xl border cd-line-c px-3 py-2">
                <FileText className="w-4 h-4 shrink-0" style={{ color: "var(--cd-primary)" }} />
                <span className="flex-1 min-w-0 text-[13px] font-bold cd-text truncate" title={entry.extra.resume.fileName}>{entry.extra.resume.fileName}</span>
                <span className="text-[11px] cd-text-faint">{(entry.extra.resume.size / 1024 / 1024).toFixed(1)}MB</span>
                <CdButton size="sm" icon={<Eye className="w-3.5 h-3.5" />} onClick={() => setResumeView((v) => !v)}>{resumeView ? "닫기" : "보기"}</CdButton>
                <a className="cd-btn cd-btn-sm rounded-lg border cd-border-c px-2.5 py-1.5 text-xs flex items-center gap-1" href={`${resumeUrl}?disposition=attachment`} download>
                  <Download className="w-3.5 h-3.5" /> 다운로드
                </a>
                {editable && (
                  <button type="button" className="p-1 cd-text-faint hover:cd-error-text" onClick={removeResume} title="이력서 삭제">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <p className="text-[12px] cd-text-faint">{editable ? "첨부된 이력서가 없습니다." : "이력서가 없습니다."}</p>
            )}
            {resumeView && entry?.extra.resume && (
              <iframe title="이력서" src={resumeUrl} className="w-full rounded-xl border cd-line-c" style={{ height: "60vh", background: "#fff" }} />
            )}
            {editable && (
              <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)} />
                <CdButton size="sm" icon={<Upload className="w-3.5 h-3.5" />} onClick={() => fileRef.current?.click()}>
                  {entry?.extra.resume ? "이력서 교체" : "이력서 첨부"}
                </CdButton>
                {resumeFile && (
                  <span className="text-[12px] cd-text-muted truncate flex items-center gap-1">
                    {resumeFile.name}
                    <button type="button" className="p-0.5 cd-text-faint hover:cd-error-text" onClick={() => setResumeFile(null)} aria-label="선택 취소"><X className="w-3 h-3" /></button>
                  </span>
                )}
                <span className="text-[11px] cd-text-faint">{entry ? "저장 시 업로드됩니다." : "등록 후 자동 업로드됩니다."}</span>
              </div>
            )}
          </div>
        )}

        <CdTextarea label="비고" value={note} disabled={ro} onChange={(e) => setNote(e.target.value)} rows={2} />
      </div>
    </CdModal>
  );
}
