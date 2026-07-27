"use client";

// 전자결재 홈 — 결재 대기(내 차례) 카드 + 결재 예정 + 기안 문서함(작성중/진행/완료) + 새 기안.
// 다우오피스 홈 구도 차용. 문서 상세는 모달(렌더러 readOnly + 결재선 진행 + 승인/반려).
// 설계: docs/e-approval-blueprint.md §5-1·§5-3.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, FileText, FolderOpen, Plus, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { ApprovalDocModal } from "@/components/approval/ApprovalDocModal";
import "@/components/cdash/cdash.css";

interface DocSummary {
  docId: string;
  docNo: string | null;
  formId: string;
  formName: string;
  title: string;
  urgent: boolean;
  status: string;
  drafterName: string | null;
  deptName: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  myStepId?: string | null;
  aiSummary?: { lines: string[]; figures: { label: string; value: string }[]; precedent?: string | null } | null;
}

interface FormRow {
  formId: string;
  folderId: string | null;
  name: string;
  description: string | null;
}

interface FolderRow {
  folderId: string;
  name: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "작성중",
  in_progress: "결재중",
  approved: "승인",
  rejected: "반려",
  canceled: "취소",
};

const short = (s: string | null) => (s ? s.slice(0, 16).replace("T", " ") : "-");

