"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ExternalLink, FileText, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { CdHelp } from "@/components/cdash/CdHelp";
import { formatAmount } from "@/components/ui/AmountInput";
import FacilityInfoModal from "@/components/contracts/FacilityInfoModal";
import type { PdfViewerDoc } from "@/components/contracts/DraggablePdfViewer";
import type { PurchaseContractDetail } from "@/lib/contracts/purchase/types";
import { purchaseTypeLabel, resolvePurchaseTypeStyle } from "@/lib/contracts/purchase/options";
import { Info, PaidProgressCard, num, str } from "./primitives";

/**
 * 매입 계약 상세(331) — 매출 ContractDetailPanel 의 KPI·진척도·단계 표·문서 구성을 매입 의미(수취·지급)로 옮긴 것.
 * 단계 편집·후보 계산서·문서 업로드는 부모(PurchaseContractsBoard)가 모달과 API 호출을 맡는다.
 */
export function PurchaseContractDetailPanel({
  detail,
  canEdit,
  canDelete,
  onEditContract,
  onOpenNewStage,
  onOpenEditStage,
  onDeleteStage,
  onReorderStages,
  onOpenCandidates,
  onOpenPdf,
  onDeleteDocument,
  onDeleteContract,
}: {
  detail: PurchaseContractDetail;
  canEdit: boolean;
  canDelete: boolean;
  onEditContract: () => void;
  onOpenNewStage: () => void;
  onOpenEditStage: (milestone: Record<string, unknown>) => void;
  onDeleteStage: (milestoneId: string) => void;
  onReorderStages: (orderedIds: string[]) => void;
  onOpenCandidates: (milestone: Record<string, unknown>) => void;
  onOpenPdf: (state: { title: string; url: string; docs?: PdfViewerDoc[]; initialIndex?: number }) => void;
  onDeleteDocument: (documentId: string, title: string) => void;
  onDeleteContract: () => void;
}) {
  const contract = detail.contract;
  const style = resolvePurchaseTypeStyle(str(contract.contract_type));
  const baseAmount = detail.milestones.length > 0 ? detail.milestones.reduce((acc, m) => acc + num(m.amount), 0) : num(contract.contract_amount);
  const paidAmount = detail.milestones.reduce((acc, m) => acc + (num(m.payment_paid) === 1 ? num(m.paid_amount) || num(m.amount) : 0), 0);
  const paidRate = baseAmount > 0 ? Math.min(1, paidAmount / baseAmount) : 0;
  const [facilityInfoOpen, setFacilityInfoOpen] = useState(false);

  const flags = [
    num(contract.is_unit_price) === 1 && "단가 계약",
    num(contract.has_extra_spend) === 1 && "추가 지출",
    num(contract.is_metered) === 1 && "종량제",
  ].filter(Boolean) as string[];

  const viewerDocs = useMemo<PdfViewerDoc[]>(
    () =>
      [...detail.documents]
        .filter((d) => str(d.public_path))
        .sort((a, b) => str(a.created_at).localeCompare(str(b.created_at)))
        .map((d) => ({
          label: str(d.document_type) === "amendment" ? `변경계약서(${str(d.created_at).slice(0, 10)})` : `계약서(${str(d.created_at).slice(0, 10)})`,
          url: str(d.public_path),
          fileName: str(d.display_name) || "계약서.pdf",
          documentId: str(d.document_id),
        })),
    [detail.documents]
  );

  const openViewer = (documentId?: string) => {
    if (viewerDocs.length === 0) return alert("등록된 계약서 PDF가 없습니다. 아래에서 먼저 업로드해 주세요.");
    const idx = documentId ? Math.max(0, viewerDocs.findIndex((d) => d.documentId === documentId)) : 0;
    onOpenPdf({ title: str(contract.contract_title) || "매입 계약서", url: viewerDocs[idx].url, docs: viewerDocs, initialIndex: idx });
  };

  const relatedTitle = str(contract.related_contract_title);
  const relatedId = str(contract.related_contract_id);

  return (
    <div className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="rounded-full px-2 py-0.5 text-[11px] text-white" style={{ background: style.parentColor }}>
              {purchaseTypeLabel(str(contract.contract_type))}
            </span>
            <span className="rounded-full px-2 py-0.5 text-[11px] cd-text" style={{ background: style.childColor }}>
              {str(contract.contract_category)}
            </span>
            {flags.map((f) => (
              <span key={f} className="rounded-full px-2 py-0.5 text-[11px] cd-surface-bg cd-text-muted border cd-border-c">{f}</span>
            ))}
          </div>
          <h2 className="mt-2 text-lg font-semibold cd-text truncate">{str(contract.contract_title)}</h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => openViewer()} className="cd-btn cd-btn-ghost cd-btn-sm inline-flex items-center gap-1">
            <FileText className="w-3.5 h-3.5" /> 계약서 보기
          </button>
          {canEdit && (
            <button type="button" onClick={onEditContract} className="cd-btn cd-btn-ghost cd-btn-sm inline-flex items-center gap-1">
              <Pencil className="w-3.5 h-3.5" /> 변경계약 입력
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <button type="button" className="text-left" onClick={() => setFacilityInfoOpen(true)} title="사업장 정보 보기">
            <Info label="계약상대 업체" value={str(contract.counterparty_name)} highlight />
          </button>
          <Info label="계약금액" value={baseAmount > 0 ? `${formatAmount(baseAmount)}원` : null} />
          <Info label="계약일" value={str(contract.contract_date).slice(0, 10) || null} />
          <Info label="준공일" value={str(contract.completed_at).slice(0, 10) || null} />
          <Info label="매입 계정과목" value={contract.account_code ? `${str(contract.account_code)} ${str(contract.account_name)}` : null} />
          <Info
            label="관련 매출 계약"
            value={
              relatedId ? (
                <Link href={`/contracts?contract=${encodeURIComponent(relatedId)}`} className="inline-flex items-center gap-1 cd-text-primary hover:underline">
                  <span className="truncate">{relatedTitle || relatedId}</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </Link>
              ) : null
            }
          />
          {str(contract.memo) && (
            <div className="col-span-2 lg:col-span-3 rounded-lg border cd-border-c p-3">
              <p className="text-[11px] cd-text-faint">메모</p>
              <p className="text-sm mt-1 cd-text whitespace-pre-wrap">{str(contract.memo)}</p>
            </div>
          )}
        </div>
        <PaidProgressCard rate={paidRate} paidAmount={paidAmount} baseAmount={baseAmount} />
      </div>

      <section className="grid gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold cd-text">청구·수금 단계</h3>
          <CdHelp topic="purchase.stages" />
          <span className="text-[11px] cd-text-faint">세금계산서 수취·대금 지급을 단계별로 기록합니다.</span>
          {canEdit && (
            <button type="button" onClick={onOpenNewStage} className="ml-auto cd-btn cd-btn-ghost cd-btn-sm inline-flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> 단계 추가
            </button>
          )}
        </div>
        {detail.milestones.length === 0 ? (
          <p className="rounded-lg border cd-border-c p-4 text-sm cd-text-faint">등록된 단계가 없습니다.</p>
        ) : (
          <div className="rounded-lg border cd-border-c overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="cd-surface-bg cd-text-faint text-left">
                  <th className="px-3 py-2 font-medium w-10">차수</th>
                  <th className="px-3 py-2 font-medium">단계명</th>
                  <th className="px-3 py-2 font-medium text-right">청구금액</th>
                  <th className="px-3 py-2 font-medium">지급 조건</th>
                  <th className="px-3 py-2 font-medium">세금계산서 수취</th>
                  <th className="px-3 py-2 font-medium">대금 지급</th>
                  {canEdit && <th className="px-3 py-2 font-medium text-right w-[150px]"></th>}
                </tr>
              </thead>
              <tbody>
                {detail.milestones.map((m, idx) => {
                  const id = str(m.milestone_id);
                  const received = num(m.invoice_received) === 1;
                  const paid = num(m.payment_paid) === 1;
                  return (
                    <tr key={id} className="border-t cd-border-c align-top">
                      <td className="px-3 py-2 cd-text-faint">{idx + 1}차</td>
                      <td className="px-3 py-2 cd-text">
                        {str(m.stage_label)}
                        {str(m.memo) && <p className="cd-text-faint mt-0.5 whitespace-pre-wrap">{str(m.memo)}</p>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums cd-text">{m.amount != null ? formatAmount(num(m.amount)) : "-"}</td>
                      <td className="px-3 py-2 cd-text-muted">{str(m.payment_terms) || "-"}</td>
                      <td className="px-3 py-2">
                        {received ? (
                          // 수취일만 적고(금액은 단계 금액과 중복), 연결된 홈택스 계산서는 태그로 붙인다(2026-11-02 사용자 요청)
                          <div className="cd-text flex items-center gap-2 flex-wrap">
                            <span className="font-mono tabular-nums">{str(m.invoice_received_at).slice(0, 10) || "일자 미입력"}</span>
                            {m.hometax_hti_id ? (
                              <span
                                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] cd-tint-primary cd-text-primary border border-[color:var(--cd-primary)]"
                                title={`승인번호 ${str(m.hometax_nts_send_key)} · ${formatAmount(num(m.hometax_total_amount))}원`}
                              >
                                <Link2 className="w-3 h-3" /> 홈택스 {str(m.hometax_write_date)}
                              </span>
                            ) : (
                              canEdit && (
                                <button type="button" onClick={() => onOpenCandidates(m)} className="inline-flex items-center gap-1 cd-text-faint hover:cd-text-primary">
                                  <Link2 className="w-3 h-3" /> 계산서 연결
                                </button>
                              )
                            )}
                          </div>
                        ) : canEdit ? (
                          <button type="button" onClick={() => onOpenCandidates(m)} className="inline-flex items-center gap-1 cd-text-faint hover:cd-text-primary">
                            <Link2 className="w-3 h-3" /> 미수취 · 후보 찾기
                          </button>
                        ) : (
                          <span className="cd-text-faint">미수취</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {paid ? (
                          // 지급일만 표시(지급액은 수정 창·진척도에서 본다, 2026-11-02 사용자 요청)
                          <span className="cd-text font-mono tabular-nums" title={`지급액 ${formatAmount(num(m.paid_amount) || num(m.amount))}원`}>
                            {str(m.payment_paid_at).slice(0, 10) || "일자 미입력"}
                          </span>
                        ) : (
                          <span className="cd-text-faint">미지급</span>
                        )}
                      </td>
                      {canEdit && (
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <button type="button" title="위로" disabled={idx === 0} onClick={() => onReorderStages(swap(detail.milestones.map((x) => str(x.milestone_id)), idx, idx - 1))} className="rounded-lg p-1 cd-text-faint hover:cd-text disabled:opacity-30">
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" title="아래로" disabled={idx === detail.milestones.length - 1} onClick={() => onReorderStages(swap(detail.milestones.map((x) => str(x.milestone_id)), idx, idx + 1))} className="rounded-lg p-1 cd-text-faint hover:cd-text disabled:opacity-30">
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" title="수정" onClick={() => onOpenEditStage(m)} className="rounded-lg p-1 cd-text-faint hover:cd-text-primary">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" title="삭제" onClick={() => onDeleteStage(id)} className="rounded-lg p-1 cd-text-faint hover:cd-error-text">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold cd-text">계약서 PDF</h3>
          {/* 업로드는 신규 계약 입력·변경계약 입력 모달에서만(2026-11-02 사용자 요청) — 여기서는 보기·삭제만 */}
          <span className="text-[11px] cd-text-faint">계약서·변경계약서 첨부는 [변경계약 입력]에서 합니다.</span>
        </div>
        <div className="grid gap-3">
          <div className="rounded-lg border cd-border-c p-2.5 min-h-[64px] flex flex-col gap-1">
            {detail.documents.length === 0 ? (
              <p className="text-xs cd-text-faint m-auto">첨부된 계약서가 없습니다.</p>
            ) : (
              detail.documents.map((d) => (
                <div key={str(d.document_id)} className="flex items-center gap-2 rounded-lg border cd-border-c px-2.5 py-1.5 text-xs">
                  <FileText className="w-3.5 h-3.5 cd-text-primary shrink-0" />
                  <button type="button" onClick={() => openViewer(str(d.document_id))} className="truncate cd-text hover:underline text-left flex-1 min-w-0" title={str(d.display_name)}>
                    {str(d.display_name)}
                  </button>
                  <span className="cd-text-faint shrink-0">{str(d.document_type) === "amendment" ? "변경계약서" : "계약서"}</span>
                  <span className="cd-text-faint shrink-0 font-mono">{str(d.created_at).slice(0, 10)}</span>
                  {canEdit && (
                    <button type="button" onClick={() => onDeleteDocument(str(d.document_id), str(d.display_name))} className="rounded-lg p-0.5 cd-text-faint hover:cd-error-text" title="삭제">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {canDelete && (
        <div className="flex justify-end pt-2 border-t cd-border-c">
          <button type="button" onClick={onDeleteContract} className="cd-btn cd-btn-danger rounded-lg px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1">
            <Trash2 className="w-3.5 h-3.5" /> 계약 삭제
          </button>
        </div>
      )}

      {facilityInfoOpen && (
        <FacilityInfoModal
          title="계약상대 업체"
          facilities={[{ facilityId: str(contract.counterparty_facility_id), companyName: str(contract.counterparty_name) }]}
          onClose={() => setFacilityInfoOpen(false)}
        />
      )}
    </div>
  );
}

function swap(ids: string[], a: number, b: number): string[] {
  const next = [...ids];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
