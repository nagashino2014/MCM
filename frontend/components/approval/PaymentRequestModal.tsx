"use client";

// 대금청구서 작성 모달(2026-08-24) — 공문 작성 화면(ApprovalLetterBoard)의 첨부서류 섹션에서
// 준공계 메뉴로 가지 않고 대금청구서를 바로 만들어 첨부한다. 계약 검색 → 청구 단계 선택 →
// VAT 표기·통장 사본·별첨 문구 → 생성(deliverables POST/PATCH/attach 3콜, docTypes 는
// payment_request 단독). 산출 PDF 는 리디자인 렌더러(lib/deliverable/payment-pdf.ts)가 그린다.

import { useEffect, useState } from "react";
import { FileText, Loader2, Search, X } from "lucide-react";
import { BANK_ACCOUNT_OPTIONS, PAYMENT_BANK_KEY } from "@/lib/deliverable/types";

interface ContractRow {
  contractId: string;
  title: string;
  ordererName: string;
  contractDate?: string | null;
}

interface MilestoneRow {
  milestoneId: string;
  stageLabel: string;
  stageOrder: number;
  amount: number | null;
  invoiceIssued?: boolean;
}

export interface PaymentRequestCreated {
  deliverableId: string;
  attachment: { name: string; key: string; size: number } | null;
  storageError: string | null;
  subject: string;
  bodyHtml: string;
  attachItems: string[];
  recipient: { name: string; facilityName: string; address: string | null } | null;
}

const fmt = (n: number | null | undefined) => (n && n > 0 ? Math.round(n).toLocaleString("ko-KR") : "0");

