"use client";

// 결재 완료 문서 관리자 조치(346) — 문서 상세 뷰어(ApprovalDocViewer) 하단에 붙는다.
//   - 취소 기록 배너(취소 문서): 누가·언제·왜, 원래 번호(반납).
//   - 관리자 조치(결재 운영 권한 + 승인 문서): [결재 취소](사유 필수) · [값 수정](일자·시각·글 같은 간단한 항목, 사유 필수).
//   - 관리자 수정 이력: 문서를 볼 수 있는 사람 모두에게 보인다.
// 서버 규칙: lib/approval/admin-controls.ts · 고칠 수 있는 항목: lib/approval/admin-edit-rules.ts.

import { useMemo, useState } from "react";
import { Ban, History, PencilLine } from "lucide-react";
import { FieldInput } from "@/components/approval/ApprovalFormRenderer";
import { CdHelp } from "@/components/cdash/CdHelp";
import { adminEditableFields, adminValueText } from "@/lib/approval/admin-edit-rules";
import type { ApprovalFieldDef } from "@/lib/approval/fields";

export interface DocCancelInfoView {
  canceledAt: string | null;
  canceledByName: string | null;
  reason: string | null;
  canceledDocNo: string | null;
}

export interface DocAdminEditView {
  editId: string;
  fieldKey: string;
  fieldLabel: string | null;
  fieldType: string | null;
  beforeValue: unknown;
  afterValue: unknown;
  reason: string;
  editedByName: string | null;
  editedAt: string;
}

const short = (s: string | null) => (s ? s.slice(0, 16).replace("T", " ") : "-");

/** 취소된 문서 — 상단 고정 배너(반려 배너와 같은 자리·모양). */
export function CanceledDocBanner({ info }: { info: DocCancelInfoView | null | undefined }) {
  return (
    <div
      className="rounded-lg border px-3.5 py-2.5 flex flex-col gap-1"
      style={{ borderColor: "var(--cd-error)", background: "var(--cd-error-soft, rgba(250,137,107,0.1))" }}
    >
      <span className="text-[12px] font-semibold cd-error-text">
        결재 취소됨{info?.canceledByName ? ` — ${info.canceledByName}` : ""}
        {info?.canceledAt ? ` · ${short(info.canceledAt)}` : ""}
      </span>
      <p className="text-[13px] cd-text">{info?.reason?.trim() || "취소 사유가 기록되지 않았습니다."}</p>
      {info?.canceledDocNo && (
        <span className="text-[11px] cd-text-faint">원래 문서번호 {info.canceledDocNo} — 번호는 반납되어 다음 문서가 이어받습니다.</span>
      )}
    </div>
  );
}

/** 관리자 수정 이력 — 최신이 위. */
export function AdminEditHistory({ edits }: { edits: DocAdminEditView[] | null | undefined }) {
  if (!edits?.length) return null;
  return (
    <div className="rounded-lg border cd-border-c p-3 flex flex-col gap-1">
      <span className="text-[11px] font-semibold cd-text-faint flex items-center gap-1">
        <History className="w-3.5 h-3.5" /> 관리자 수정 이력 {edits.length}건
      </span>
      {edits.map((e) => (
        <p key={e.editId} className="text-[12px] cd-text">
          <span className="font-semibold">{e.fieldLabel ?? e.fieldKey}</span> {adminValueText(e.fieldType, e.beforeValue)} →{" "}
          <span className="font-semibold">{adminValueText(e.fieldType, e.afterValue)}</span>
          <span className="cd-text-faint">
            {" "}
            · {e.editedByName ?? "관리자"} · {short(e.editedAt)} — {e.reason}
          </span>
        </p>
      ))}
    </div>
  );
}

