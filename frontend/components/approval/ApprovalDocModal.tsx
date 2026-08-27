"use client";

// 전자결재 문서 상세(공용) — 렌더러 readOnly + 결재선 진행 칩 + 의견 + (내 차례면) 승인/반려.
// G3: 뷰어 본체(ApprovalDocViewer)를 분리해 결재함 3-pane 미리보기와 모달이 공유한다.
// 모달(ApprovalDocModal)은 뷰어를 오버레이로 감싼 래퍼 — 양식별 조회/문서함에서 계속 사용.

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, Paperclip, Pencil, Sparkles, Trash2, X } from "lucide-react";
import { ApprovalFormRenderer } from "@/components/approval/ApprovalFormRenderer";
import { DocAttachmentViewer } from "@/components/approval/DocAttachmentViewer";
import { approvalEditHref } from "@/lib/approval/edit-route";
import type { DocAttachment } from "@/lib/approval/attachments";
import type { ApprovalFieldDef } from "@/lib/approval/fields";
import { LETTER_FORM_ID, LETTER_SEND_STATUS_LABEL, type OfficialLetterRow } from "@/lib/letter/types";
import { QUOTE_FORM_ID } from "@/lib/quote/types";
import { AGREEMENT_FORM_ID } from "@/lib/agreement/types";

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
  formId?: string;
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
  /** 반려 요청(취소 요청, 124) — 미처리 요청·버튼 노출 판정(서버 계산). */
  cancelRequest?: { requestId: string; reason: string; requestedByName: string | null; requestedAt: string } | null;
  canRequestCancel?: boolean;
  canCancel?: boolean;
  /** 선행 문서 연결(127) — 신청서→보고서 연관 표시(예: 출장보고서에 연결된 출장신청서). */
  refDoc?: { docId: string; docNo: string | null; title: string; formName: string; status: string } | null;
  /** 문서 삭제 권한 — 관리자(전 상태) 또는 기안자 본인(작성중·반려). */
  canDelete?: boolean;
  /** 이어 작성·재기안 권한 — 기안자 본인의 작성중·반려 문서. */
  canEdit?: boolean;
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
  // 반려 요청(기안자) — 버튼을 누르면 사유 입력 폼이 펼쳐진다.
  const [cancelReasonOpen, setCancelReasonOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  // 본문 / 첨부서류 탭 — 첨부가 있는 문서에서만 노출.
  const [tab, setTab] = useState<"doc" | "attach">("doc");
  const attachments = ((detail?.fieldValues?.file_attachments ?? []) as DocAttachment[]).filter((f) => f?.key);
  // 공문 발송 대장(194) — 승인 완료 공문의 발송 상태·이력(N차)·재발송. 실패해도 문서 열람은 유지.
  const [letter, setLetter] = useState<OfficialLetterRow | null>(null);
  const [letterHistoryOpen, setLetterHistoryOpen] = useState(false);
  const [resending, setResending] = useState(false);

  const loadLetter = (id: string) => {
    fetch(`/api/letters/by-doc/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLetter(d?.letter ?? null))
      .catch(() => {});
  };
  useEffect(() => {
    setLetter(null);
    setLetterHistoryOpen(false);
    if (detail?.formId === LETTER_FORM_ID && detail.status === "approved") loadLetter(detail.docId);
  }, [detail?.formId, detail?.status, detail?.docId]);

  // 발송 실패·대기 건 — 같은 내용으로 발송 재시도(메일 오류 등)
  const retryLetterSend = async () => {
    if (!letter) return;
    if (!window.confirm("이 공문을 수신처 메일로 발송할까요?")) return;
    setResending(true);
    try {
      const res = await fetch(`/api/letters/${encodeURIComponent(letter.letterId)}/send`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "발송 실패");
      alert(data.skipped ? "이미 발송 처리 중입니다." : "발송되었습니다.");
      loadLetter(letter.docId ?? "");
    } catch (err) {
      alert((err as Error).message);
      if (letter.docId) loadLetter(letter.docId);
    } finally {
      setResending(false);
    }
  };

  // 발송 완료 건 — 수정 후 재발송(2026-08-19 사용자 확정): 회수 → 작성 화면 수정 → 재상신 →
  // 재결재 승인 시 자동 2차 발송(문서번호 유지, 이력 N차 누적). 내용 그대로 재송부는 지원하지 않는다.
  const recallForResend = async () => {
    if (!detail) return;
    const nth = (letter?.sendHistory.length ?? 0) + 1;
    if (
      !window.confirm(
        `공문을 회수해 수정 후 재발송합니다(${nth}차).
회수하면 결재를 다시 받아야 하며, 승인되면 자동으로 재발송됩니다. 진행할까요?`
      )
    )
      return;
    setResending(true);
    try {
      const res = await fetch(`/api/approval/docs/${encodeURIComponent(detail.docId)}/recall`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "회수 실패");
      // 착수계·준공계 연계 공문(2026-08-19) — 서류 자체를 다시 만들어야 하므로 준공계
      // 작성 화면으로 회귀한다. 수정 후 '공문 발송'을 누르면 이 공문으로 돌아와 첨부가 교체된다.
      const dlv = (data.deliverables ?? []) as { deliverableId: string }[];
      window.location.href = dlv.length
        ? `/contracts/deliverables?deliverable=${encodeURIComponent(dlv[0].deliverableId)}`
        : approvalEditHref(LETTER_FORM_ID, detail.docId);
    } catch (err) {
      alert((err as Error).message);
      setResending(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    // pane 재사용 대비 — 문서 전환 시 이전 상세/의견 리셋
    setDetail(null);
    setError(null);
    setComment("");
    setTab("doc");
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

  // 반려 요청(기안자) — 진행중이면 결재자, 승인완료면 관리자에게 알림이 간다.
  const requestCancel = async () => {
    if (!detail) return;
    if (!cancelReason.trim()) {
      alert("반려 요청 사유를 입력하세요.");
      return;
    }
    setActing(true);
    try {
      const res = await fetch(`/api/approval/docs/${encodeURIComponent(detail.docId)}/cancel-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "반려 요청 실패");
      alert(
        data.docStatus === "approved"
          ? "반려 요청을 등록했습니다. 관리자가 결재 취소를 처리하면 알림으로 안내됩니다."
          : "반려 요청을 등록했습니다. 결재자에게 반려 요청 알림이 전송되었습니다."
      );
      onActed?.();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setActing(false);
    }
  };

  // 결재 취소(관리자) — 승인 완료 문서를 취소하고 휴가면 연차 대장을 회수한다.
  const cancelDoc = async () => {
    if (!detail) return;
    if (!confirm("승인 완료된 결재를 취소합니다. 휴가 문서는 연차 대장 사용분도 회수됩니다. 계속할까요?")) return;
    setActing(true);
    try {
      const res = await fetch(`/api/approval/docs/${encodeURIComponent(detail.docId)}/cancel`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "결재 취소 실패");
      onActed?.();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setActing(false);
    }
  };

  return (
    // 문서 렌더러가 273mm(≈1032px) 고정폭이라, 컨테이너를 그 폭에 맞춰 좌우 빈 여백을 없앤다
    // (전자결재 홈 3-pane 뷰어·작성 화면 공통 규칙 — 공문·견적서 작성 화면과 동일).
    <div className="flex flex-col gap-4 max-w-[1032px]">
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
              {/* 계약서(147) — HWPX 다운로드(한글 원본 확인용, 2026-08-11 사용자 요청). 결재 중에도 on-demand 렌더. */}
              {detail.formId === AGREEMENT_FORM_ID && (
                <button
                  type="button"
                  className="flex items-center justify-center shrink-0"
                  style={{ width: 37, height: 37 }}
                  title="HWPX 다운로드(한글 원본)"
                  onClick={() => window.open(`/api/contracts/agreements/${encodeURIComponent(docId)}/hwpx`, "_blank")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {/* 세로로 긴 아이콘(내용 종횡비 0.65)이라 30px 박스에서는 폭이 좁아 작아 보인다 →
                      32px 박스에서 폭 20.8px 로 pdfico(20.7px)와 일치. ?v= 는 캐시 무효화. */}
                  <img src="/icons/hwpxico.png?v=4" alt="HWPX" style={{ width: 37, height: 37, objectFit: "contain" }} />
                </button>
              )}
              {/* PDF 출력 — 사업장 마스터 30px 아이콘 버튼 패턴(FacilityListPanel.tsx:304). 공문은 공문 지면으로 출력. */}
              <button
                type="button"
                className="flex items-center justify-center shrink-0"
                style={{ width: 30, height: 30 }}
                title="PDF 출력"
                onClick={() => window.open(`/api/approval/docs/${encodeURIComponent(docId)}/pdf`, "_blank")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/icons/pdfico.png" alt="PDF" style={{ width: 30, height: 30 }} />
              </button>
              {/* 이어 작성·재기안 — 본인 기안의 작성중·반려 문서. 양식 전용 화면(공문·견적서)으로 분기한다. */}
              {detail.canEdit && (
                <Link
                  href={approvalEditHref(detail.formId, detail.docId)}
                  className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-[11.5px] flex items-center gap-1 shrink-0"
                  title={detail.status === "rejected" ? "반려된 문서를 수정해 다시 상신합니다(문서번호 유지)" : "이어서 작성합니다"}
                >
                  <Pencil className="w-3.5 h-3.5" /> {detail.status === "rejected" ? "수정 후 재상신" : "이어 작성"}
                </Link>
              )}
              {detail.canDelete && (
                <button
                  type="button"
                  className="cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[11px] flex items-center gap-1 cd-text-faint hover:text-[color:var(--cd-danger,#FA896B)] shrink-0"
                  title="문서 완전 삭제 — 되돌릴 수 없습니다"
                  disabled={acting}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `이 문서를 완전히 삭제합니다.\n${detail.docNo ?? "미채번"} · ${detail.title}\n\n결재선·참조 기록이 함께 삭제되고, 휴가 문서라면 연차 차감도 복원됩니다.\n되돌릴 수 없습니다. 삭제하시겠습니까?`
                      )
                    ) {
                      return;
                    }
                    setActing(true);
                    try {
                      const res = await fetch(`/api/approval/docs/${encodeURIComponent(docId)}`, { method: "DELETE" });
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) throw new Error(data?.error ?? "삭제 실패");
                      alert("삭제되었습니다.");
                      onActed?.();
                    } catch (err) {
                      alert((err as Error).message);
                    } finally {
                      setActing(false);
                    }
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" /> 삭제
                </button>
              )}
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

            {/* 반려 문서 — 사유를 상단에 고정 노출한다(하단 '결재 의견'은 이력 성격이라 눈에 띄지 않음).
                기안자에게는 이어지는 처리(수정 후 재상신 / 삭제)를 함께 안내한다. */}
            {detail.status === "rejected" && (
              <div
                className="rounded-xl border px-3.5 py-2.5 flex flex-col gap-1"
                style={{ borderColor: "var(--cd-error)", background: "var(--cd-error-soft, rgba(250,137,107,0.1))" }}
              >
                {(() => {
                  const rej = detail.steps.filter((s) => s.status === "rejected").at(-1);
                  return (
                    <>
                      <span className="text-[11.5px] font-bold cd-error-text">
                        반려됨 — {rej?.assigneeName ?? "결재자"}
                        {rej?.actedAt ? ` · ${short(rej.actedAt)}` : ""}
                      </span>
                      <p className="text-[12.5px] cd-text">{rej?.comment?.trim() || "반려 사유가 입력되지 않았습니다."}</p>
                    </>
                  );
                })()}
                {detail.canEdit && (
                  <span className="text-[10.5px] cd-text-faint">
                    위 [수정 후 재상신]으로 내용을 고쳐 다시 올리거나, [삭제]로 기안을 취소할 수 있습니다. 재상신 시 문서번호는 유지되고 결재선은 처음부터 다시 진행됩니다.
                  </span>
                )}
              </div>
            )}

            {/* 선행 문서 연관(127) — 보고서에 연결된 신청서 표시 */}
            {detail.refDoc && (
              <p className="text-[11.5px] cd-text-faint flex items-center gap-1.5">
                <span className="text-[10px] font-bold rounded-full px-2 py-0.5 cd-tint-primary shrink-0">선행 문서</span>
                <span className="cd-text">
                  {detail.refDoc.docNo ? `${detail.refDoc.docNo} · ` : ""}
                  {detail.refDoc.title}
                </span>
                <span>
                  ({detail.refDoc.formName} · {DOC_STATUS_LABEL[detail.refDoc.status] ?? detail.refDoc.status})
                </span>
              </p>
            )}

            {/* 초과근무 주 12h 초과 경고 — 상신 시점에 고정된 판정(field_values._over_limit) */}
            {(() => {
              const ol = (detail.fieldValues as Record<string, unknown> | undefined)?._over_limit as
                | {
                    weekStart: string;
                    priorRequestedMinutes: number;
                    applyMinutes: number;
                    limitMinutes: number;
                    consent?: { agreedAt: string; signerName: string };
                  }
                | undefined;
              if (!ol || typeof ol !== "object" || !ol.weekStart) return null;
              const h = (min: number) => {
                const v = Math.round((Number(min || 0) / 60) * 10) / 10;
                return Number.isInteger(v) ? String(v) : v.toFixed(1);
              };
              const total = Number(ol.priorRequestedMinutes || 0) + Number(ol.applyMinutes || 0);
              return (
                <div
                  className="rounded-xl border px-3.5 py-2.5 flex flex-col gap-0.5"
                  style={{ borderColor: "var(--cd-warning,#FFAE1F)", background: "var(--cd-warning-soft, rgba(255,174,31,0.1))" }}
                >
                  <span className="text-[11.5px] font-bold" style={{ color: "var(--cd-warning,#FFAE1F)" }}>
                    ⚠ 주 12시간 초과 신청 — {ol.weekStart} 주 합계 {h(total)}h (기존 신청 {h(ol.priorRequestedMinutes)}h + 이 문서 {h(ol.applyMinutes)}h · 한도 {h(ol.limitMinutes)}h)
                  </span>
                  <span className="text-[10.5px] cd-text-faint">
                    승인 시 실제 근태 기록과 대조해 초과분이 인정되면 특별휴가(초과근무 대체휴가)로 가산율(1.5·야간 2.0배)을 반영해 시간 단위 자동 산정됩니다.
                  </span>
                  {ol.consent?.agreedAt && (
                    <span className="text-[10.5px] font-semibold" style={{ color: "var(--cd-success)" }}>
                      ✓ 기안자 보상휴가 전환 동의(전자서명) 완료 — {ol.consent.signerName || "기안자"} ·{" "}
                      {ol.consent.agreedAt.slice(0, 16).replace("T", " ")}
                    </span>
                  )}
                </div>
              );
            })()}

            {/* 지출결의서 식대 × 초과근무 신청 대조 경고 — 상신 시점 판정(field_values._meal_check) */}
            {(() => {
              const mc = (detail.fieldValues as Record<string, unknown> | undefined)?._meal_check as
                | {
                    priorWarningCount: number;
                    violations: Array<{
                      rowNo: number;
                      usedOn: string;
                      vendor: string | null;
                      amount: number | null;
                      paidAtHm: string | null;
                      isOffDay: boolean;
                      requiredMinutes: number;
                      appliedMinutes: number;
                    }>;
                  }
                | undefined;
              if (!mc || typeof mc !== "object" || !Array.isArray(mc.violations) || !mc.violations.length) return null;
              const repeat = Number(mc.priorWarningCount || 0) > 0;
              const h = (min: number) => {
                const v = Math.round((Number(min || 0) / 60) * 10) / 10;
                return Number.isInteger(v) ? String(v) : v.toFixed(1);
              };
              const tone = repeat ? "var(--cd-danger,#FA896B)" : "var(--cd-warning,#FFAE1F)";
              const toneSoft = repeat ? "var(--cd-danger-soft, rgba(250,137,107,0.1))" : "var(--cd-warning-soft, rgba(255,174,31,0.1))";
              return (
                <div className="rounded-xl border px-3.5 py-2.5 flex flex-col gap-0.5" style={{ borderColor: tone, background: toneSoft }}>
                  <span className="text-[11.5px] font-bold" style={{ color: tone }}>
                    ⚠ 식대 인정 기준 미달 {mc.violations.length}건 — 초과근무 신청(평일 2h·휴일 4h) 없이 사용된 식대입니다
                    {repeat ? ` · 과거 경고 ${mc.priorWarningCount}회(재발 — 사용액 반환 청구 검토 대상)` : " · 1차 — 경고 처리 대상"}
                  </span>
                  {mc.violations.map((v, i) => (
                    <span key={i} className="text-[10.5px] cd-text-faint">
                      · {v.usedOn}
                      {v.isOffDay ? "(휴일)" : ""} {v.vendor ?? "사용처 미상"}
                      {v.amount != null ? ` ${Number(v.amount).toLocaleString()}원` : ""}
                      {v.paidAtHm ? ` · 결제 ${v.paidAtHm}` : ""} — 신청 {h(v.appliedMinutes)}h / 기준 {h(v.requiredMinutes)}h
                    </span>
                  ))}
                </div>
              );
            })()}

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

            {/* 본문 / 첨부서류 탭 — 첨부가 있으면 결재자가 같은 화면에서 스위칭해 확인한다.
                첨부 없는 문서는 탭 자체를 감춰 기존 화면과 동일하게 보인다. */}
            {attachments.length > 0 && (
              <div className="flex items-center gap-1.5">
                {([
                  { key: "doc" as const, label: "문서" },
                  { key: "attach" as const, label: `첨부서류 ${attachments.length}` },
                ]).map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    className={`rounded-lg px-3 py-1.5 text-[12px] border flex items-center gap-1.5 ${
                      tab === t.key ? "cd-tint-primary font-bold" : "cd-border-c cd-text-muted cd-row-hover"
                    }`}
                    onClick={() => setTab(t.key)}
                  >
                    {t.key === "attach" && <Paperclip className="w-3.5 h-3.5" />}
                    {t.label}
                  </button>
                ))}
              </div>
            )}

            {tab === "attach" && attachments.length > 0 ? (
              <DocAttachmentViewer docId={docId} items={attachments} />
            ) : (
            <>
            {/* 공문 발송 상태·이력(194) — 승인 완료 공문: N차 발송 합산 + 재발송(발주처 사정 등) */}
            {detail.formId === LETTER_FORM_ID && detail.status === "approved" && letter && (
              <div className="rounded-[14px] px-4 py-3 flex flex-col gap-2" style={{ border: "1px solid var(--cd-active-border)" }}>
                <div className="flex items-center gap-2 flex-wrap text-[12px] cd-text">
                  <span className="font-bold">발송</span>
                  <span className="cd-text-faint">
                    {LETTER_SEND_STATUS_LABEL[letter.sendStatus] ?? letter.sendStatus}
                    {letter.sentAt ? ` · ${letter.sendHistory.length > 1 ? `${letter.sendHistory.length}차 ` : ""}${letter.sentAt.slice(0, 16).replace("T", " ")}` : ""}
                  </span>
                  {letter.sendError && <span className="text-[11px]" style={{ color: "var(--cd-danger, #FA896B)" }}>{letter.sendError}</span>}
                  {letter.sendHistory.length > 0 && (
                    <button type="button" className="text-[11px] cd-text-faint underline decoration-dotted" onClick={() => setLetterHistoryOpen((v) => !v)}>
                      {letterHistoryOpen ? "이력 닫기" : `발송 이력(${letter.sendHistory.length})`}
                    </button>
                  )}
                  <button
                    type="button"
                    className="ml-auto cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[11px] disabled:opacity-50"
                    disabled={resending || letter.sendStatus === "generating"}
                    onClick={letter.sendStatus === "sent" ? recallForResend : retryLetterSend}
                    title={
                      letter.sendStatus === "sent"
                        ? "회수 → 수정 → 재상신 → 재결재 승인 시 자동 재발송(문서번호 유지, 이력 N차 누적)"
                        : "수신처(참조자) 메일로 발송을 다시 시도합니다"
                    }
                  >
                    {resending ? "처리 중..." : letter.sendStatus === "sent" ? "수정 후 재발송" : "발송"}
                  </button>
                </div>
                {letterHistoryOpen &&
                  letter.sendHistory.map((h, i) => (
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
            {/* 문서 본체 — 다우식 양식(중앙 제목 + 기안 표 + 신청/승인란)을 흰 카드 위에 올린다. */}
            {detail.formId === LETTER_FORM_ID || detail.formId === QUOTE_FORM_ID || detail.formId === AGREEMENT_FORM_ID ? (
              // 공문(135)·견적서(136)·계약서(147) — 결재자도 최종 발송/제출 지면(PDF) 그대로 심사한다.
              <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid var(--cd-active-border)" }}>
                <iframe
                  title={detail.formId === QUOTE_FORM_ID ? "견적서 미리보기" : detail.formId === AGREEMENT_FORM_ID ? "계약서 미리보기" : "공문 미리보기"}
                  src={`/api/approval/docs/${encodeURIComponent(docId)}/pdf?disposition=inline`}
                  className="w-full"
                  style={{ height: "80vh", background: "#fff" }}
                />
              </div>
            ) : (
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
            )}
            </>
            )}

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

            {/* 반려 요청(취소 요청, 124) — 일정 메뉴의 휴가/출장/교육 취소·변경 흐름 */}
            {detail.cancelRequest && (
              <div className="rounded-xl border cd-border-c p-3 flex flex-col gap-1" style={{ borderColor: "var(--cd-warning)" }}>
                <span className="text-[11px] font-bold" style={{ color: "var(--cd-warning)" }}>
                  반려 요청 처리 대기
                </span>
                <p className="text-[12px] cd-text">
                  <span className="font-semibold">{detail.cancelRequest.requestedByName ?? "기안자"}</span>
                  <span className="cd-text-faint"> · {short(detail.cancelRequest.requestedAt)}</span> — {detail.cancelRequest.reason}
                </p>
                {detail.status === "in_progress" && (
                  <p className="text-[11px] cd-text-faint">결재자는 위 처리 바에서 반려로 처리해 주세요.</p>
                )}
                {detail.canCancel && (
                  <button
                    type="button"
                    className="cd-btn cd-btn-danger px-[18px] py-2 text-[12.5px] self-start disabled:opacity-50"
                    disabled={acting}
                    onClick={cancelDoc}
                  >
                    결재 취소(연차 대장 회수 포함)
                  </button>
                )}
              </div>
            )}
            {detail.canRequestCancel && (
              <div className="flex flex-col gap-2 pt-1">
                {cancelReasonOpen ? (
                  <div className="flex items-center gap-2">
                    <input
                      className="cd-input flex-1"
                      placeholder="반려 요청 사유(취소·변경 사유를 입력하세요)"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                    />
                    <button
                      type="button"
                      className="cd-btn cd-btn-danger px-[18px] py-2.5 text-[13px] disabled:opacity-50"
                      disabled={acting}
                      onClick={requestCancel}
                    >
                      반려 요청 보내기
                    </button>
                    <button
                      type="button"
                      className="cd-btn cd-btn-soft px-3 py-2.5 text-[13px]"
                      onClick={() => setCancelReasonOpen(false)}
                    >
                      닫기
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="cd-btn rounded-lg border cd-border-c px-3 py-2 text-[12.5px] self-start cd-text-muted hover:cd-error-text"
                    onClick={() => setCancelReasonOpen(true)}
                  >
                    반려 요청 — {detail.status === "approved" ? "승인 건 취소를 관리자에게 요청" : "결재자에게 반려를 요청"}
                  </button>
                )}
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
        // 문서 렌더러는 273mm(약 1032px) 고정폭 — max-w-3xl(768px)이면 양식이 눌려 좁아 보인다는
        // 피드백(일정 메뉴 문서 팝업). 렌더러+좌우 패딩이 온전히 들어가는 폭으로 상향.
        className="cdash cdash-vars cd-fields-white rounded-[24px] border cd-border-c w-full max-w-[1100px] max-h-[88vh] overflow-y-auto p-5"
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
