"use client";

// 전자세금계산서 발행 모달 (P4 F5) — 청구·수금 단계에서 바로 발행한다.
// 원칙: 국세청에 나가는 행위라 되돌리기가 제한적이므로, 화면에서 값을 전부 눈으로 확인하고 발행한다.
// - 공급자 = 회사 프로필, 공급받는자 = 계약 발주처(facilities) + 담당자 연락처에서 수신 이메일 선택.
// - 금액은 단계 금액이 공급가액인지 합계인지 사용자가 고른다(계약 데이터 관례가 섞여 있어 자동 판정하지 않음).

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, FileText, ListPlus, Loader2, Plus, Trash2, X } from "lucide-react";

interface Contact {
  name: string;
  title: string | null;
  email: string | null;
  tel: string | null;
  mobile: string | null;
  /** 사업장 담당자 업무 분류 태그(187) — 'billing'이 계산서 수신 담당자. */
  deptTypes?: string[];
  billing?: boolean;
}

/** 품목 행 — 홈택스 발행 화면과 같은 축(품목명·규격·수량·단가·공급가액). 금액은 문자열(숫자만) 보관. */
interface LineItem {
  name: string;
  spec: string;
  qty: string;
  unitPrice: string;
  amount: string;
  /** 행 비고 — 계산서 비고(Remark1)로 합쳐 보낸다. 보통 1행이라 그대로 한 줄이 된다. */
  remark: string;
}

const emptyLine = (): LineItem => ({ name: "", spec: "", qty: "1", unitPrice: "", amount: "", remark: "" });

interface ExistingInvoice {
  invoiceId: string;
  mgtKey: string;
  writeDate: string;
  totalAmount: number;
  ntsSendState: number | null;
  ntsSendKey: string | null;
  canceledAt: string | null;
}

interface Prefill {
  contractId: string;
  milestoneId: string;
  contractTitle: string;
  stageLabel: string;
  stageAmount: number;
  contractAmount: number;
  defaultRemark: string;
  writeDate: string;
  invoicer: {
    corpNum: string; corpName: string; ceoName: string; addr: string;
    bizClass: string; bizType: string; tel: string; contactId: string; contactName: string; email: string;
  };
  invoicee: { facilityId: string | null; corpNum: string; corpName: string; ceoName: string; addr: string; bizType?: string; bizClass?: string };
  contacts: Contact[];
  issuerEmails: Array<{ email: string; label: string | null }>;
  existing: ExistingInvoice[];
  /** 이 계약의 미청구 단계 — 복수 단계를 한 장으로 묶어 발행할 때의 선택지(2026-08-24). */
  openStages?: Array<{ milestoneId: string; stageLabel: string; amount: number }>;
  cert: { ok: boolean; message: string };
}

const fmt = (n: number) => Math.round(n).toLocaleString("ko-KR");
const digits = (s: string) => s.replace(/[^0-9]/g, "");
/** 사업자번호 표시 — 입력 중에도 OOO-OO-OOOOO 로 자동 구분한다(저장·전송은 숫자만). */
const fmtCorpNum = (value: string) => {
  const d = digits(value).slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
};
const isEmail = (value: string) => /.+@.+\..+/.test(value.trim());

