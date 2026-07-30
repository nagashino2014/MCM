"use client";

// 전자결재 문서 상세(공용) — 렌더러 readOnly + 결재선 진행 칩 + 의견 + (내 차례면) 승인/반려.
// G3: 뷰어 본체(ApprovalDocViewer)를 분리해 결재함 3-pane 미리보기와 모달이 공유한다.
// 모달(ApprovalDocModal)은 뷰어를 오버레이로 감싼 래퍼 — 양식별 조회/문서함에서 계속 사용.

import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Sparkles, X } from "lucide-react";
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
  aiSummary?: { lines: string[]; figures: { label: string; value: string }[]; precedent?: string | null } | null;
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

/**
 * 문서 상세 뷰어(본체) — 로드·결재선·AI 요약·렌더러·승인/반려까지 포함.
 * headerRight 로 우측 상단 액션(모달 닫기 버튼 등)을 주입한다. 결재 처리 성공 시 onActed.
 */
export function ApprovalDocViewer({
  docId,
  onActed,
  headerRight,
}: {
  docId: string;
  onActed?: () => void;
  headerRight?: ReactNode;
}) {
  const [detail, setDetail] = useState<DocDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [acting, setActing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // pane 재사용 대비 — 문서 전환 시 이전 상세/의견 리셋
    setDetail(null);
    setError(null);
    setComment("");
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
      onActed?.();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
        {error ? (
          <div className="flex items-center gap-2">
            <p className="text-sm text-[color:var(--cd-danger,#FA896B)] flex-1">{error}</p>
            {headerRight}
          </div>
        ) : !detail ? (
          <div className="flex items-start gap-2">
            <p className="text-sm cd-text-faint py-8 text-center flex-1">문서를 불러오는 중입니다.</p>
            {headerRight}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-extrabold cd-text flex-1 min-w-0">
                {detail.urgent && (
                  <span className="text-[10px] font-extrabold rounded-[5px] px-1.5 py-0.5 mr-1.5 cd-error-bg cd-error-text align-[1px]">
                    긴급
                  </span>
                )}
                {detail.title}
                <span className="ml-2 text-[11px] font-normal cd-text-faint">
                  {detail.docNo ?? "미채번"} · {DOC_STATUS_LABEL[detail.status] ?? detail.status}
                </span>
              </h3>
              {headerRight}
            </div>

            {/* 결재선 스텝퍼 — 누가 다음 차례인지 목록·뷰어 어디에도 없던 문제(분석 §2 /approval).
                기안자부터 마지막 결재자까지 아바타 체인으로 상설 표시하고 현재 차례를 강조한다. */}
            <div className="flex items-center flex-wrap gap-y-2 pb-3 border-b cd-hairline-c">
              {[
                {
                  key: "__drafter",
                  name: detail.drafterName ?? "-",
                  label: `기안 · ${short(detail.submittedAt)}`,
                  status: "approved",
                  comment: null as string | null,
                },
                ...detail.steps.map((s) => ({
                  key: s.stepId,
                  name: `${s.assigneeName ?? s.assigneeUserId}${s.delegatedFrom ? "(대결)" : ""}`,
                  label: `${s.stepType === "agree" ? "합의" : "승인"} · ${STEP_STATUS_LABEL[s.status] ?? s.status}`,
                  status: s.status,
                  comment: s.comment,
                })),
              ].map((st, i, arr) => {
                const tone =
                  st.status === "approved"
                    ? "var(--cd-success)"
                    : st.status === "rejected"
                      ? "var(--cd-error)"
                      : st.status === "pending"
                        ? "var(--cd-primary)"
                        : "var(--cd-faint)";
                return (
                  <div key={st.key} className="flex items-center" title={st.comment ?? undefined}>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-[34px] h-[34px] rounded-full inline-flex items-center justify-center text-xs font-bold shrink-0"
                        style={{
                          background: `color-mix(in srgb, ${tone} 16%, transparent)`,
                          color: tone,
                          boxShadow: st.status === "pending" ? `0 0 0 2px ${tone}` : undefined,
                        }}
                      >
                        {st.name.slice(0, 1)}
                      </span>
                      <span className="leading-[1.3]">
                        <span className="block text-xs font-bold cd-text whitespace-nowrap">{st.name}</span>
                        <span className="block text-[10px] font-semibold whitespace-nowrap" style={{ color: tone }}>
                          {st.label}
                        </span>
                      </span>
                    </div>
                    {i < arr.length - 1 && (
                      <span
                        className="w-[18px] h-[2px] rounded-sm mx-[7px]"
                        style={{ background: arr[i + 1].status === "waiting" ? "var(--cd-hairline)" : tone, opacity: 0.7 }}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {detail.aiSummary && (detail.aiSummary.lines.length > 0 || detail.aiSummary.figures.length > 0) && (
              <div className="rounded-xl cd-tint-primary p-3 flex flex-col gap-1.5">
                <span className="text-[11px] font-bold cd-text-primary flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" /> AI 요약 <span className="font-normal cd-text-faint">— 참고용, 원문을 확인하세요</span>
                </span>
                {detail.aiSummary.lines.map((l, i) => (
                  <p key={i} className="text-[12.5px] cd-text leading-snug">· {l}</p>
                ))}
                {detail.aiSummary.figures.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-0.5">
                    {detail.aiSummary.figures.map((f, i) => (
                      <span key={i} className="text-[11px] rounded-lg border cd-border-c cd-surface-bg px-2 py-0.5">
                        <span className="cd-text-faint">{f.label}</span> <span className="cd-text font-semibold">{f.value}</span>
                      </span>
                    ))}
                  </div>
                )}
                {detail.aiSummary.precedent && <p className="text-[11px] cd-text-faint mt-0.5">※ {detail.aiSummary.precedent}</p>}
              </div>
            )}

            {/* 문서 본체 — 다우식 양식(중앙 제목 + 기안 표 + 신청/승인란)을 흰 카드 위에 올린다. */}
            <div
              className="rounded-[14px] px-[26px] py-6 flex flex-col gap-4"
              style={{
                background: "var(--cd-active-fill)",
                border: "1px solid var(--cd-active-border)",
                boxShadow: "0 4px 18px rgba(80, 95, 150, 0.05)",
              }}
            >
              <ApprovalFormRenderer
                fields={detail.fields}
                values={detail.fieldValues}
                onChange={() => {}}
                readOnly
                header={{
                  formName: detail.formName,
                  drafterName: detail.drafterName ?? undefined,
                  deptName: detail.deptName ?? undefined,
                  draftDate: short(detail.submittedAt),
                  docNo: detail.docNo ?? undefined,
                  steps: detail.steps,
                  myStepId: detail.myStepId ?? null,
                }}
              />
            </div>

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
              // 하단 처리 바 — 반려(위험 윤곽) 좌측, 승인(그라데이션 CTA) 우측.
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  className="cd-btn cd-btn-danger px-[18px] py-2.5 text-[13px] disabled:opacity-50"
                  disabled={acting}
                  onClick={() => act("reject")}
                >
                  반려
                </button>
                <input
                  className="cd-input flex-1"
                  placeholder="결재 의견(반려 시 필수)"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
                <button
                  type="button"
                  className="cd-btn cd-btn-primary px-[26px] py-2.5 text-[13.5px] disabled:opacity-50"
                  disabled={acting}
                  onClick={() => act("approve")}
                >
                  <CheckCircle2 className="w-4 h-4" />
                  승인
                </button>
              </div>
            )}
          </>
        )}
    </div>
  );
}

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
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: "rgba(23, 28, 44, 0.42)", backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)" }}
      onClick={onClose}
    >
      <div
        className="cdash cdash-vars cd-fields-white rounded-[24px] border cd-border-c w-full max-w-3xl max-h-[88vh] overflow-y-auto p-5"
        style={{ background: "var(--cd-card-solid)" }}
        data-theme={theme}
        onClick={(e) => e.stopPropagation()}
      >
        <ApprovalDocViewer
          docId={docId}
          onActed={() => {
            onChanged?.();
            onClose();
          }}
          headerRight={
            <button type="button" className="cd-btn cd-btn-soft text-[12px]" onClick={onClose}>
              <X className="w-4 h-4" />
            </button>
          }
        />
      </div>
    </div>
  );
}
