"use client";

// 전자세금계산서 발행 모달 (P4 F5) — 청구·수금 단계에서 바로 발행한다.
// 원칙: 국세청에 나가는 행위라 되돌리기가 제한적이므로, 화면에서 값을 전부 눈으로 확인하고 발행한다.
// - 공급자 = 회사 프로필, 공급받는자 = 계약 발주처(facilities) + 담당자 연락처에서 수신 이메일 선택.
// - 금액은 단계 금액이 공급가액인지 합계인지 사용자가 고른다(계약 데이터 관례가 섞여 있어 자동 판정하지 않음).

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ExternalLink, FileText, Loader2, X } from "lucide-react";

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
  writeDate: string;
  invoicer: {
    corpNum: string; corpName: string; ceoName: string; addr: string;
    bizClass: string; bizType: string; tel: string; contactId: string; contactName: string; email: string;
  };
  invoicee: { facilityId: string | null; corpNum: string; corpName: string; ceoName: string; addr: string };
  contacts: Contact[];
  existing: ExistingInvoice[];
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
  const [amountBase, setAmountBase] = useState<"supply" | "total">("supply"); // 단계 금액의 성격
  const [supplyInput, setSupplyInput] = useState("");
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
  // 추가 수신처 — 대표 수신처(email) 외에 계산서 발송 대상으로 고른 담당자들의 이메일.
  // 바로빌은 공급받는자 이메일을 1개만 받으므로, 추가분은 발행 후 앱이 안내 메일을 보낸다.
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState("");

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
        setSupplyInput(String(Math.round(p.stageAmount)));
        setItemName(`${p.contractTitle} ${p.stageLabel}`.trim());
        setInvoiceeCorpNum(p.invoicee.corpNum);
        setInvoiceeCorpName(p.invoicee.corpName);
        setInvoiceeCeo(p.invoicee.ceoName);
        setInvoiceeAddr(p.invoicee.addr);
        setInvoicerEmail(p.invoicer.email);
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

  // 금액 분해 — 면세(3)는 세액 0.
  const amounts = useMemo(() => {
    const input = Number(digits(supplyInput) || 0);
    if (taxType === 3) return { supply: input, tax: 0, total: input };
    if (amountBase === "total") {
      const supply = Math.round(input / 1.1);
      return { supply, tax: input - supply, total: input };
    }
    const tax = Math.round(input * 0.1);
    return { supply: input, tax, total: input + tax };
  }, [supplyInput, amountBase, taxType]);

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
          writeDate,
          amountTotal: amounts.supply,
          taxTotal: amounts.tax,
          totalAmount: amounts.total,
          taxType,
          purposeType,
          itemName,
          remark1,
          invoicee: {
            facilityId: prefill.invoicee.facilityId,
            corpNum: digits(invoiceeCorpNum),
            corpName: invoiceeCorpName,
            ceoName: invoiceeCeo,
            addr: invoiceeAddr,
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
  const canIssue =
    !busy && !loading && Boolean(prefill?.cert.ok) && amounts.total > 0 && digits(invoiceeCorpNum).length === 10 && Boolean(email) && Boolean(itemName.trim());

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative cd-solid-bg border cd-border-c rounded-3xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
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
                  <label className="block mt-2">
                    <span className="text-[11px] cd-text-faint">발행 담당자 이메일(필수)</span>
                    <input className="cd-input mt-0.5" value={invoicerEmail} onChange={(e) => setInvoicerEmail(e.target.value)} placeholder="발행자 이메일" />
                  </label>
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
                <label className="block">
                  <span className="text-[11px] cd-text-faint">품목</span>
                  <input className="cd-input mt-0.5" value={itemName} onChange={(e) => setItemName(e.target.value)} />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label>
                    <span className="text-[11px] cd-text-faint">금액 입력 (단계 금액 {fmt(prefill.stageAmount)}원)</span>
                    <input
                      className="cd-input mt-0.5 text-right font-mono"
                      inputMode="numeric"
                      value={supplyInput ? Number(digits(supplyInput)).toLocaleString("ko-KR") : ""}
                      onChange={(e) => setSupplyInput(digits(e.target.value))}
                    />
                  </label>
                  <label>
                    <span className="text-[11px] cd-text-faint">비고</span>
                    <input className="cd-input mt-0.5" value={remark1} onChange={(e) => setRemark1(e.target.value)} placeholder="선택" />
                  </label>
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
