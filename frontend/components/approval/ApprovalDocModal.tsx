"use client";

// 전자결재 문서 상세 모달(공용) — 렌더러 readOnly + 결재선 진행 칩 + 의견 + (내 차례면) 승인/반려.
// 홈/양식별 조회/문서함에서 재사용한다. docId 로 상세를 로드하고, 처리 후 onChanged 를 부른다.

import { useEffect, useState } from "react";
import { CheckCircle2, X, XCircle } from "lucide-react";
import { ApprovalFormRenderer } from "@/components/approval/ApprovalFormRenderer";
import type { ApprovalFieldDef } from "@/lib/approval/fields";

export interface DocStepRow {
  stepId: string;
  stepOrder: number;
  stepType: string;
  assigneeUserId: string;
  assigneeName: string | null;
  assigneePosition: string | null;
  status: string;
  actedAt: string | null;
  comment: string | null;
  delegatedFrom: string | null;
}

export interface DocDetailData {
  docId: string;
  docNo: string | null;
  formName: string;
  title: string;
  urgent: boolean;
  status: string;
  drafterName: string | null;
  drafterUserId: string | null;
  deptName: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  fieldValues: Record<string, unknown>;
  fields: ApprovalFieldDef[];
  steps: DocStepRow[];
  myStepId?: string | null;
}

export const DOC_STATUS_LABEL: Record<string, string> = {
  draft: "작성중",
  in_progress: "결재중",
  approved: "승인",
  rejected: "반려",
  canceled: "취소",
};
const STEP_STATUS_LABEL: Record<string, string> = {
  waiting: "예정",
  pending: "대기",
  approved: "승인",
  rejected: "반려",
  skipped: "생략",
};
const short = (s: string | null) => (s ? s.slice(0, 16).replace("T", " ") : "-");

export function ApprovalDocModal({
  docId,
  theme,
  onClose,
  onChanged,
}: {
  docId: string;
  theme: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<DocDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [acting, setActing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/approval/docs/${encodeURIComponent(docId)}`, { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error ?? "문서를 불러오지 못했습니다.");
        if (!cancelled) setDetail(data.doc);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const act = async (action: "approve" | "reject") => {
    if (!detail?.myStepId) return;
    if (action === "reject" && !comment.trim()) {
      alert("반려 사유를 입력하세요.");
      return;
    }
    setActing(true);
    try {
      const res = await fetch(`/api/approval/docs/${encodeURIComponent(detail.docId)}/act`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId: detail.myStepId, action, comment: comment || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "결재 처리 실패");
      onChanged?.();
      onClose();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={onClose}>
      <div
        className="cdash cdash-vars cd-fields-white cd-card-bg rounded-2xl border cd-border-c w-full max-w-3xl max-h-[88vh] overflow-y-auto p-5 flex flex-col gap-4"
        data-theme={theme}
        onClick={(e) => e.stopPropagation()}
      >
        {error ? (
          <div className="flex items-center gap-2">
            <p className="text-sm text-[color:var(--cd-danger,#FA896B)] flex-1">{error}</p>
            <button type="button" className="cd-btn cd-btn-soft text-[12px]" onClick={onClose}>
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : !detail ? (
          <p className="text-sm cd-text-faint py-8 text-center">문서를 불러오는 중입니다.</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-bold cd-text flex-1">
                {detail.urgent && <span className="text-[11px] text-[color:var(--cd-danger,#FA896B)] font-bold mr-1">[긴급]</span>}
                {detail.title}
                <span className="ml-2 text-[11px] font-normal cd-text-faint">
                  {detail.docNo ?? "미채번"} · {detail.formName} · {DOC_STATUS_LABEL[detail.status] ?? detail.status}
                </span>
              </h3>
              <button type="button" className="cd-btn cd-btn-soft text-[12px]" onClick={onClose}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-xl border cd-border-c p-3 flex flex-wrap gap-2">
              <div className="rounded-lg border cd-border-c px-2.5 py-1.5 text-[11.5px]">
                <span className="cd-text-faint">기안</span> <span className="cd-text font-semibold">{detail.drafterName ?? "-"}</span>
                <span className="cd-text-faint"> {short(detail.submittedAt)}</span>
              </div>
              {detail.steps.map((s) => (
                <div
                  key={s.stepId}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11.5px] ${
                    s.status === "pending"
                      ? "border-[color:var(--cd-primary)] cd-tint-primary"
                      : s.status === "approved"
                        ? "border-[color:var(--cd-success,#13DEB9)]"
                        : s.status === "rejected"
                          ? "border-[color:var(--cd-danger,#FA896B)]"
                          : "cd-border-c"
                  }`}
                  title={s.comment ?? undefined}
                >
                  <span className="cd-text-faint">{s.stepType === "agree" ? "합의" : "승인"}</span>{" "}
                  <span className="cd-text font-semibold">
                    {s.assigneeName ?? s.assigneeUserId}
                    {s.delegatedFrom && <span className="text-[10px] cd-text-faint">(대결)</span>}
                  </span>{" "}
                  <span className="cd-text-faint">{STEP_STATUS_LABEL[s.status] ?? s.status}</span>
                  {s.status === "approved" && <CheckCircle2 className="inline w-3 h-3 ml-0.5 text-[color:var(--cd-success,#13DEB9)]" />}
                  {s.status === "rejected" && <XCircle className="inline w-3 h-3 ml-0.5 text-[color:var(--cd-danger,#FA896B)]" />}
                </div>
              ))}
            </div>

            <ApprovalFormRenderer
              fields={detail.fields}
              values={detail.fieldValues}
              onChange={() => {}}
              readOnly
              header={{
                drafterName: detail.drafterName ?? undefined,
                deptName: detail.deptName ?? undefined,
                draftDate: short(detail.submittedAt),
                docNo: detail.docNo ?? undefined,
              }}
            />

            {detail.steps.some((s) => s.comment) && (
              <div className="rounded-xl border cd-border-c p-3 flex flex-col gap-1">
                <span className="text-[11px] font-bold cd-text-faint">결재 의견</span>
                {detail.steps
                  .filter((s) => s.comment)
                  .map((s) => (
                    <p key={s.stepId} className="text-[12px] cd-text">
                      <span className="font-semibold">{s.assigneeName}</span>{" "}
                      <span className="cd-text-faint">({STEP_STATUS_LABEL[s.status]})</span> {s.comment}
                    </p>
                  ))}
              </div>
            )}

            {detail.myStepId && detail.status === "in_progress" && (
              <div className="flex items-center gap-2">
                <input className="cd-input flex-1" placeholder="결재 의견(반려 시 필수)" value={comment} onChange={(e) => setComment(e.target.value)} />
                <button type="button" className="cd-btn cd-btn-primary rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-50" disabled={acting} onClick={() => act("approve")}>
                  승인
                </button>
                <button
                  type="button"
                  className="cd-btn rounded-lg border border-[color:var(--cd-danger,#FA896B)] text-[color:var(--cd-danger,#FA896B)] px-4 py-2 text-xs font-semibold disabled:opacity-50"
                  disabled={acting}
                  onClick={() => act("reject")}
                >
                  반려
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
