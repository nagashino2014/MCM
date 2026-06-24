"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Download, Paperclip, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import StructuredNoteEditor from "@/components/work-plan/StructuredNoteEditor";

const ISSUE_KINDS: { value: string; label: string }[] = [
  { value: "permit_condition", label: "허가조건 강화" },
  { value: "contact_change", label: "발주처/허가기관 담당자 변경" },
  { value: "accident", label: "사업장 사고 발생" },
  { value: "doc_missing", label: "중요 서류 누락" },
  { value: "schedule_delay", label: "일정 지연" },
  { value: "other", label: "기타" },
];
const kindLabel = (v: string) => ISSUE_KINDS.find((k) => k.value === v)?.label ?? "기타";

const SEVERITY: Record<string, { label: string; bg: string; fg: string }> = {
  info: { label: "정보", bg: "#E6F1FB", fg: "#0C447C" },
  warn: { label: "주의", bg: "#FAEEDA", fg: "#633806" },
  critical: { label: "심각", bg: "#FCEBEB", fg: "#791F1F" },
};

interface IssueAttachment {
  attachmentId: string;
  fileName: string;
  publicPath: string | null;
  byteSize: number | null;
  contentType: string | null;
}

interface IssueRow {
  issueId: string;
  issueKind: string;
  description: string | null;
  occurredOn: string | null;
  severity: string;
  responsePlan: string | null;
  status: string;
  attachments?: IssueAttachment[];
}

