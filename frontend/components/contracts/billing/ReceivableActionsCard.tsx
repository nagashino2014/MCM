"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  FileUp,
  FileX2,
  Gavel,
  LifeBuoy,
  MailWarning,
  Megaphone,
  Paperclip,
  Pencil,
  Plus,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import type { ContractReceivableRow, ReceivableAction, ReceivableActionType } from "@/lib/ieps/receivables-types";
import { DEBT_COLLECTION_STAGES } from "@/lib/ieps/receivables-types";
import { CATEGORY_META } from "@/components/contracts/dashboard/types";
import { AutoDateInput } from "@/components/ui/AutoDateInput";

const ACTION_META: Record<
  ReceivableActionType,
  {
    label: string;
    dateLabel: string;
    noteLabel: string;
    icon: LucideIcon;
    /** 증빙 서류 첨부 지원 여부 */
    hasDocs: boolean;
    /** 진행 단계 텍스트 입력란 (회생 절차) */
    hasStageField: boolean;
  }
> = {
  verbal_dunning: {
    label: "구두 독촉",
    dateLabel: "독촉일",
    noteLabel: "진행 경과",
    icon: Megaphone,
    hasDocs: false,
    hasStageField: false,
  },
  content_proof: {
    label: "내용 증명 발송",
    dateLabel: "내용 증명 발송일",
    noteLabel: "진행 경과",
    icon: MailWarning,
    hasDocs: true,
    hasStageField: false,
  },
  debt_collection: {
    label: "채권 추심 진행",
    dateLabel: "가압류 신청일",
    noteLabel: "진행 경과",
    icon: Gavel,
    hasDocs: true,
    hasStageField: false,
  },
  rehabilitation: {
    label: "회생 절차 진행",
    dateLabel: "일자",
    noteLabel: "진행 경과",
    icon: LifeBuoy,
    hasDocs: true,
    hasStageField: true,
  },
  debt_waiver: {
    label: "채권 포기",
    dateLabel: "채권 포기일",
    noteLabel: "채권 포기 사유",
    icon: FileX2,
    hasDocs: false,
    hasStageField: false,
  },
};

/**
 * 장기 미수금 대응 조치 카드 — 선택된 장기 미수금 건에 대해
 * 구두 독촉 / 내용 증명 발송 / 채권 추심 진행 / 회생 절차 진행 / 채권 포기
 * 이력을 입력·수정한다.
 */