export function ApprovalHomeBoard() {
  const { theme } = useCdashTheme();
  const router = useRouter();
  const [pending, setPending] = useState<DocSummary[]>([]);
  const [upcoming, setUpcoming] = useState<DocSummary[]>([]);
  const [myBox, setMyBox] = useState<"draft" | "in_progress" | "completed">("in_progress");
  const [myDocs, setMyDocs] = useState<DocSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [formModal, setFormModal] = useState(false);
  const [forms, setForms] = useState<FormRow[]>([]);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [detailDocId, setDetailDocId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, u, m] = await Promise.all([
        fetch("/api/approval/docs?box=pending", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/approval/docs?box=upcoming", { cache: "no-store" }).then((r) => r.json()),
        fetch(`/api/approval/docs?box=${myBox}`, { cache: "no-store" }).then((r) => r.json()),
      ]);
      setPending(p.docs ?? []);
      setUpcoming(u.docs ?? []);
      setMyDocs(m.docs ?? []);
    } catch {
      // 무시 — 개별 목록 비움
    } finally {
      setLoading(false);
    }
  }, [myBox]);
  useEffect(() => {
    load();
  }, [load]);

  const openFormModal = async () => {
    setFormModal(true);
    if (!forms.length) {
      try {
        const res = await fetch("/api/approval/forms", { cache: "no-store" });
        const data = await res.json();
        if (res.ok) {
          setForms(data.forms ?? []);
          setFolders(data.folders ?? []);
        }
      } catch {
        // 무시
      }
    }
  };

  const openDetail = (docId: string) => setDetailDocId(docId);

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<ClipboardCheck className="w-5 h-5" />}
        eyebrow="Approval · Home"
        title="전자결재"
        subtitle="결재 대기 문서를 처리하고 기안을 작성합니다. 모든 문서의 입력 값은 항목별 데이터로 저장됩니다."
        actions={
          <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3.5 py-2 text-xs font-semibold flex items-center gap-1.5" onClick={openFormModal}>
            <Plus className="w-3.5 h-3.5" /> 새 기안
          </button>
        }
      />

      {/* 결재 대기 카드 */}
      <section className="cd-card rounded-3xl p-5">
        <h3 className="font-bold cd-text flex items-center gap-2 mb-3">
          결재 대기
          <span className="text-[11px] font-normal rounded-full px-2 py-0.5 cd-tint-primary">{pending.length}건</span>
          <span className="ml-auto text-[11px] font-normal cd-text-faint">결재 예정 {upcoming.length}건 — 앞 순번 처리 후 차례가 옵니다</span>
        </h3>
        {loading ? (
          <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
        ) : pending.length === 0 ? (
          <p className="text-sm cd-text-faint">대기 중인 결재가 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {pending.map((d) => (
              <div key={d.docId} className="rounded-2xl border cd-border-c p-4 flex flex-col gap-2">
                <div className="flex items-center gap-1.5">
                  {d.urgent && <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5 border border-[color:var(--cd-danger,#FA896B)] text-[color:var(--cd-danger,#FA896B)]">긴급</span>}
                  <span className="text-[10px] rounded-full px-1.5 py-0.5 cd-tint-primary">{d.formName}</span>
                </div>
                <p className="text-[13px] font-bold cd-text truncate" title={d.title}>{d.title}</p>
                <p className="text-[11px] cd-text-faint">
                  기안자 {d.drafterName ?? "-"} · {short(d.submittedAt)}
                </p>
                {d.aiSummary && d.aiSummary.lines.length > 0 && (
                  <div className="rounded-lg cd-tint-primary px-2.5 py-1.5 flex flex-col gap-0.5">
                    <span className="text-[9.5px] font-bold cd-text-primary tracking-wide">AI 요약</span>
                    {d.aiSummary.lines.slice(0, 3).map((l, i) => (
                      <p key={i} className="text-[11px] cd-text leading-tight">· {l}</p>
                    ))}
                    {d.aiSummary.precedent && <p className="text-[10px] cd-text-faint mt-0.5">※ {d.aiSummary.precedent}</p>}
                  </div>
                )}
                <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-1.5 text-xs font-semibold mt-1" onClick={() => openDetail(d.docId)}>
                  결재하기
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 기안 문서함 */}
      <section className="cd-card rounded-3xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-bold cd-text flex items-center gap-2">
            <FileText className="w-4 h-4 cd-text-primary" /> 내 기안 문서
          </h3>
          <div className="ml-auto flex items-center gap-1">
            {(
              [
                ["draft", "작성중·반려"],
                ["in_progress", "결재 진행"],
                ["completed", "완료"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" className="cd-chip cd-chip-sm" data-active={myBox === k} onClick={() => setMyBox(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {myDocs.length === 0 ? (
          <p className="text-sm cd-text-faint">문서가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left cd-text-faint text-[11px]">
                  <th className="py-1.5 pr-3 font-semibold">문서번호</th>
                  <th className="py-1.5 pr-3 font-semibold">양식</th>
                  <th className="py-1.5 pr-3 font-semibold">제목</th>
                  <th className="py-1.5 pr-3 font-semibold">상태</th>
                  <th className="py-1.5 font-semibold">최근 변경</th>
                </tr>
              </thead>
              <tbody>
                {myDocs.map((d) => (
                  <tr
                    key={d.docId}
                    className="border-t cd-border-c cursor-pointer hover:bg-[color:var(--cd-surface)]"
                    onClick={() => {
                      if (d.status === "draft" || d.status === "rejected") router.push(`/approval/draft?docId=${encodeURIComponent(d.docId)}`);
                      else openDetail(d.docId);
                    }}
                  >
                    <td className="py-2 pr-3 font-mono text-[11.5px] cd-text-faint">{d.docNo ?? "-"}</td>
                    <td className="py-2 pr-3 cd-text-faint">{d.formName}</td>
                    <td className="py-2 pr-3 cd-text">
                      {d.urgent && <span className="text-[10px] text-[color:var(--cd-danger,#FA896B)] font-bold mr-1">[긴급]</span>}
                      {d.title}
                    </td>
                    <td className="py-2 pr-3">
                      <span
                        className={`text-[10.5px] rounded-full px-2 py-0.5 border ${
                          d.status === "approved"
                            ? "border-[color:var(--cd-success,#13DEB9)] text-[color:var(--cd-success,#13DEB9)]"
                            : d.status === "rejected"
                              ? "border-[color:var(--cd-danger,#FA896B)] text-[color:var(--cd-danger,#FA896B)]"
                              : "cd-border-c cd-text-faint"
                        }`}
                      >
                        {STATUS_LABEL[d.status] ?? d.status}
                      </span>
                    </td>
                    <td className="py-2 cd-text-faint font-mono text-[11px]">{short(d.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 양식 선택 모달 */}
      {formModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={() => setFormModal(false)}>
          <div
            className="cdash cdash-vars cd-fields-white cd-card-bg rounded-2xl border cd-border-c w-full max-w-lg max-h-[80vh] overflow-y-auto p-4 flex flex-col gap-3"
            data-theme={theme}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-bold cd-text flex-1">결재양식 선택</h3>
              <button type="button" className="cd-btn cd-btn-soft text-[12px]" onClick={() => setFormModal(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            {[...folders, { folderId: "__none__", name: "미분류" }].map((fold) => {
              const list = forms.filter((f) => (f.folderId ?? "__none__") === fold.folderId);
              if (!list.length) return null;
              return (
                <div key={fold.folderId}>
                  <div className="flex items-center gap-1.5 text-[11px] font-bold cd-text-faint mb-1">
                    <FolderOpen className="w-3.5 h-3.5" /> {fold.name}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 mb-2">
                    {list.map((f) => (
                      <button
                        key={f.formId}
                        type="button"
                        className="text-left rounded-xl border cd-border-c px-3 py-2 hover:bg-[color:var(--cd-surface)]"
                        onClick={() => router.push(`/approval/draft?formId=${encodeURIComponent(f.formId)}`)}
                      >
                        <span className="text-[12.5px] cd-text font-semibold">{f.name}</span>
                        {f.description && <p className="text-[10.5px] cd-text-faint truncate">{f.description}</p>}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 문서 상세 모달(공용) */}
      {detailDocId && <ApprovalDocModal docId={detailDocId} theme={theme} onClose={() => setDetailDocId(null)} onChanged={load} />}
    </div>
  );
}
