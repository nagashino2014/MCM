"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, CalendarDays, FileSignature, Paperclip, RefreshCw, Search, WalletCards } from "lucide-react";
import { ToastProvider, useToast } from "@/components/ui/Toast";

interface ContractListItem {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  facilityName: string | null;
  legacyCompanyId: string | null;
  serviceType: string | null;
  contractStatus: string;
  currentAmount: number | null;
  contractDate: string | null;
  startedAt: string | null;
  endedAt: string | null;
  milestoneCount: number;
  issuedCount: number;
  collectedCount: number;
  totalMilestoneAmount: number;
  totalIssuedAmount: number;
  totalCollectedAmount: number;
}

interface ContractDetail {
  contract: Record<string, unknown>;
  milestones: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
  changes: Array<Record<string, unknown>>;
}

interface InvoiceModalState {
  milestoneId: string;
  stageLabel: string;
  issueDate: string;
  invoiceAmount: string;
  paymentCollected: boolean;
  paymentCollectedAt: string;
  file: File | null;
}

export default function ContractsPage() {
  return (
    <ToastProvider>
      <ContractsInner />
    </ToastProvider>
  );
}

function ContractsInner() {
  const toast = useToast();
  const [items, setItems] = useState<ContractListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState({ q: "", year: "", serviceType: "", collection: "" });
  const [invoiceModal, setInvoiceModal] = useState<InvoiceModalState | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filter.q) params.set("q", filter.q);
      if (filter.year) params.set("year", filter.year);
      if (filter.serviceType) params.set("serviceType", filter.serviceType);
      if (filter.collection) params.set("collection", filter.collection);
      params.set("limit", "50");
      const res = await fetch("/api/contracts?" + params.toString(), { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      const json = (await res.json()) as { items: ContractListItem[]; total: number };
      setItems(json.items ?? []);
      setTotal(json.total ?? 0);
      setSelectedId((current) => current ?? json.items?.[0]?.contractId ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const loadDetail = useCallback(async (contractId: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch("/api/contracts/" + encodeURIComponent(contractId), { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      setDetail((await res.json()) as ContractDetail);
    } catch (err) {
      toast.show("상세 조회 실패: " + (err as Error).message, "error");
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const selected = useMemo(
    () => items.find((item) => item.contractId === selectedId) ?? null,
    [items, selectedId]
  );

  return (
    <div className="flex flex-col gap-6 p-2">
      <section className="rounded-3xl relative overflow-hidden reveal border border-zinc-800/10 bg-[#1f211d] text-stone-50 shadow-xl">
        <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_12%_20%,rgba(245,158,11,0.28),transparent_28%),radial-gradient(circle_at_88%_0%,rgba(20,184,166,0.18),transparent_30%)]" />
        <div className="relative z-10 p-8 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-black tracking-[0.24em] text-amber-300 uppercase">Contract Ledger</p>
            <h1 className="text-3xl font-black mt-2 mb-3 flex items-center gap-3">
              <FileSignature className="w-7 h-7 text-amber-300" />
              계약 관리
            </h1>
            <p className="text-stone-300 text-sm max-w-3xl">
              엑셀 계약현황의 원장 구조를 웹으로 이전해 계약, 단계별 청구·수금, 세금계산서 PDF를 함께 관리합니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/contracts/dashboard"
              className="rounded-xl px-3 py-2 text-xs font-black bg-amber-300 text-zinc-950 hover:bg-amber-200 flex items-center gap-1"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              Dashboard
            </Link>
            <button
              type="button"
              onClick={reload}
              className="rounded-xl px-3 py-2 text-xs font-bold border border-stone-500/40 text-stone-100 hover:bg-white/10 flex items-center gap-1"
            >
              <RefreshCw className={"w-3.5 h-3.5 " + (loading ? "animate-spin" : "")} />
              새로고침
            </button>
          </div>
        </div>
      </section>

      <section className="glass-card rounded-2xl p-4 reveal delay-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-[260px]">
            <Search className="w-4 h-4 text-stone-400" />
            <input
              type="text"
              className="input-field"
              placeholder="계약명 / 거래처 / 업체ID 검색"
              value={filter.q}
              onChange={(e) => setFilter({ ...filter, q: e.target.value })}
            />
          </div>
          <select className="ui-select text-xs w-28" value={filter.year} onChange={(e) => setFilter({ ...filter, year: e.target.value })}>
            <option value="">전체 연도</option>
            {Array.from({ length: 11 }, (_, index) => 2026 - index).map((year) => (
              <option key={year} value={String(year)}>
                {year}년
              </option>
            ))}
          </select>
          <select className="ui-select text-xs w-36" value={filter.serviceType} onChange={(e) => setFilter({ ...filter, serviceType: e.target.value })}>
            <option value="">전체 용역</option>
            {["HAPs", "통합허가", "장외&화관법", "ESG탄소중립", "기타"].map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <select className="ui-select text-xs w-36" value={filter.collection} onChange={(e) => setFilter({ ...filter, collection: e.target.value })}>
            <option value="">전체 수금상태</option>
            <option value="unissued">미발행 있음</option>
            <option value="uncollected">미수금 있음</option>
            <option value="issued">발행 있음</option>
            <option value="collected">수금 있음</option>
          </select>
        </div>
      </section>

      {error ? (
        <div className="glass-card rounded-2xl p-6 text-sm text-red-600">
          계약 데이터를 불러오지 못했습니다. `infra/aws/004_contract_management.sql` 적용 여부와 DB 연결을 확인하세요.
          <div className="mt-2 font-mono text-xs">{error}</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(360px,0.9fr)_minmax(520px,1.3fr)] gap-5">
          <section className="glass-card rounded-3xl overflow-hidden reveal delay-2">
            <div className="p-4 border-b border-stone-200/70 flex items-center justify-between">
              <div>
                <h2 className="font-black text-stone-800">계약 원장</h2>
                <p className="text-xs text-stone-500">총 {total.toLocaleString()}건</p>
              </div>
              <WalletCards className="w-5 h-5 text-amber-600" />
            </div>
            <div className="max-h-[720px] overflow-auto divide-y divide-stone-200/70">
              {items.map((item) => (
                <button
                  type="button"
                  key={item.contractId}
                  onClick={() => setSelectedId(item.contractId)}
                  className={
                    "w-full text-left p-4 hover:bg-amber-50/70 transition " +
                    (item.contractId === selectedId ? "bg-amber-50 border-l-4 border-amber-500" : "border-l-4 border-transparent")
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-sm text-stone-800 line-clamp-2">{item.contractTitle}</p>
                      <p className="text-xs text-stone-500 mt-1">
                        {item.counterpartyName} · {item.serviceType ?? "미분류"}
                      </p>
                    </div>
                    <span className="text-[11px] font-black text-stone-600 bg-white/70 rounded-full px-2 py-1 whitespace-nowrap">
                      {formatMoney(item.currentAmount)}
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-stone-500">
                    <span>발행 {item.issuedCount}/{item.milestoneCount}</span>
                    <span>수금 {item.collectedCount}/{item.milestoneCount}</span>
                    <span>{item.contractDate ?? item.startedAt ?? "-"}</span>
                  </div>
                </button>
              ))}
              {!loading && items.length === 0 && (
                <div className="p-10 text-center text-sm text-stone-500">조건에 맞는 계약이 없습니다.</div>
              )}
            </div>
          </section>

          <section className="glass-card rounded-3xl p-5 reveal delay-3 min-h-[720px]">
            {!selected ? (
              <div className="h-full flex items-center justify-center text-sm text-stone-500">계약을 선택하세요.</div>
            ) : detailLoading || !detail ? (
              <div className="h-full flex items-center justify-center text-sm text-stone-500">상세 정보를 불러오는 중입니다.</div>
            ) : (
              <ContractDetailPanel detail={detail} onOpenInvoice={setInvoiceModal} />
            )}
          </section>
        </div>
      )}

      {invoiceModal && selectedId && (
        <InvoiceUploadModal
          contractId={selectedId}
          state={invoiceModal}
          onChange={setInvoiceModal}
          onClose={() => setInvoiceModal(null)}
          onSaved={() => {
            setInvoiceModal(null);
            if (selectedId) loadDetail(selectedId);
            reload();
          }}
        />
      )}
    </div>
  );
}

function ContractDetailPanel({
  detail,
  onOpenInvoice,
}: {
  detail: ContractDetail;
  onOpenInvoice: (state: InvoiceModalState) => void;
}) {
  const contract = detail.contract;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-black text-amber-700 tracking-[0.18em] uppercase">Detail</p>
          <h2 className="text-2xl font-black text-stone-900 mt-1">{String(contract.contract_title ?? "")}</h2>
          <p className="text-sm text-stone-500 mt-2">
            {String(contract.counterparty_name ?? "")} · 업체ID {String(contract.legacy_company_id ?? "-")}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-stone-500">계약금액</p>
          <p className="text-xl font-black text-stone-900">{formatMoney(contract.current_amount ?? contract.contract_amount)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Info label="계약일" value={contract.contract_date ?? contract.started_at} />
        <Info label="준공일" value={contract.ended_at} />
        <Info label="용역분류" value={contract.service_type} />
        <Info label="상태" value={contract.contract_status} />
        <Info label="법인번호" value={contract.counterparty_corporate_registration_no} />
        <Info label="대표자" value={contract.counterparty_representative_name} />
        <Info label="사업장" value={contract.facility_name} />
        <Info label="통합허가 대상" value={contract.facility_integrated_permit_target} />
      </div>

      <div>
        <h3 className="font-black text-stone-800 mb-3">청구·수금 단계</h3>
        <div className="overflow-hidden rounded-2xl border border-stone-200/80">
          <table className="w-full text-sm">
            <thead className="bg-stone-900 text-stone-100 text-xs">
              <tr>
                <th className="text-left p-3">단계</th>
                <th className="text-right p-3">금액</th>
                <th className="text-center p-3">발행</th>
                <th className="text-center p-3">수금</th>
                <th className="text-right p-3">계산서</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200/70">
              {detail.milestones.map((milestone) => (
                <tr key={String(milestone.milestone_id)} className="bg-white/60">
                  <td className="p-3 font-bold text-stone-800">{String(milestone.stage_label ?? "")}</td>
                  <td className="p-3 text-right font-mono">{formatMoney(milestone.amount)}</td>
                  <td className="p-3 text-center">{Number(milestone.invoice_issued ?? 0) === 1 ? "발행" : "대기"}</td>
                  <td className="p-3 text-center">{Number(milestone.payment_collected ?? 0) === 1 ? "수금" : "미수"}</td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      className="rounded-lg px-2 py-1 text-xs font-bold bg-amber-400 text-zinc-950 hover:bg-amber-300 inline-flex items-center gap-1"
                      onClick={() =>
                        onOpenInvoice({
                          milestoneId: String(milestone.milestone_id ?? ""),
                          stageLabel: String(milestone.stage_label ?? ""),
                          issueDate: new Date().toISOString().slice(0, 10),
                          invoiceAmount: String(milestone.amount ?? ""),
                          paymentCollected: Number(milestone.payment_collected ?? 0) === 1,
                          paymentCollectedAt: String(milestone.payment_collected_at ?? ""),
                          file: null,
                        })
                      }
                    >
                      <Paperclip className="w-3 h-3" />
                      등록
                    </button>
                  </td>
                </tr>
              ))}
              {detail.milestones.length === 0 && (
                <tr>
                  <td className="p-6 text-center text-stone-500" colSpan={5}>
                    등록된 청구 단계가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="font-black text-stone-800 mb-3">세금계산서 파일</h3>
        <div className="grid gap-2">
          {detail.invoices.map((invoice) => (
            <a
              key={String(invoice.invoice_id)}
              href={String(invoice.public_path ?? "#")}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border border-stone-200/80 bg-white/60 px-3 py-2 text-sm hover:bg-amber-50 flex items-center justify-between gap-3"
            >
              <span>{String(invoice.document_display_name ?? invoice.invoice_id)}</span>
              <span className="text-xs text-stone-500">{String(invoice.issue_date ?? "")}</span>
            </a>
          ))}
          {detail.invoices.length === 0 && <p className="text-sm text-stone-500">등록된 세금계산서 PDF가 없습니다.</p>}
        </div>
      </div>
    </div>
  );
}

function InvoiceUploadModal({
  contractId,
  state,
  onChange,
  onClose,
  onSaved,
}: {
  contractId: string;
  state: InvoiceModalState;
  onChange: (state: InvoiceModalState) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!state.file) {
      toast.show("세금계산서 PDF 파일을 선택하세요.", "error");
      return;
    }
    setSaving(true);
    try {
      const form = new FormData();
      form.set("milestoneId", state.milestoneId);
      form.set("issueDate", state.issueDate);
      form.set("invoiceAmount", state.invoiceAmount);
      form.set("paymentCollected", state.paymentCollected ? "1" : "0");
      form.set("paymentCollectedAt", state.paymentCollectedAt);
      form.set("file", state.file);
      const res = await fetch(`/api/contracts/${encodeURIComponent(contractId)}/invoices`, { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      toast.show("세금계산서 정보를 등록했습니다.", "success");
      onSaved();
    } catch (err) {
      toast.show("등록 실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-3xl bg-[#24251f] text-stone-100 shadow-2xl border border-amber-300/20 overflow-hidden">
        <div className="p-5 border-b border-white/10 flex items-center justify-between">
          <div>
            <p className="text-xs font-black text-amber-300 tracking-[0.18em] uppercase">Tax Invoice</p>
            <h2 className="text-xl font-black mt-1">{state.stageLabel} 세금계산서 등록</h2>
          </div>
          <CalendarDays className="w-6 h-6 text-amber-300" />
        </div>
        <div className="p-5 grid gap-4">
          <label className="grid gap-1 text-sm">
            <span className="font-bold text-stone-300">계산서 발행일</span>
            <input type="date" className="input-field text-stone-900" value={state.issueDate} onChange={(e) => onChange({ ...state, issueDate: e.target.value })} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-bold text-stone-300">발행금액</span>
            <input type="number" className="input-field text-stone-900" value={state.invoiceAmount} onChange={(e) => onChange({ ...state, invoiceAmount: e.target.value })} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-bold text-stone-300">계산서 PDF 첨부</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-amber-300 file:px-3 file:py-2 file:text-xs file:font-black file:text-zinc-950"
              onChange={(e) => onChange({ ...state, file: e.target.files?.[0] ?? null })}
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-bold text-stone-300">
            <input type="checkbox" checked={state.paymentCollected} onChange={(e) => onChange({ ...state, paymentCollected: e.target.checked })} />
            수금 완료로 함께 등록
          </label>
          {state.paymentCollected && (
            <label className="grid gap-1 text-sm">
              <span className="font-bold text-stone-300">수금일</span>
              <input type="date" className="input-field text-stone-900" value={state.paymentCollectedAt} onChange={(e) => onChange({ ...state, paymentCollectedAt: e.target.value })} />
            </label>
          )}
          <p className="text-xs text-stone-400">
            저장 경로는 발행일 기준 `매출계산서/년도/분기` 논리 경로로 생성됩니다.
          </p>
        </div>
        <div className="p-5 border-t border-white/10 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-bold border border-white/20">
            닫기
          </button>
          <button type="button" onClick={submit} disabled={saving} className="rounded-xl px-4 py-2 text-sm font-black bg-amber-300 text-zinc-950 disabled:opacity-60">
            {saving ? "저장 중..." : "입력"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-2xl bg-white/60 border border-stone-200/80 p-3">
      <p className="text-[11px] font-black text-stone-400">{label}</p>
      <p className="text-sm font-bold text-stone-800 mt-1 truncate">{value == null || value === "" ? "-" : String(value)}</p>
    </div>
  );
}

function formatMoney(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "-";
  if (Math.abs(n) >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, "") + "억";
  if (Math.abs(n) >= 10000) return Math.round(n / 10000).toLocaleString() + "만";
  return n.toLocaleString();
}