export function ReceivableActionsCard({
  selected,
  onActionsChanged,
}: {
  selected: ContractReceivableRow | null;
  onActionsChanged: () => void;
}) {
  const [actionType, setActionType] = useState<ReceivableActionType>("verbal_dunning");
  const [actions, setActions] = useState<ReceivableAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 입력 폼 상태 (신규 등록 / 기존 항목 수정 공용)
  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [formDate, setFormDate] = useState("");
  const [formNote, setFormNote] = useState("");
  const [formStage, setFormStage] = useState("");
  const [formStageDates, setFormStageDates] = useState<Record<string, string>>({});
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  // 기존 이력에 대한 직접 업로드 (리스트의 업로드 아이콘)
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const uploadTargetRef = useRef<string | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  // 입력 폼의 "증빙 서류 첨부" 버튼용
  const attachInputRef = useRef<HTMLInputElement | null>(null);

  const resetForm = useCallback(() => {
    setEditingActionId(null);
    setFormDate("");
    setFormNote("");
    setFormStage("");
    setFormStageDates({});
    setPendingFiles([]);
  }, []);

  const reload = useCallback(async () => {
    if (!selected) {
      setActions([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/contracts/billing/receivables/actions?milestoneId=${encodeURIComponent(selected.milestoneId)}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error((json as { error?: string })?.error ?? "HTTP " + res.status);
      }
      const json = (await res.json()) as { actions: ReceivableAction[] };
      setActions(json.actions ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    resetForm();
    void reload();
  }, [reload, resetForm]);

  useEffect(() => {
    resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionType]);

  const entries = actions.filter((a) => a.actionType === actionType);
  const meta = ACTION_META[actionType];
  const isDebt = actionType === "debt_collection";
  // 채권 추심은 건당 1개의 진행 이력만 유지한다 (단계별 일자를 한 항목에 기록)
  const debtEntry = isDebt ? entries[0] ?? null : null;

  // 채권 추심 항목이 존재하면 폼에 미리 채워 바로 수정 가능하게 한다
  useEffect(() => {
    if (!isDebt) return;
    if (debtEntry) {
      setEditingActionId(debtEntry.actionId);
      setFormDate(debtEntry.stageDates?.[DEBT_COLLECTION_STAGES[0]] ?? debtEntry.actionDate ?? "");
      setFormNote(debtEntry.progressNote);
      setFormStageDates(debtEntry.stageDates ?? {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDebt, debtEntry?.actionId]);

  const beginEdit = (entry: ReceivableAction) => {
    setEditingActionId(entry.actionId);
    setFormDate(entry.actionDate ?? "");
    setFormNote(entry.progressNote);
    setFormStage(entry.progressStage ?? "");
    setFormStageDates(entry.stageDates ?? {});
    setPendingFiles([]);
  };

  const uploadFileTo = async (actionId: string, file: File) => {
    const form = new FormData();
    form.set("file", file);
    const res = await fetch(
      `/api/contracts/billing/receivables/actions/${encodeURIComponent(actionId)}/documents`,
      { method: "POST", body: form }
    );
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error((json as { error?: string })?.error ?? "서류 업로드 실패 (HTTP " + res.status + ")");
    }
  };

  const submit = async () => {
    if (!selected) return;
    if (!formDate) {
      setError(`${meta.dateLabel}을 입력해 주세요.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const stageDates = isDebt
        ? { ...formStageDates, ...(formDate ? { [DEBT_COLLECTION_STAGES[0]]: formDate } : {}) }
        : null;
      const payload = {
        actionDate: formDate || null,
        progressNote: formNote,
        progressStage: meta.hasStageField ? formStage.trim() || null : null,
        stageDates,
      };
      let actionId = editingActionId;
      if (editingActionId) {
        const res = await fetch(`/api/contracts/billing/receivables/actions/${encodeURIComponent(editingActionId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("저장 실패 (HTTP " + res.status + ")");
      } else {
        const res = await fetch("/api/contracts/billing/receivables/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contractId: selected.contractId,
            milestoneId: selected.milestoneId,
            actionType,
            ...payload,
          }),
        });
        if (!res.ok) throw new Error("등록 실패 (HTTP " + res.status + ")");
        const json = (await res.json()) as { actionId?: string };
        actionId = json.actionId ?? null;
      }
      // 첨부 대기 중인 증빙 서류 업로드
      if (meta.hasDocs && actionId && pendingFiles.length > 0) {
        for (const file of pendingFiles) {
          await uploadFileTo(actionId, file);
        }
      }
      resetForm();
      await reload();
      onActionsChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry: ReceivableAction) => {
    if (!window.confirm(`${ACTION_META[entry.actionType].label} 이력을 삭제할까요?`)) return;
    try {
      const res = await fetch(`/api/contracts/billing/receivables/actions/${encodeURIComponent(entry.actionId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("삭제 실패 (HTTP " + res.status + ")");
      if (editingActionId === entry.actionId) resetForm();
      await reload();
      onActionsChanged();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const requestUpload = (actionId: string) => {
    uploadTargetRef.current = actionId;
    uploadInputRef.current?.click();
  };

  const handleUploadFile = async (file: File | null) => {
    const actionId = uploadTargetRef.current;
    uploadTargetRef.current = null;
    if (!file || !actionId) return;
    setUploading(actionId);
    setError(null);
    try {
      await uploadFileTo(actionId, file);
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(null);
    }
  };

  const docLinks = (entry: ReceivableAction) =>
    entry.documents.length > 0 && (
      <div className="flex flex-col gap-1">
        {entry.documents.map((doc) => (
          <a
            key={doc.documentId}
            href={doc.publicPath ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] font-bold hover:underline"
            style={{ color: "var(--cd-primary)" }}
          >
            <Paperclip className="w-3 h-3 shrink-0" />
            <span className="truncate">{doc.fileName}</span>
          </a>
        ))}
      </div>
    );

  /** 입력 폼의 "증빙 서류 첨부" 버튼 + 선택된 파일 목록 */
  const attachControls = meta.hasDocs && (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="cd-chip cd-chip-sm inline-flex items-center gap-1"
          onClick={() => attachInputRef.current?.click()}
        >
          <Paperclip className="w-3 h-3" />
          증빙 서류 첨부
        </button>
        <span className="text-[10px]" style={{ color: "var(--cd-faint)" }}>
          내용 증명 공문, 법원 결정문, 회생절차 통지문 등 (20MB 이하)
        </span>
      </div>
      {pendingFiles.length > 0 && (
        <div className="flex flex-col gap-1">
          {pendingFiles.map((file, idx) => (
            <span
              key={`${file.name}-${idx}`}
              className="inline-flex items-center gap-1.5 text-[11px] font-bold"
              style={{ color: "var(--cd-muted)" }}
            >
              <Paperclip className="w-3 h-3 shrink-0" />
              <span className="truncate">{file.name}</span>
              <button
                type="button"
                className="inline-flex items-center justify-center w-4 h-4 rounded"
                style={{ color: "#FF7575" }}
                title="첨부 취소"
                onClick={() => setPendingFiles((prev) => prev.filter((_, i) => i !== idx))}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="cdb-box p-4">
      <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
        <p className="cd-card-title">
          <span className="cd-title-icon">
            <ShieldAlert className="w-4 h-4" />
          </span>
          장기 미수금 대응 조치
        </p>
        {selected && (
          <span className="text-[11px] font-bold truncate max-w-[55%]" style={{ color: "var(--cd-faint)" }}>
            <span
              className="inline-block w-1.5 h-1.5 rounded-full mr-1 align-middle"
              style={{ background: CATEGORY_META[selected.category]?.color ?? "var(--cd-faint)" }}
            />
            {selected.contractTitle}
          </span>
        )}
      </div>

      {!selected ? (
        <p className="py-8 text-center text-xs" style={{ color: "var(--cd-faint)" }}>
          위 장기 미수금 리스트에서 대응 조치를 입력할 건을 선택하세요.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* 숨김 파일 입력 — 기존 이력 직접 업로드용 */}
          <input
            ref={uploadInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              void handleUploadFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          {/* 숨김 파일 입력 — 입력 폼 첨부용 (복수 선택 가능) */}
          <input
            ref={attachInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) setPendingFiles((prev) => [...prev, ...files]);
              e.target.value = "";
            }}
          />

          {/* 옵션 박스 묶음 (5열 1행) */}
          <div className="grid grid-cols-5 gap-2">
            {(Object.keys(ACTION_META) as ReceivableActionType[]).map((type) => {
              const m = ACTION_META[type];
              const Icon = m.icon;
              const count = actions.filter((a) => a.actionType === type).length;
              return (
                <button
                  key={type}
                  type="button"
                  className="cdb-option-box"
                  data-active={actionType === type}
                  onClick={() => setActionType(type)}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {m.label}
                  {count > 0 && <span className="tabular-nums opacity-80">({count})</span>}
                </button>
              );
            })}
          </div>

          {error && (
            <p
              className="text-[11px] font-bold px-3 py-2 rounded-lg"
              style={{ background: "var(--cd-error-soft, rgba(250,137,107,0.14))", color: "var(--cd-error, #fa896b)" }}
            >
              {error}
            </p>
          )}

          {/* 기존 이력 리스트 (채권 추심 외 유형) */}
          {!isDebt && (
            <div className="flex flex-col gap-2 max-h-[180px] overflow-y-auto scrollbar-hide">
              {loading ? (
                <p className="py-3 text-center text-xs animate-pulse" style={{ color: "var(--cd-faint)" }}>
                  이력을 불러오는 중…
                </p>
              ) : entries.length === 0 ? (
                <p className="py-3 text-center text-xs" style={{ color: "var(--cd-faint)" }}>
                  등록된 {meta.label} 이력이 없습니다.
                </p>
              ) : (
                entries.map((entry) => (
                  <div key={entry.actionId} className="cdb-action-entry">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-extrabold tabular-nums" style={{ color: "var(--cd-text)" }}>
                        {entry.actionDate ?? "일자 미입력"}
                      </span>
                      {entry.progressStage && (
                        <span
                          className="text-[10px] font-extrabold px-2 py-0.5 rounded-md"
                          style={{ background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }}
                        >
                          {entry.progressStage}
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-1">
                        {meta.hasDocs && (
                          <button
                            type="button"
                            className="inline-flex items-center justify-center w-6 h-6 rounded-md"
                            style={{ color: "var(--cd-muted)" }}
                            title="증빙 서류 업로드"
                            disabled={uploading === entry.actionId}
                            onClick={() => requestUpload(entry.actionId)}
                          >
                            <FileUp className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          className="inline-flex items-center justify-center w-6 h-6 rounded-md"
                          style={{ color: "var(--cd-muted)" }}
                          title="수정"
                          onClick={() => beginEdit(entry)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center w-6 h-6 rounded-md"
                          style={{ color: "#FF7575" }}
                          title="삭제"
                          onClick={() => void remove(entry)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    </div>
                    {entry.progressNote && (
                      <p className="text-[11px] leading-relaxed whitespace-pre-wrap" style={{ color: "var(--cd-muted)" }}>
                        {entry.progressNote}
                      </p>
                    )}
                    {docLinks(entry)}
                  </div>
                ))
              )}
            </div>
          )}

          {/* 입력 폼 (채권 추심 외 유형) */}
          {!isDebt && (
            <div className="cdb-action-entry">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-extrabold" style={{ color: "var(--cd-muted)" }}>
                  {editingActionId ? `${meta.label} 수정` : `${meta.label} 추가`}
                </span>
                {editingActionId && (
                  <button type="button" className="cd-chip cd-chip-sm ml-auto" onClick={resetForm}>
                    신규 입력으로 전환
                  </button>
                )}
              </div>
              <div
                className={
                  meta.hasStageField
                    ? "grid grid-cols-[150px_150px_minmax(0,1fr)] gap-2 items-start"
                    : "grid grid-cols-[150px_minmax(0,1fr)] gap-2 items-start"
                }
              >
                <label className="grid gap-1">
                  <span className="text-[10px] font-extrabold" style={{ color: "var(--cd-faint)" }}>
                    {meta.dateLabel}
                  </span>
                  <AutoDateInput className="cd-input" value={formDate} onChange={setFormDate} />
                </label>
                {meta.hasStageField && (
                  <label className="grid gap-1">
                    <span className="text-[10px] font-extrabold" style={{ color: "var(--cd-faint)" }}>
                      진행 단계
                    </span>
                    <input
                      type="text"
                      className="cd-input"
                      maxLength={12}
                      placeholder="예: 회생 개시 결정"
                      value={formStage}
                      onChange={(e) => setFormStage(e.target.value)}
                    />
                  </label>
                )}
                <label className="grid gap-1">
                  <span className="text-[10px] font-extrabold" style={{ color: "var(--cd-faint)" }}>
                    {meta.noteLabel}
                  </span>
                  <textarea
                    className="cd-input min-h-[58px]"
                    placeholder={`${meta.noteLabel}를 입력하세요`}
                    value={formNote}
                    onChange={(e) => setFormNote(e.target.value)}
                  />
                </label>
              </div>
              {attachControls}
              <div className="flex justify-end">
                <button
                  type="button"
                  className="cd-chip cd-chip-sm inline-flex items-center gap-1"
                  data-active="true"
                  disabled={saving}
                  onClick={() => void submit()}
                >
                  <Plus className="w-3 h-3" />
                  {saving ? "저장 중…" : editingActionId ? "수정 저장" : "이력 추가"}
                </button>
              </div>
            </div>
          )}

          {/* 채권 추심 진행 (단계 세분화 입력) */}
          {isDebt && (
            <div className="cdb-action-entry">
              {loading ? (
                <p className="py-3 text-center text-xs animate-pulse" style={{ color: "var(--cd-faint)" }}>
                  이력을 불러오는 중…
                </p>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-extrabold" style={{ color: "var(--cd-muted)" }}>
                      {debtEntry ? "채권 추심 진행 현황" : "채권 추심 진행 등록"}
                    </span>
                    {debtEntry && (
                      <span className="ml-auto flex items-center gap-1">
                        <button
                          type="button"
                          className="inline-flex items-center justify-center w-6 h-6 rounded-md"
                          style={{ color: "var(--cd-muted)" }}
                          title="증빙 서류 업로드"
                          disabled={uploading === debtEntry.actionId}
                          onClick={() => requestUpload(debtEntry.actionId)}
                        >
                          <FileUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center justify-center w-6 h-6 rounded-md"
                          style={{ color: "#FF7575" }}
                          title="삭제"
                          onClick={() => void remove(debtEntry)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    )}
                  </div>

                  {/* 단계별 일자 입력 */}
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {DEBT_COLLECTION_STAGES.map((stage, idx) => (
                      <label key={stage} className="grid gap-1">
                        <span className="text-[10px] font-extrabold" style={{ color: "var(--cd-faint)" }}>
                          {stage}
                          {idx === 0 ? " (신청일)" : ""}
                        </span>
                        <AutoDateInput
                          className="cd-input"
                          value={idx === 0 ? formDate : formStageDates[stage] ?? ""}
                          onChange={(next) => {
                            if (idx === 0) setFormDate(next);
                            else setFormStageDates((prev) => ({ ...prev, [stage]: next }));
                          }}
                        />
                      </label>
                    ))}
                  </div>

                  <label className="grid gap-1">
                    <span className="text-[10px] font-extrabold" style={{ color: "var(--cd-faint)" }}>
                      진행 경과
                    </span>
                    <textarea
                      className="cd-input min-h-[58px]"
                      placeholder="채권 추심 진행 경과를 입력하세요"
                      value={formNote}
                      onChange={(e) => setFormNote(e.target.value)}
                    />
                  </label>

                  {attachControls}
                  {debtEntry && docLinks(debtEntry)}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      className="cd-chip cd-chip-sm"
                      data-active="true"
                      disabled={saving}
                      onClick={() => void submit()}
                    >
                      {saving ? "저장 중…" : debtEntry ? "변경사항 저장" : "등록"}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