export default function PaymentRequestModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (result: PaymentRequestCreated) => void;
}) {
  const [query, setQuery] = useState("");
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [contract, setContract] = useState<ContractRow | null>(null);
  const [milestones, setMilestones] = useState<MilestoneRow[]>([]);
  const [milestoneId, setMilestoneId] = useState("");
  const [vatNote, setVatNote] = useState("VAT 별도");
  const [bankKey, setBankKey] = useState("");
  const [attachNote, setAttachNote] = useState("법인 통장 사본 1부");
  const [serverValues, setServerValues] = useState<Record<string, unknown> | null>(null);
  const [loadingCtx, setLoadingCtx] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 계약 검색(디바운스) — 준공계 작성 화면과 같은 sources API.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || contract) {
      setContracts([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/contracts/deliverables/sources?q=${encodeURIComponent(q)}&limit=15`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const d = (await res.json()) as { contracts?: ContractRow[] };
        setContracts(d.contracts ?? []);
      } catch {
        /* 무시 */
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, contract]);

  // 계약·단계·VAT 가 정해지면 자동채움 값(금액 분해 포함)을 서버에서 받는다.
  useEffect(() => {
    if (!contract) return;
    let alive = true;
    setLoadingCtx(true);
    const params = new URLSearchParams({ contractId: contract.contractId, kind: "completion", vatNote });
    if (milestoneId) params.set("milestoneId", milestoneId);
    fetch(`/api/contracts/deliverables/sources?${params.toString()}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error ?? "계약 정보를 불러오지 못했습니다.");
        if (!alive) return;
        const ms: MilestoneRow[] = Array.isArray(d.contract?.milestones) ? d.contract.milestones : [];
        setMilestones(ms);
        setServerValues((d.values ?? {}) as Record<string, unknown>);
        // 서버가 고른 청구 회차(준공·잔금 우선)를 초기 선택으로 반영
        const chosen = String(d.values?.["meta.milestoneId"] ?? "");
        if (!milestoneId && chosen && chosen !== "virtual-1") setMilestoneId(chosen);
        setError(null);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      })
      .finally(() => {
        if (alive) setLoadingCtx(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract, milestoneId, vatNote]);

  const curTotal = Number(serverValues?.["completion.curTotal"] ?? 0);
  const stageLabel = String(serverValues?.["meta.stageLabel"] ?? "");

  const create = async () => {
    if (!contract || !serverValues) return;
    setBusy(true);
    setError(null);
    try {
      const createRes = await fetch("/api/contracts/deliverables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractId: contract.contractId,
          kind: "completion",
          templateId: null,
          docTypes: ["payment_request"],
          milestoneId: milestoneId || null,
        }),
      });
      const created = await createRes.json();
      if (!createRes.ok) throw new Error(created?.error ?? "대금청구서 생성 실패");
      const id = String(created.deliverableId);

      const values = {
        ...serverValues,
        [PAYMENT_BANK_KEY]: bankKey,
        "payment.attachNote": attachNote.trim(),
      };
      const patchRes = await fetch(`/api/contracts/deliverables/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, docTypes: ["payment_request"], templateId: null }),
      });
      if (!patchRes.ok) {
        const d = await patchRes.json().catch(() => ({}));
        throw new Error((d as { error?: string })?.error ?? "대금청구서 저장 실패");
      }

      const attachRes = await fetch(`/api/contracts/deliverables/${encodeURIComponent(id)}/attach`, { method: "POST" });
      const attachData = (await attachRes.json()) as PaymentRequestCreated & { error?: string };
      if (!attachRes.ok) throw new Error(attachData?.error ?? "대금청구서 PDF 생성 실패");
      onCreated({ ...attachData, deliverableId: id });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative cd-solid-bg border cd-border-c rounded-3xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-2xl" style={{ maxWidth: 640 }}>
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b cd-border-c">
          <h3 className="font-bold cd-text flex items-center gap-2">
            <FileText className="w-4 h-4" /> 대금청구서 작성
          </h3>
          <button type="button" onClick={onClose} className="cd-text-muted hover:cd-text">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
          {/* 계약 선택 */}
          <div className="relative">
            <span className="text-[11px] cd-text-faint font-semibold">계약</span>
            {contract ? (
              <div className="flex items-center gap-2 mt-1 rounded-xl border cd-border-c px-3 py-2">
                <span className="cd-text font-medium truncate flex-1">{contract.title}</span>
                <span className="text-xs cd-text-faint shrink-0">{contract.ordererName}</span>
                <button
                  type="button"
                  className="text-xs underline cd-text-faint shrink-0"
                  onClick={() => {
                    setContract(null);
                    setMilestones([]);
                    setMilestoneId("");
                    setServerValues(null);
                    setQuery("");
                  }}
                >
                  변경
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mt-1">
                  <Search className="w-4 h-4 cd-text-faint shrink-0" />
                  <input
                    className="cd-input flex-1"
                    placeholder="계약명 또는 발주처 검색 (2자 이상)"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    autoFocus
                  />
                </div>
                {contracts.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl border cd-border-c cd-card-bg shadow-lg max-h-56 overflow-y-auto">
                    {contracts.map((c) => (
                      <button
                        key={c.contractId}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-[color:var(--cd-surface)]"
                        onClick={() => setContract(c)}
                      >
                        <span className="cd-text">{c.title}</span>
                        <span className="ml-2 text-xs cd-text-faint">{c.ordererName}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {contract && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">
                  <span className="text-[11px] cd-text-faint font-semibold">청구 단계</span>
                  <select className="cd-select" value={milestoneId} onChange={(e) => setMilestoneId(e.target.value)}>
                    {milestones.length === 0 && <option value="">회차 없음 — 계약금액 전액</option>}
                    {milestones.map((m) => (
                      <option key={m.milestoneId} value={m.milestoneId}>
                        {m.stageLabel || `${m.stageOrder}차`} — {fmt(m.amount)}원{m.invoiceIssued ? " (발행됨)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] cd-text-faint font-semibold">VAT 표기</span>
                  <select className="cd-select" value={vatNote} onChange={(e) => setVatNote(e.target.value)}>
                    <option value="VAT 별도">VAT 별도 (금액에 가산)</option>
                    <option value="VAT 포함">VAT 포함 (금액에서 역산)</option>
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] cd-text-faint font-semibold">법인통장 사본(별첨 병합)</span>
                  <select className="cd-select" value={bankKey} onChange={(e) => setBankKey(e.target.value)}>
                    <option value="">통장 사본 선택 안 함</option>
                    {BANK_ACCOUNT_OPTIONS.map((b) => (
                      <option key={b.key} value={b.key}>법인통장 사본 — {b.label}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-[11px] cd-text-faint font-semibold">별첨 문구</span>
                  <input className="cd-input" value={attachNote} onChange={(e) => setAttachNote(e.target.value)} />
                </label>
              </div>

              {/* 청구 요약 */}
              <div className="rounded-xl border cd-border-c px-3.5 py-2.5 flex items-center gap-3">
                {loadingCtx ? (
                  <span className="text-xs cd-text-faint flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> 금액 계산 중…
                  </span>
                ) : (
                  <>
                    <span className="text-xs cd-text-muted">금회 청구금액{stageLabel ? ` (${stageLabel})` : ""}</span>
                    <b className="ml-auto tabular-nums cd-text-primary">{fmt(curTotal)}원</b>
                    <span className="text-[11px] cd-text-faint">{vatNote} 합계</span>
                  </>
                )}
              </div>
            </>
          )}

          {error && <div className="text-xs text-rose-600">{error}</div>}
          <p className="text-[11px] cd-text-faint">
            생성하면 대금청구서 PDF(통장 사본 병합 포함)가 이 공문의 첨부에 추가되고, 제목·본문·붙임이 비어 있으면
            대금 청구 문구로 채워집니다. 준공계와 함께 보내려면 준공계 작성 메뉴에서 서식에 대금청구서를 추가하세요.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t cd-border-c">
          <button type="button" className="rounded-xl border cd-border-c px-3.5 py-2 text-sm cd-text-muted" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="rounded-xl px-3.5 py-2 text-sm text-white cd-fill-primary disabled:opacity-50 inline-flex items-center gap-1.5"
            disabled={busy || !contract || loadingCtx || !serverValues}
            onClick={() => void create()}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            생성 및 첨부
          </button>
        </div>
      </div>
    </div>
  );
}