export default function TaxInvoiceIssueModal({
  contractId,
  milestoneId,
  onClose,
  onIssued,
}: {
  contractId: string;
  milestoneId: string;
  onClose: () => void;
  onIssued: () => void;
}) {
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 편집 상태
  const [writeDate, setWriteDate] = useState("");
  const [amountBase, setAmountBase] = useState<"supply" | "total">("supply"); // 입력 금액의 성격
  // 품목 행 — 보통 1행(계약 단계 = 청구 1건)이지만, 발주처가 요구하면 홈택스처럼 여러 줄로 발행한다.
  const [lineItems, setLineItems] = useState<LineItem[]>([emptyLine()]);
  const [taxType, setTaxType] = useState(1);
  const [purposeType, setPurposeType] = useState(2);
  const [itemName, setItemName] = useState("");
  const [remark1, setRemark1] = useState("");
  const [email, setEmail] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactTel, setContactTel] = useState("");
  const [invoiceeCorpNum, setInvoiceeCorpNum] = useState("");
  const [invoiceeCorpName, setInvoiceeCorpName] = useState("");
  const [invoiceeCeo, setInvoiceeCeo] = useState("");
  const [invoiceeAddr, setInvoiceeAddr] = useState("");
  const [invoicerEmail, setInvoicerEmail] = useState("");
  // 발행 담당자 이메일 목록(188) — 저장해 둔 주소를 눌러 바로 바꿔 쓴다.
  const [issuerEmails, setIssuerEmails] = useState<Array<{ email: string; label: string | null }>>([]);
  // 추가 수신처 — 대표 수신처(email) 외에 계산서 발송 대상으로 고른 담당자들의 이메일.
  // 바로빌은 공급받는자 이메일을 1개만 받으므로, 추가분은 발행 후 앱이 안내 메일을 보낸다.
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState("");
  // 묶음 발행(2026-08-24) — 복수 청구 단계를 한 장으로 발행. 현재 단계는 항상 포함.
  const [stagePickerOpen, setStagePickerOpen] = useState(false);
  const [bundledStageIds, setBundledStageIds] = useState<string[]>([milestoneId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/finance/tax-invoices?contractId=${encodeURIComponent(contractId)}&milestoneId=${encodeURIComponent(milestoneId)}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error ?? "발행 정보를 불러오지 못했습니다.");
        if (!alive) return;
        const p: Prefill = d.prefill;
        setPrefill(p);
        setWriteDate(p.writeDate);
        const stageAmount = String(Math.round(p.stageAmount));
        // 대금 지급 단계는 품목명이 아니라 비고에 "단계명 : 비중%" 으로 적는다.
        setLineItems([
          { name: p.contractTitle.trim(), spec: "", qty: "1", unitPrice: stageAmount, amount: stageAmount, remark: p.defaultRemark ?? "" },
        ]);
        setItemName(p.contractTitle.trim());
        setInvoiceeCorpNum(p.invoicee.corpNum);
        setInvoiceeCorpName(p.invoicee.corpName);
        setInvoiceeCeo(p.invoicee.ceoName);
        setInvoiceeAddr(p.invoicee.addr);
        setInvoicerEmail(p.invoicer.email);
        setIssuerEmails(p.issuerEmails ?? []);
        // 사업장 담당자에 '계산서' 태그가 지정돼 있으면 그 담당자가 기본 수신처다(첫 명이 대표, 나머지는 추가).
        const billing = p.contacts.filter((c) => c.billing && c.email);
        const primary = billing[0] ?? p.contacts.find((c) => c.email);
        if (primary) {
          setEmail(primary.email ?? "");
          setContactName(primary.name);
          setContactTel(primary.tel ?? primary.mobile ?? "");
        }
        setCcEmails(billing.filter((c) => c.email && c.email !== primary?.email).map((c) => c.email as string));
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [contractId, milestoneId]);

  // 금액 분해 — 행별로 공급가액/세액을 구하고 합산한다. 면세(3)는 세액 0.
  const amounts = useMemo(() => {
    const rows = lineItems.map((li) => {
      const input = Number(digits(li.amount) || 0);
      if (taxType === 3) return { supply: input, tax: 0 };
      if (amountBase === "total") {
        const supply = Math.round(input / 1.1);
        return { supply, tax: input - supply };
      }
      return { supply: input, tax: Math.round(input * 0.1) };
    });
    const supply = rows.reduce((acc, r) => acc + r.supply, 0);
    const tax = rows.reduce((acc, r) => acc + r.tax, 0);
    return { supply, tax, total: supply + tax, rows };
  }, [lineItems, amountBase, taxType]);

  /** 행 편집 — 수량·단가를 고치면 공급가액을 자동으로 다시 계산한다(직접 입력한 값은 그대로 둔다). */
  const updateLine = useCallback((index: number, patch: Partial<LineItem>) => {
    setLineItems((prev) =>
      prev.map((li, i) => {
        if (i !== index) return li;
        const next = { ...li, ...patch };
        if (patch.qty !== undefined || patch.unitPrice !== undefined) {
          const qty = Number(digits(next.qty) || 0);
          const unitPrice = Number(digits(next.unitPrice) || 0);
          if (qty > 0 && unitPrice > 0) next.amount = String(qty * unitPrice);
        }
        return next;
      }),
    );
  }, []);

  /**
   * 묶음 대상 단계 목록 — 현재 단계(항상 포함) + 이 계약의 다른 미청구 단계.
   * 현재 단계가 미청구 목록에도 있으면 중복 없이 한 번만 노출한다.
   */
  const bundleStages = useMemo(() => {
    if (!prefill) return [] as Array<{ milestoneId: string; stageLabel: string; amount: number }>;
    const current = { milestoneId, stageLabel: prefill.stageLabel, amount: prefill.stageAmount };
    const others = (prefill.openStages ?? []).filter((s) => s.milestoneId !== milestoneId);
    return [current, ...others];
  }, [prefill, milestoneId]);

  /**
   * 묶음 선택 반영 — 선택 단계 금액 합을 첫 품목의 단가·금액에, 비고에는
   * "단계명들 : 계약총액 대비 비중%" 를 넣는다(단일 발행의 defaultRemark 와 같은 형식).
   */
  const applyBundle = useCallback(
    (ids: string[]) => {
      setBundledStageIds(ids);
      const stages = bundleStages.filter((s) => ids.includes(s.milestoneId));
      const total = Math.round(stages.reduce((acc, s) => acc + (s.amount || 0), 0));
      const labels = stages.map((s) => s.stageLabel.trim()).filter(Boolean);
      const contractAmount = prefill?.contractAmount ?? 0;
      const pct = contractAmount > 0 && total > 0 ? Math.round((total / contractAmount) * 10000) / 100 : null;
      const remark = labels.length ? (pct != null ? `${labels.join(" + ")} : ${pct}%` : labels.join(" + ")) : "";
      setLineItems((prev) => {
        const first = prev[0] ?? emptyLine();
        return [
          { ...first, qty: "1", unitPrice: String(total), amount: String(total), remark },
          ...prev.slice(1),
        ];
      });
    },
    [bundleStages, prefill],
  );

  const toggleBundleStage = useCallback(
    (id: string) => {
      if (id === milestoneId) return; // 현재 단계는 항상 포함
      applyBundle(bundledStageIds.includes(id) ? bundledStageIds.filter((x) => x !== id) : [...bundledStageIds, id]);
    },
    [applyBundle, bundledStageIds, milestoneId],
  );

  /** 대표 수신처 지정 — 바로빌이 계산서 메일을 보내는 주소. */
  const pickContact = useCallback((c: Contact) => {
    setEmail(c.email ?? "");
    setContactName(c.name);
    setContactTel(c.tel ?? c.mobile ?? "");
    setCcEmails((prev) => prev.filter((e) => e !== c.email));
  }, []);

  /** 추가 수신처 토글 — 대표 수신처와 중복되지 않게 관리한다. */
  const toggleCc = useCallback(
    (address: string) => {
      const value = address.trim();
      if (!value) return;
      setCcEmails((prev) => (prev.includes(value) ? prev.filter((e) => e !== value) : [...prev, value]));
    },
    [],
  );

  /** 발행 담당자 이메일 저장·삭제 — 목록은 서버 응답으로 갱신한다. */
  const mutateIssuerEmail = async (action: "save-issuer-email" | "delete-issuer-email", address: string) => {
    setError(null);
    const res = await fetch("/api/finance/tax-invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, issuerEmail: address }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data?.error ?? "발행 담당자 이메일을 저장하지 못했습니다.");
      return;
    }
    setIssuerEmails(data.issuerEmails ?? []);
  };

  const issue = async () => {
    if (!prefill) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/finance/tax-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "issue",
          contractId,
          milestoneId,
          // 묶음 발행 — 이 계산서가 커버하는 단계 전부(서버가 일괄 발행 완료 마킹)
          milestoneIds: bundledStageIds,
          writeDate,
          amountTotal: amounts.supply,
          taxTotal: amounts.tax,
          totalAmount: amounts.total,
          taxType,
          purposeType,
          itemName: lineItems[0]?.name.trim() || itemName,
          items: lineItems
            .map((li, i) => ({ li, row: amounts.rows[i] }))
            .filter(({ li }) => li.name.trim() && Number(digits(li.amount) || 0) > 0)
            .map(({ li, row }) => ({
              name: li.name.trim(),
              spec: li.spec.trim() || undefined,
              qty: Number(digits(li.qty) || 1),
              unitPrice: Number(digits(li.unitPrice) || 0) || undefined,
              amount: row?.supply ?? 0,
              tax: row?.tax ?? 0,
            })),
          remark1: lineItems.map((li) => li.remark.trim()).filter(Boolean).join(" / ").slice(0, 100) || remark1,
          invoicee: {
            facilityId: prefill.invoicee.facilityId,
            corpNum: digits(invoiceeCorpNum),
            corpName: invoiceeCorpName,
            ceoName: invoiceeCeo,
            addr: invoiceeAddr,
            // 업태·종목(2026-08-26) — 사업장 사업자등록증 값 그대로 전달(서버도 비면 DB 로 보강).
            bizType: prefill.invoicee.bizType,
            bizClass: prefill.invoicee.bizClass,
            contactName,
            tel: contactTel,
            email,
            ccEmails: ccEmails.filter((e) => e !== email),
          },
          invoicer: { ...prefill.invoicer, corpNum: digits(prefill.invoicer.corpNum), email: invoicerEmail },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "발행에 실패했습니다.");
      onIssued();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openOriginal = async (invoiceId: string) => {
    const res = await fetch("/api/finance/tax-invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "popup-url", invoiceId }),
    });
    const data = await res.json();
    if (res.ok && data.url) window.open(data.url, "_blank", "noopener,width=1100,height=900");
    else setError(data?.error ?? "원본 보기 URL을 받지 못했습니다.");
  };

  const liveExisting = (prefill?.existing ?? []).filter((e) => !e.canceledAt);
  // 입력이 시작된 행은 품목명·금액이 모두 채워져야 발행한다(반쯤 적힌 행이 조용히 빠지지 않게).
  const filledLines = lineItems.filter((li) => li.name.trim() || digits(li.amount));
  const validLines = filledLines.filter((li) => li.name.trim() && Number(digits(li.amount) || 0) > 0);
  const canIssue =
    !busy &&
    !loading &&
    Boolean(prefill?.cert.ok) &&
    amounts.total > 0 &&
    digits(invoiceeCorpNum).length === 10 &&
    Boolean(email) &&
    validLines.length > 0 &&
    validLines.length === filledLines.length;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative cd-solid-bg border cd-border-c rounded-3xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
        style={{ maxWidth: 960 }}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b cd-border-c">
          <h3 className="font-bold cd-text flex items-center gap-2">
            <FileText className="w-4 h-4" /> 전자세금계산서 발행
          </h3>
          <button type="button" onClick={onClose} className="cd-text-muted hover:cd-text">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-sm">
          {loading && (
            <div className="py-10 text-center cd-text-muted">
              <Loader2 className="w-5 h-5 animate-spin inline" /> 불러오는 중…
            </div>
          )}

          {prefill && (
            <>
              {!prefill.cert.ok && (
                <div className="rounded-xl border p-3 text-xs" style={{ borderColor: "var(--cd-warning)", background: "var(--cd-warning-soft)" }}>
                  <div className="flex items-center gap-1.5 font-semibold mb-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> 발행할 수 없는 상태입니다
                  </div>
                  바로빌에 공급자 공동인증서가 등록되어 있어야 발행됩니다. ({prefill.cert.message})
                </div>
              )}

              {liveExisting.length > 0 && (
                <div className="rounded-xl border cd-border-c p-3">
                  <div className="text-xs font-semibold mb-1.5">이 단계에서 이미 발행된 계산서</div>
                  {liveExisting.map((inv) => (
                    <div key={inv.invoiceId} className="flex items-center gap-2 text-xs cd-text-muted">
                      <span>{inv.writeDate}</span>
                      <span className="font-medium cd-text">{fmt(inv.totalAmount)}원</span>
                      <span>{inv.ntsSendKey ? `승인번호 ${inv.ntsSendKey}` : "국세청 전송 대기"}</span>
                      <button type="button" className="inline-flex items-center gap-1 underline" onClick={() => void openOriginal(inv.invoiceId)}>
                        원본 보기 <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <p className="text-[11px] cd-text-faint mt-1">중복 발행에 주의하세요. 정정이 필요하면 전송 전에는 취소, 전송 후에는 수정세금계산서로 처리합니다.</p>
                </div>
              )}

              {/* 공급자 / 공급받는자 */}
              <div className="grid md:grid-cols-2 gap-3">
                <div className="rounded-xl border cd-border-c p-3">
                  <div className="text-xs font-semibold mb-2">공급자 (우리 회사)</div>
                  <div className="text-xs cd-text-muted space-y-0.5">
                    <div className="cd-text font-medium">{prefill.invoicer.corpName}</div>
                    <div>사업자번호 {fmtCorpNum(prefill.invoicer.corpNum) || "—"}</div>
                    <div>대표 {prefill.invoicer.ceoName || "—"}</div>
                    <div className="truncate" title={prefill.invoicer.addr}>{prefill.invoicer.addr || "—"}</div>
                  </div>
                  <div className="mt-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] cd-text-faint">발행 담당자 이메일(필수)</span>
                      <button
                        type="button"
                        className="rounded-xl border cd-border-c px-2 py-0.5 text-[11px] disabled:opacity-40"
                        disabled={!isEmail(invoicerEmail) || issuerEmails.some((it) => it.email === invoicerEmail.trim())}
                        title="이 주소를 목록에 저장"
                        onClick={() => void mutateIssuerEmail("save-issuer-email", invoicerEmail.trim())}
                      >
                        목록에 저장
                      </button>
                    </div>
                    <input className="cd-input mt-0.5" value={invoicerEmail} onChange={(e) => setInvoicerEmail(e.target.value)} placeholder="발행자 이메일" />
                    {issuerEmails.length > 0 && (
                      <div className="rounded-xl border cd-border-c mt-1.5 max-h-28 overflow-y-auto">
                        {issuerEmails.map((it) => {
                          const on = it.email === invoicerEmail.trim();
                          return (
                            <div key={it.email} className="flex items-center gap-2 px-2 py-1 text-[11px] border-b cd-border-c last:border-b-0">
                              <button
                                type="button"
                                className="flex-1 text-left truncate"
                                onClick={() => setInvoicerEmail(it.email)}
                                title={it.email}
                              >
                                <span className={on ? "cd-text font-semibold" : "cd-text-muted"}>{it.email}</span>
                                {it.label && <span className="cd-text-faint ml-1.5">{it.label}</span>}
                              </button>
                              {on && <span className="rounded-full px-1.5 py-0.5 cd-tint-primary">사용 중</span>}
                              {!it.label && (
                                <button
                                  type="button"
                                  className="cd-text-faint hover:cd-text"
                                  title="목록에서 삭제"
                                  onClick={() => void mutateIssuerEmail("delete-issuer-email", it.email)}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border cd-border-c p-3">
                  <div className="text-xs font-semibold mb-2">공급받는자 (발주처)</div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="col-span-2">
                      <span className="text-[11px] cd-text-faint">상호</span>
                      <input className="cd-input mt-0.5" value={invoiceeCorpName} onChange={(e) => setInvoiceeCorpName(e.target.value)} />
                    </label>
                    <label>
                      <span className="text-[11px] cd-text-faint">사업자번호</span>
                      <input
                        className="cd-input mt-0.5"
                        value={fmtCorpNum(invoiceeCorpNum)}
                        onChange={(e) => setInvoiceeCorpNum(digits(e.target.value).slice(0, 10))}
                        inputMode="numeric"
                        placeholder="000-00-00000"
                      />
                    </label>
                    <label>
                      <span className="text-[11px] cd-text-faint">대표자</span>
                      <input className="cd-input mt-0.5" value={invoiceeCeo} onChange={(e) => setInvoiceeCeo(e.target.value)} />
                    </label>
                    <label className="col-span-2">
                      <span className="text-[11px] cd-text-faint">주소</span>
                      <input className="cd-input mt-0.5" value={invoiceeAddr} onChange={(e) => setInvoiceeAddr(e.target.value)} />
                    </label>
                  </div>
                </div>
              </div>

              {/* 수신처 — 사업장 담당자('계산서' 태그)에서 불러온다. 대표 1명 + 추가 수신처(복수). */}
              <div className="rounded-xl border cd-border-c p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-xs font-semibold">계산서 수신처</div>
                  <div className="text-[11px] cd-text-faint">사업장 상세 &gt; 담당자에 &lsquo;계산서&rsquo; 태그를 지정하면 기본 수신처가 됩니다.</div>
                </div>
                <div className="rounded-xl border cd-border-c max-h-40 overflow-y-auto mb-2">
                  {prefill.contacts.length === 0 && (
                    <div className="px-2.5 py-3 text-[11px] cd-text-faint">등록된 사업장 담당자가 없습니다. 아래에 직접 입력해 발행할 수 있습니다.</div>
                  )}
                  {prefill.contacts.map((c, i) => {
                    const isPrimary = Boolean(c.email) && c.email === email;
                    const isCc = c.email != null && ccEmails.includes(c.email);
                    return (
                      <div key={`${c.name}:${i}`} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] border-b cd-border-c last:border-b-0">
                        <input
                          type="checkbox"
                          checked={isPrimary || isCc}
                          disabled={!c.email || isPrimary}
                          onChange={() => c.email && toggleCc(c.email)}
                          title={isPrimary ? "대표 수신처는 해제할 수 없습니다" : "계산서 발송 대상에 추가"}
                        />
                        <span className="cd-text font-medium">{c.name}</span>
                        {c.title && <span className="cd-text-muted">{c.title}</span>}
                        {c.billing && <span className="rounded-full px-1.5 py-0.5 cd-tint-primary">계산서</span>}
                        <span className="cd-text-faint truncate flex-1" title={c.email ?? ""}>{c.email ?? "이메일 없음"}</span>
                        {isPrimary ? (
                          <span className="rounded-full border cd-border-c px-2 py-0.5 cd-text-muted">대표</span>
                        ) : (
                          <button
                            type="button"
                            className="rounded-full border cd-border-c px-2 py-0.5 hover:cd-soft-primary disabled:opacity-40"
                            disabled={!c.email}
                            onClick={() => pickContact(c)}
                          >
                            대표로
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label>
                    <span className="text-[11px] cd-text-faint">담당자</span>
                    <input className="cd-input mt-0.5" value={contactName} onChange={(e) => setContactName(e.target.value)} />
                  </label>
                  <label>
                    <span className="text-[11px] cd-text-faint">연락처</span>
                    <input className="cd-input mt-0.5" value={contactTel} onChange={(e) => setContactTel(e.target.value)} />
                  </label>
                  <label>
                    <span className="text-[11px] cd-text-faint">이메일(필수) · 대표 수신처</span>
                    <input className="cd-input mt-0.5" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </label>
                </div>

                {/* 추가 수신처 — 바로빌 메일은 대표 1명에게만 나가고, 이쪽은 발행 직후 앱이 안내 메일을 보낸다. */}
                <div className="mt-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] cd-text-faint">추가 수신처</span>
                    {ccEmails.filter((e) => e !== email).map((address) => (
                      <span key={address} className="inline-flex items-center gap-1 rounded-full border cd-border-c px-2 py-0.5 text-[11px]">
                        {address}
                        <button type="button" className="cd-text-faint" onClick={() => toggleCc(address)}>
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    {ccEmails.filter((e) => e !== email).length === 0 && <span className="text-[11px] cd-text-faint">없음</span>}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <input
                      className="cd-input"
                      style={{ maxWidth: 260 }}
                      value={ccInput}
                      placeholder="목록에 없는 주소 직접 추가"
                      onChange={(e) => setCcInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" || !isEmail(ccInput)) return;
                        e.preventDefault();
                        toggleCc(ccInput);
                        setCcInput("");
                      }}
                    />
                    <button
                      type="button"
                      className="rounded-xl border cd-border-c px-2.5 py-1.5 text-[11px] disabled:opacity-40"
                      disabled={!isEmail(ccInput)}
                      onClick={() => {
                        toggleCc(ccInput);
                        setCcInput("");
                      }}
                    >
                      추가
                    </button>
                  </div>
                  {ccEmails.filter((e) => e !== email).length > 0 && (
                    <p className="text-[11px] cd-text-faint mt-1">
                      계산서 원본 메일은 바로빌이 대표 수신처로 보내고, 추가 수신처에는 발행 직후 발행 안내 메일이 따로 나갑니다.
                    </p>
                  )}
                </div>
              </div>

              {/* 발행 내용 */}
              <div className="rounded-xl border cd-border-c p-3 space-y-2">
                <div className="text-xs font-semibold">발행 내용</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <label>
                    <span className="text-[11px] cd-text-faint">작성일자</span>
                    <input type="date" className="cd-input mt-0.5" value={writeDate} onChange={(e) => setWriteDate(e.target.value)} />
                  </label>
                  <label>
                    <span className="text-[11px] cd-text-faint">과세 구분</span>
                    <select className="cd-input mt-0.5" value={taxType} onChange={(e) => setTaxType(Number(e.target.value))}>
                      <option value={1}>과세</option>
                      <option value={2}>영세</option>
                      <option value={3}>면세</option>
                    </select>
                  </label>
                  <label>
                    <span className="text-[11px] cd-text-faint">영수/청구</span>
                    <select className="cd-input mt-0.5" value={purposeType} onChange={(e) => setPurposeType(Number(e.target.value))}>
                      <option value={2}>청구</option>
                      <option value={1}>영수</option>
                    </select>
                  </label>
                  <label>
                    <span className="text-[11px] cd-text-faint">입력 금액 기준</span>
                    <select className="cd-input mt-0.5" value={amountBase} onChange={(e) => setAmountBase(e.target.value as "supply" | "total")}>
                      <option value="supply">공급가액(부가세 별도)</option>
                      <option value="total">합계금액(부가세 포함)</option>
                    </select>
                  </label>
                </div>
                {/* 품목 — 보통 1행이면 충분하지만, 홈택스처럼 여러 줄로 나눠 발행할 수도 있다. */}
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] cd-text-faint">품목 (단계 금액 {fmt(prefill.stageAmount)}원)</span>
                    <div className="flex items-center gap-1.5">
                      {/* 복수 청구 단계 묶음 발행(2026-08-24) — 미청구 단계를 골라 합산 발행 */}
                      <button
                        type="button"
                        className={
                          "rounded-xl border px-2.5 py-1 text-[11px] inline-flex items-center gap-1 " +
                          (bundledStageIds.length > 1 ? "cd-tint-primary border-[color:var(--cd-primary)]" : "cd-border-c")
                        }
                        onClick={() => setStagePickerOpen((v) => !v)}
                        title="미청구 대금 지급 단계를 묶어 한 장으로 발행"
                      >
                        <ListPlus className="w-3 h-3" /> 청구 단계 추가
                        {bundledStageIds.length > 1 && <span>({bundledStageIds.length})</span>}
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border cd-border-c px-2.5 py-1 text-[11px] inline-flex items-center gap-1"
                        onClick={() => setLineItems((prev) => [...prev, emptyLine()])}
                      >
                        <Plus className="w-3 h-3" /> 품목 추가
                      </button>
                    </div>
                  </div>
                  {stagePickerOpen && (
                    <div className="rounded-xl border cd-border-c p-2.5 mt-1.5">
                      <div className="text-[11px] cd-text-faint mb-1.5">
                        함께 묶어 발행할 미청구 단계를 선택하세요. 선택 합계가 첫 품목의 단가에, 단계명과 계약금액
                        대비 비율이 비고에 자동 반영됩니다.
                      </div>
                      {bundleStages.map((s) => {
                        const isCurrent = s.milestoneId === milestoneId;
                        return (
                          <label
                            key={s.milestoneId}
                            className="flex items-center gap-2 px-1 py-1 text-[11px] border-b cd-border-c last:border-b-0 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={bundledStageIds.includes(s.milestoneId)}
                              disabled={isCurrent}
                              onChange={() => toggleBundleStage(s.milestoneId)}
                              title={isCurrent ? "발행을 연 단계는 항상 포함됩니다" : undefined}
                            />
                            <span className="cd-text font-medium">{s.stageLabel || "(단계명 없음)"}</span>
                            {isCurrent && <span className="rounded-full border cd-border-c px-1.5 py-0.5 cd-text-faint">현재 단계</span>}
                            <span className="cd-text-muted ml-auto tabular-nums">{fmt(s.amount)}원</span>
                          </label>
                        );
                      })}
                      {bundleStages.length <= 1 && (
                        <div className="px-1 py-1.5 text-[11px] cd-text-faint">묶을 수 있는 다른 미청구 단계가 없습니다.</div>
                      )}
                    </div>
                  )}
                  <div className="grid grid-cols-[1fr_92px_56px_104px_112px_150px_24px] gap-1.5 mt-1 text-[11px] cd-text-faint">
                    <span>품목명</span>
                    <span>규격</span>
                    <span className="text-right">수량</span>
                    <span className="text-right">단가</span>
                    <span className="text-right">{amountBase === "total" ? "합계금액" : "공급가액"}</span>
                    <span>비고 (지급 단계 · 비중)</span>
                    <span />
                  </div>
                  {lineItems.map((li, i) => (
                    <div key={i} className="grid grid-cols-[1fr_92px_56px_104px_112px_150px_24px] gap-1.5 mt-1 items-center">
                      <input className="cd-input" value={li.name} onChange={(e) => updateLine(i, { name: e.target.value })} placeholder="품목명" />
                      <input className="cd-input" value={li.spec} onChange={(e) => updateLine(i, { spec: e.target.value })} placeholder="선택" />
                      <input
                        className="cd-input text-right font-mono"
                        inputMode="numeric"
                        value={li.qty}
                        onChange={(e) => updateLine(i, { qty: digits(e.target.value) })}
                      />
                      <input
                        className="cd-input text-right font-mono"
                        inputMode="numeric"
                        value={li.unitPrice ? Number(digits(li.unitPrice)).toLocaleString("ko-KR") : ""}
                        onChange={(e) => updateLine(i, { unitPrice: digits(e.target.value) })}
                      />
                      <input
                        className="cd-input text-right font-mono"
                        inputMode="numeric"
                        value={li.amount ? Number(digits(li.amount)).toLocaleString("ko-KR") : ""}
                        onChange={(e) => updateLine(i, { amount: digits(e.target.value) })}
                      />
                      <input
                        className="cd-input"
                        value={li.remark}
                        onChange={(e) => updateLine(i, { remark: e.target.value })}
                        placeholder="예) 준공금 : 100%"
                      />
                      {lineItems.length > 1 ? (
                        <button
                          type="button"
                          className="cd-text-faint hover:cd-text"
                          title="이 품목 삭제"
                          onClick={() => setLineItems((prev) => prev.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                  ))}
                  {lineItems.length > 1 && (
                    <p className="text-[11px] cd-text-faint mt-1">
                      품목이 여러 줄이면 각 행의 금액을 합산해 발행합니다. 세액 반올림 잔차는 마지막 행에서 보정됩니다.
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-4 text-xs pt-1">
                  <span>
                    <span className="cd-text-muted mr-1">공급가액</span>
                    <b className="font-mono">{fmt(amounts.supply)}</b>
                  </span>
                  <span>
                    <span className="cd-text-muted mr-1">세액</span>
                    <b className="font-mono">{fmt(amounts.tax)}</b>
                  </span>
                  <span>
                    <span className="cd-text-muted mr-1">합계</span>
                    <b className="font-mono text-[13px]">{fmt(amounts.total)}원</b>
                  </span>
                </div>
              </div>

              <p className="text-[11px] cd-text-faint">
                발행하면 바로빌이 공급받는자에게 메일을 보내고, 국세청 전송은 통상 익일 일괄 처리됩니다. 발행 즉시 이 단계는 계산서 발행 완료로 기록됩니다.
              </p>
              {error && <div className="text-xs text-rose-600">{error}</div>}
            </>
          )}
          {!prefill && !loading && error && <div className="text-xs text-rose-600">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t cd-border-c">
          <button type="button" className="rounded-xl border cd-border-c px-3.5 py-2 text-sm cd-text-muted" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="rounded-xl px-3.5 py-2 text-sm text-white cd-fill-primary disabled:opacity-50 inline-flex items-center gap-1.5"
            disabled={!canIssue}
            onClick={issue}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {fmt(amounts.total)}원 발행
          </button>
        </div>
      </div>
    </div>
  );
}