/** 관리자 조치 — 승인 완료 문서의 결재 취소·값 수정. */
export function ApprovalDocAdminPanel({
  docId,
  fields,
  fieldValues,
  canCancel,
  canEdit,
  onCanceled,
  onEdited,
}: {
  docId: string;
  fields: ApprovalFieldDef[];
  fieldValues: Record<string, unknown>;
  /** 결재 취소 버튼 표시 — 기안자 반려 요청이 있는 문서는 요청 카드의 버튼을 쓰므로 false */
  canCancel: boolean;
  canEdit: boolean;
  onCanceled: () => void;
  onEdited: () => void;
}) {
  const [mode, setMode] = useState<"none" | "cancel" | "edit">("none");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = useMemo(() => adminEditableFields(fields), [fields]);
  const [fieldKey, setFieldKey] = useState("");
  const [draft, setDraft] = useState<unknown>(null);
  const field = editable.find((f) => f.key === fieldKey) ?? null;

  if (!canCancel && !canEdit) return null;

  const open = (m: "cancel" | "edit") => {
    setMode(m);
    setReason("");
    setError(null);
    if (m === "edit") {
      setFieldKey("");
      setDraft(null);
    }
  };

  const post = async (url: string, body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "처리하지 못했습니다.");
      return data;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const submitCancel = async () => {
    if (!reason.trim()) {
      setError("취소 사유를 입력하세요.");
      return;
    }
    if (!window.confirm("이 문서의 결재를 취소합니다. 되돌릴 수 없습니다. 계속할까요?")) return;
    const data = await post(`/api/approval/docs/${encodeURIComponent(docId)}/cancel`, { reason });
    if (data) {
      alert(data.releasedDocNo ? `결재를 취소했습니다. 문서번호 ${data.releasedDocNo} 는 반납되었습니다.` : "결재를 취소했습니다.");
      onCanceled();
    }
  };

  const submitEdit = async () => {
    if (!field) {
      setError("고칠 항목을 고르세요.");
      return;
    }
    if (!reason.trim()) {
      setError("수정 사유를 입력하세요.");
      return;
    }
    const data = await post(`/api/approval/docs/${encodeURIComponent(docId)}/admin-edit`, { fieldKey: field.key, value: draft, reason });
    if (data) {
      setMode("none");
      onEdited();
    }
  };

  return (
    <div className="rounded-lg border cd-border-c p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] font-semibold cd-text flex items-center gap-1">
          관리자 조치 <CdHelp topic="approval.admin-actions" />
        </span>
        {canEdit && (
          <button
            type="button"
            className="cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[12px] flex items-center gap-1 disabled:opacity-50"
            disabled={busy}
            onClick={() => open("edit")}
          >
            <PencilLine className="w-3.5 h-3.5" /> 값 수정
          </button>
        )}
        {canCancel && (
          <button
            type="button"
            className="cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[12px] flex items-center gap-1 cd-text-muted hover:text-[color:var(--cd-error)] disabled:opacity-50"
            disabled={busy}
            onClick={() => open("cancel")}
          >
            <Ban className="w-3.5 h-3.5" /> 결재 취소
          </button>
        )}
      </div>

      {mode === "cancel" && (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] cd-warn-text">
            취소한 문서는 지우지 않고 ‘취소’로 남습니다. 문서번호는 반납되어 다음 문서가 이어받고, 휴가 문서는 차감된 연차가 복원됩니다. 영수증·카드 내역은 다른
            문서에서 다시 불러올 수 있게 풀립니다. 승인 때 이미 반영된 결과(인사 발령, 발송된 공문·견적 메일, 마감된 급여 등)는 되돌리지 않으니 따로 정리하세요.
          </p>
          <div className="flex items-center gap-2">
            <input className="cd-input flex-1" placeholder="취소 사유(기안자에게 알림으로 전달됩니다)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button type="button" className="cd-btn cd-btn-danger px-[18px] py-2 text-[13px] disabled:opacity-50" disabled={busy} onClick={submitCancel}>
              {busy ? "처리 중..." : "취소 확정"}
            </button>
            <button type="button" className="cd-btn cd-btn-soft px-3 py-2 text-[13px]" onClick={() => setMode("none")}>
              닫기
            </button>
          </div>
        </div>
      )}

      {mode === "edit" && (
        <div className="flex flex-col gap-2">
          {editable.length === 0 ? (
            <p className="text-[12px] cd-text-faint">이 양식에는 관리자가 고칠 수 있는 항목(일자·시각·기간·글·선택)이 없습니다. 결재 취소 후 다시 기안하세요.</p>
          ) : (
            <>
              <p className="text-[11px] cd-text-faint">
                일자·시각·기간·글·선택 항목만 고칠 수 있습니다. 금액·표·첨부·사람 선택은 결재 취소 후 다시 기안합니다. 고친 전후 값과 사유는 이 문서의 수정 이력에 남습니다.
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  className="cd-select"
                  style={{ width: 200 }}
                  aria-label="고칠 항목"
                  value={fieldKey}
                  onChange={(e) => {
                    setFieldKey(e.target.value);
                    setDraft(fieldValues[e.target.value] ?? null);
                    setError(null);
                  }}
                >
                  <option value="">고칠 항목 선택</option>
                  {editable.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
                {field && (
                  <span className="text-[11px] cd-text-faint">지금 값: {adminValueText(field.type, fieldValues[field.key])}</span>
                )}
              </div>
              {field && (
                <div className="max-w-[560px]">
                  <FieldInput
                    field={{ ...field, required: field.required }}
                    value={draft}
                    onSet={setDraft}
                    onFill={() => {}}
                    allFields={[field]}
                    allValues={{ [field.key]: draft }}
                  />
                </div>
              )}
              <div className="flex items-center gap-2">
                <input className="cd-input flex-1" placeholder="수정 사유(예: 입력 실수 — 실제 근무 종료 21:00)" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button type="button" className="cd-btn cd-btn-primary px-[18px] py-2 text-[13px] disabled:opacity-50" disabled={busy || !field} onClick={submitEdit}>
                  {busy ? "저장 중..." : "수정 저장"}
                </button>
                <button type="button" className="cd-btn cd-btn-soft px-3 py-2 text-[13px]" onClick={() => setMode("none")}>
                  닫기
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="text-[12px] cd-error-text">{error}</p>}
    </div>
  );
}