function fileSize(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export default function IssuePanel({ contractId, taskId, canRespond }: { contractId?: string; taskId?: string; canRespond?: boolean }) {
  const [issues, setIssues] = useState<IssueRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [issueKind, setIssueKind] = useState("");
  const [occurredOn, setOccurredOn] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // 용역(계약) XOR Task 이슈 — 베이스 URL 분기.
  const baseUrl = taskId ? `/api/work-tasks/${taskId}/issues` : `/api/contracts/${contractId}/issues`;

  const reload = useCallback(() => {
    fetch(baseUrl, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setIssues(d.issues ?? []))
      .catch(() => setIssues([]));
  }, [baseUrl]);
  useEffect(() => {
    reload();
  }, [reload]);

  const resetForm = () => {
    setDescription("");
    setOccurredOn("");
    setPendingFiles([]);
    setIssueKind("");
    setSeverity("");
    setAdding(false);
  };

  const addIssue = async () => {
    if (!description.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(baseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueKind: issueKind || "other", occurredOn: occurredOn || null, description: description.trim(), severity: severity || "warn" }),
      });
      const d = await res.json().catch(() => ({}));
      const issueId: string | undefined = d?.issueId;
      // 첨부파일 업로드(이슈 생성 후).
      if (issueId && pendingFiles.length) {
        for (const f of pendingFiles) {
          const fd = new FormData();
          fd.append("file", f);
          await fetch(`/api/work-plan/issues/${issueId}/attachments`, { method: "POST", body: fd }).catch(() => {});
        }
      }
      resetForm();
      reload();
    } finally {
      setSaving(false);
    }
  };

  const removeIssue = async (issueId: string) => {
    await fetch(`/api/work-plan/issues/${issueId}`, { method: "DELETE" });
    reload();
  };
  const removeAttachment = async (attachmentId: string) => {
    await fetch(`/api/work-plan/issue-attachments?attachmentId=${encodeURIComponent(attachmentId)}`, { method: "DELETE" });
    reload();
  };
  const saveResponse = async (issueId: string, plan: string, status: string) => {
    await fetch(`/api/work-plan/issues/${issueId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responsePlan: plan, status }),
    });
    reload();
  };

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) setPendingFiles((prev) => [...prev, ...files]);
    e.target.value = "";
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) setPendingFiles((prev) => [...prev, ...files]);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold cd-text flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 cd-error-text" /> 이슈 상황
          <span className="cd-text-faint font-normal">{issues.length}건</span>
        </span>
        <button type="button" onClick={() => setAdding((v) => !v)} className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[11px] cd-text-muted inline-flex items-center gap-1">
          <Plus className="w-3 h-3" /> 이슈 추가
        </button>
      </div>

      {adding && (
        <div className="rounded-2xl border cd-border-c p-3 mb-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* 좌측 1/3 — 유형/심각도/발생일 + 첨부 */}
            <div className="md:col-span-1 flex flex-col gap-2">
              <select className="cd-select text-xs w-full" value={issueKind} onChange={(e) => setIssueKind(e.target.value)}>
                <option value="" disabled>이슈 유형</option>
                {ISSUE_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
              <select className="cd-select text-xs w-full" value={severity} onChange={(e) => setSeverity(e.target.value)}>
                <option value="" disabled>심각도</option>
                <option value="info">정보</option>
                <option value="warn">주의</option>
                <option value="critical">심각</option>
              </select>
              <AutoDateInput className="cd-input text-xs w-full" placeholder="발생일" value={occurredOn} onChange={setOccurredOn} />

              {/* 첨부파일 리스트 박스 (드래그앤드롭 + 클릭 첨부) */}
              <input ref={fileRef} type="file" multiple className="hidden" onChange={onPickFiles} />
              <div
                role="button"
                onClick={() => fileRef.current?.click()}
                onDrop={onDrop}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                className={cn(
                  "flex-1 min-h-[120px] rounded-xl border border-dashed p-2 flex flex-col gap-1 overflow-y-auto cursor-pointer transition-colors",
                  dragOver ? "border-[color:var(--cd-primary)] cd-tint-primary" : "cd-border-c cd-row-hover"
                )}
              >
                {pendingFiles.length === 0 ? (
                  <div className="m-auto text-center">
                    <Paperclip className="w-4 h-4 cd-text-faint mx-auto mb-1" />
                    <p className="text-[11px] cd-text-faint">파일을 끌어다 놓거나 클릭하여 첨부</p>
                  </div>
                ) : (
                  pendingFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-[11px] cd-text" onClick={(e) => e.stopPropagation()}>
                      <Paperclip className="w-3 h-3 cd-text-faint shrink-0" />
                      <span className="truncate flex-1">{f.name}</span>
                      <span className="cd-text-faint shrink-0">{fileSize(f.size)}</span>
                      <button type="button" onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))} className="cd-text-faint hover:cd-error-text shrink-0">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 우측 2/3 — 라벨 + 기호버튼 + 상세 서술(하단 정렬) */}
            <div className="md:col-span-2 flex flex-col gap-1.5 min-h-0">
              <span className="text-[11px] font-semibold cd-text-faint">이슈 상세 서술</span>
              <StructuredNoteEditor value={description} onChange={setDescription} placeholder="이슈 상세 서술" fill />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button type="button" onClick={resetForm} className="cd-btn rounded-lg px-3 py-1.5 text-xs border cd-border-c cd-text-muted">취소</button>
            <button type="button" disabled={saving || !description.trim()} onClick={addIssue} className="rounded-lg px-3 py-1.5 text-xs text-white cd-fill-primary disabled:opacity-50">
              {saving ? "등록 중…" : "등록"}
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-2">
        {issues.length === 0 ? (
          <p className="text-[11px] cd-text-faint">보고된 이슈가 없습니다.</p>
        ) : (
          issues.map((iss) => {
            const sev = SEVERITY[iss.severity] ?? SEVERITY.warn;
            return (
              <div key={iss.issueId} className="rounded-xl border cd-border-c p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-2 py-0.5 rounded-md font-semibold" style={{ background: sev.bg, color: sev.fg }}>
                    {kindLabel(iss.issueKind)}
                  </span>
                  {iss.occurredOn && <span className="text-[10px] cd-text-faint">발생 {iss.occurredOn}</span>}
                  {iss.status === "resolved" && <span className="text-[10px] cd-text-primary">해결</span>}
                  <button type="button" onClick={() => removeIssue(iss.issueId)} className="ml-auto p-1 cd-text-faint hover:cd-error-text" title="삭제">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {iss.description && <p className="text-xs cd-text mt-1.5 leading-relaxed whitespace-pre-wrap">{iss.description}</p>}

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {(iss.attachments ?? []).map((a) => (
                    <span key={a.attachmentId} className="inline-flex items-center gap-1 text-[10px] rounded-md border cd-border-c px-1.5 py-0.5">
                      <Paperclip className="w-3 h-3 cd-text-faint" />
                      <a href={a.publicPath ?? "#"} target="_blank" rel="noreferrer" className="cd-text-primary hover:underline inline-flex items-center gap-1">
                        {a.fileName} <Download className="w-2.5 h-2.5" />
                      </a>
                      <span className="cd-text-faint">{fileSize(a.byteSize)}</span>
                      <button type="button" onClick={() => removeAttachment(a.attachmentId)} className="cd-text-faint hover:cd-error-text">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))}
                  <IssueAttachButton issueId={iss.issueId} onDone={reload} />
                </div>

                {iss.responsePlan && (
                  <p className="text-[11px] mt-2 pt-2 border-t cd-border-c cd-text-muted">
                    <span className="cd-text-primary font-semibold">대응방안</span> · {iss.responsePlan}
                  </p>
                )}
                {canRespond && (
                  <ResponseEditor
                    initial={iss.responsePlan ?? ""}
                    resolved={iss.status === "resolved"}
                    onSave={(plan, status) => saveResponse(iss.issueId, plan, status)}
                  />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// 기존 이슈 사후 첨부 — 파일 선택 시 즉시 업로드.
function IssueAttachButton({ issueId, onDone }: { issueId: string; onDone: () => void }) {
  const ref = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append("file", f);
        await fetch(`/api/work-plan/issues/${issueId}/attachments`, { method: "POST", body: fd }).catch(() => {});
      }
    } finally {
      setBusy(false);
      onDone();
    }
  };
  return (
    <>
      <input ref={ref} type="file" multiple className="hidden" onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; upload(f); }} />
      <button
        type="button"
        disabled={busy}
        onClick={() => ref.current?.click()}
        onDrop={(e) => { e.preventDefault(); upload(Array.from(e.dataTransfer.files ?? [])); }}
        onDragOver={(e) => e.preventDefault()}
        className="inline-flex items-center gap-1 text-[10px] rounded-md border border-dashed cd-border-c px-1.5 py-0.5 cd-text-muted cd-row-hover disabled:opacity-50"
      >
        <Paperclip className="w-3 h-3" /> {busy ? "업로드중…" : "첨부 추가"}
      </button>
    </>
  );
}

function ResponseEditor({
  initial,
  resolved,
  onSave,
}: {
  initial: string;
  resolved: boolean;
  onSave: (plan: string, status: string) => void;
}) {
  const [plan, setPlan] = useState(initial);
  return (
    <div className="mt-2 pt-2 border-t cd-border-c grid gap-1.5">
      <span className="text-[11px] font-semibold cd-error-text">부서장 대응방안</span>
      <textarea className="cd-input text-xs w-full min-h-[44px]" placeholder="총괄 책임자 대응방안" value={plan} onChange={(e) => setPlan(e.target.value)} />
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={() => onSave(plan, "in_progress")} className="cd-btn rounded-lg px-2.5 py-1 text-[11px] border cd-border-c cd-text-muted">대응방안 저장</button>
        <button type="button" onClick={() => onSave(plan, resolved ? "in_progress" : "resolved")} className={cn("rounded-lg px-2.5 py-1 text-[11px]", resolved ? "border cd-border-c cd-text-muted" : "cd-fill-primary text-white")}>
          {resolved ? "재오픈" : "해결 처리"}
        </button>
      </div>
    </div>
  );
}
