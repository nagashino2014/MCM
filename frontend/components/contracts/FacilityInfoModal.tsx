"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, ExternalLink, Landmark, X } from "lucide-react";
import { FinLogo } from "@/components/finance/FinLogo";

/** 계약 상세에서 업체명·대상사업장 KPI를 눌렀을 때 띄우는 사업장 정보 팝업. */
interface FacilityInfoTarget {
  facilityId: string;
  companyName: string;
}

/** /api/facilities/[id]/deposits 응답 — 거래 은행 태그 + 입금 내역 상세 모달 데이터. */
interface DepositBankSummary {
  bankName: string;
  bankCode: string | null;
  count: number;
  totalAmount: number;
}

interface DepositRow {
  milestoneId: string;
  contractId: string;
  contractTitle: string;
  stageLabel: string;
  paymentMethod: string | null;
  invoiceIssuedAt: string | null;
  invoiceAmount: number | null;
  collected: boolean;
  remaining: number;
  depositAt: string | null;
  depositAmount: number | null;
  bankName: string | null;
  bankCode: string | null;
  matched: boolean;
  noteKind: string | null;
  noteBank: string | null;
  noteMaturityDate: string | null;
  noteLoanExecutedDate: string | null;
}

interface DepositData {
  banks: DepositBankSummary[];
  rows: DepositRow[];
}

interface FacilityInfo {
  facilityId: string;
  companyName: string;
  businessRegistrationNo: string | null;
  representativeName: string | null;
  siteAddress: string | null;
  additionalSiteAddresses?: string[];
  phoneNumber: string | null;
  industryName: string | null;
  industryCode: string | null;
  industries?: Array<{ code: string | null; name: string | null }>;
  businessCertificateBusinessType: string | null;
  businessCertificateBusinessItem: string | null;
  regionSido: string | null;
  regionSigungu: string | null;
  companySize: string | null;
  isClosed?: boolean;
  permits?: Array<{ permit_id?: string; permitId?: string }>;
}

export default function FacilityInfoModal({
  title,
  facilities,
  onClose,
}: {
  title: string;
  facilities: FacilityInfoTarget[];
  onClose: () => void;
}) {
  const [activeId, setActiveId] = useState(facilities[0]?.facilityId ?? "");
  const [info, setInfo] = useState<FacilityInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deposits, setDeposits] = useState<DepositData | null>(null);
  const [depositsLoading, setDepositsLoading] = useState(false);
  const [depositDetailOpen, setDepositDetailOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/facilities/${encodeURIComponent(activeId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("사업장 정보를 불러오지 못했습니다.");
        return (await res.json()) as FacilityInfo;
      })
      .then(setInfo)
      .catch((err) => {
        if (!controller.signal.aborted) {
          setInfo(null);
          setError((err as Error).message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [activeId]);

  // 거래 은행 카드용 — 확정 수금 대조(바로빌 계좌·엑셀 업로드 원장)에서 집계한 입금 은행.
  useEffect(() => {
    if (!activeId) return;
    const controller = new AbortController();
    setDeposits(null);
    setDepositDetailOpen(false);
    setDepositsLoading(true);
    fetch(`/api/facilities/${encodeURIComponent(activeId)}/deposits`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error("입금 내역을 불러오지 못했습니다.");
        return (await res.json()) as DepositData;
      })
      .then(setDeposits)
      .catch(() => {
        if (!controller.signal.aborted) setDeposits(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDepositsLoading(false);
      });
    return () => controller.abort();
  }, [activeId]);

  // 지역 컬럼이 빈 사업장(거래처 등록 경로는 95%가 미기재 — 2026-08-24 실사)은
  // 소재지 앞 두 토큰(시도 시군구)으로 파생해 표시한다.
  const region =
    [info?.regionSido, info?.regionSigungu].filter(Boolean).join(" ") ||
    (info?.siteAddress ?? "").trim().split(/\s+/).slice(0, 2).join(" ");
  const businessType = [info?.businessCertificateBusinessType, info?.businessCertificateBusinessItem]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="fixed inset-0 z-50 bg-stone-950/20 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="cd-card rounded-3xl w-[min(720px,calc(100vw-32px))] max-h-[min(720px,calc(100vh-32px))] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b cd-border-c flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold cd-text inline-flex items-center gap-2">
              <Building2 className="w-4 h-4 cd-text-primary" />
              {title}
            </h3>
            <p className="text-xs cd-text-faint mt-1">사업장 마스터에 등록된 정보입니다.</p>
          </div>
          <button type="button" onClick={onClose} className="cd-text-faint hover:opacity-70">
            <X className="w-5 h-5" />
          </button>
        </div>

        {facilities.length > 1 && (
          <div className="px-5 pt-3 flex gap-1 flex-wrap">
            {facilities.map((facility) => (
              <button
                key={facility.facilityId}
                type="button"
                onClick={() => setActiveId(facility.facilityId)}
                className={
                  "rounded-lg px-3 py-1.5 text-xs font-bold " +
                  (activeId === facility.facilityId
                    ? "cd-fill-primary text-white shadow-sm"
                    : "border cd-border-c cd-text-muted hover:bg-[color:var(--cd-surface)]")
                }
              >
                {facility.companyName}
              </button>
            ))}
          </div>
        )}

        <div className="p-5 overflow-y-auto scrollbar-hide">
          {loading ? (
            <p className="py-10 text-center text-sm cd-text-faint">불러오는 중…</p>
          ) : error ? (
            <p className="py-10 text-center text-sm cd-error-text">{error}</p>
          ) : !info ? (
            <p className="py-10 text-center text-sm cd-text-faint">사업장 정보가 없습니다.</p>
          ) : (
            <div className="grid gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-bold cd-text">{info.companyName}</span>
                {info.isClosed && (
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: "#FCEBEB", color: "#791F1F" }}>
                    폐업
                  </span>
                )}
                {info.companySize && (
                  <span className="rounded-full border cd-border-c px-2 py-0.5 text-[11px] cd-text-muted">{info.companySize}</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="사업자등록번호" value={info.businessRegistrationNo} />
                <Field label="대표자" value={info.representativeName} />
                <Field label="전화번호" value={info.phoneNumber} />
                <Field label="지역" value={region} />
                <Field label="소재지" value={info.siteAddress} wide />
                {(info.additionalSiteAddresses ?? []).length > 0 && (
                  <Field label="추가 소재지" value={(info.additionalSiteAddresses ?? []).join(" / ")} wide />
                )}
                <IndustryField
                  industries={info.industries ?? []}
                  fallbackCode={info.industryCode}
                  fallbackName={info.industryName}
                />
                {businessType && <Field label="업태·종목" value={businessType} wide />}
                <Field label="통합허가 건수" value={info.permits?.length ? `${info.permits.length}건` : "-"} />
                <DepositBanksField
                  deposits={deposits}
                  loading={depositsLoading}
                  onOpenDetail={() => setDepositDetailOpen(true)}
                />
              </div>
            </div>
          )}
        </div>

        <div className="p-5 border-t cd-border-c flex justify-between items-center gap-2">
          {activeId ? (
            <Link
              href={`/facilities?focus=${encodeURIComponent(activeId)}`}
              className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs cd-text-primary inline-flex items-center gap-1.5"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              사업장 화면에서 보기
            </Link>
          ) : (
            <span />
          )}
          <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost rounded-xl px-4 py-2 text-sm font-bold cd-text-muted">
            닫기
          </button>
        </div>
      </div>

      {/* cd-card 는 backdrop-filter 때문에 fixed 자손의 containing block 이 된다 → 카드 밖에서 렌더 */}
      {depositDetailOpen && (
        <DepositHistoryModal
          companyName={info?.companyName ?? title}
          deposits={deposits}
          onClose={() => setDepositDetailOpen(false)}
        />
      )}
    </div>
  );
}

const formatAmount = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;

/** 지급 방식 요약 — "어음 : 2개월 이하" → "어음". 원문은 title 로 남긴다. */
const paymentMethodShort = (method: string | null) => {
  if (!method) return null;
  return method.startsWith("어음") ? "어음" : method;
};

/** 거래 은행 카드 — 확정된 수금 대조로 확인된 입금 은행을 태그로 보여준다. */
function DepositBanksField({
  deposits,
  loading,
  onOpenDetail,
}: {
  deposits: DepositData | null;
  loading: boolean;
  onOpenDetail: () => void;
}) {
  const banks = deposits?.banks ?? [];
  const hasRows = (deposits?.rows.length ?? 0) > 0;
  return (
    <div className="rounded-2xl border cd-border-c p-3">
      <p className="text-[11px] cd-text-faint">거래 은행</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {loading ? (
            <span className="text-sm cd-text-faint">확인 중…</span>
          ) : banks.length === 0 ? (
            <span className="text-sm cd-text" title="계좌 원장과 확정 대조된 입금이 아직 없습니다.">-</span>
          ) : (
            banks.map((bank) => (
              <span
                key={bank.bankName}
                className="inline-flex items-center gap-1 rounded-full cd-tint-primary px-2 py-0.5 text-[11px] font-bold cd-text-primary"
                title={`${bank.bankName} 입금 ${bank.count}건 · ${formatAmount(bank.totalAmount)}`}
              >
                <FinLogo kind="bank" code={bank.bankCode ?? ""} label={bank.bankName} size={16} />
                {bank.bankName}
              </span>
            ))
          )}
        </div>
        {hasRows && (
          <button
            type="button"
            onClick={onOpenDetail}
            className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[11px] font-bold cd-text-primary shrink-0 inline-flex items-center gap-1"
          >
            <Landmark className="w-3 h-3" />
            상세 보기
          </button>
        )}
      </div>
    </div>
  );
}

/** 입금 내역 상세 — 이 거래처 계약의 모든 청구 단계(수금·미수)를 입금 단위로 펼쳐 보여준다. */
function DepositHistoryModal({
  companyName,
  deposits,
  onClose,
}: {
  companyName: string;
  deposits: DepositData | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const rows = deposits?.rows ?? [];
  const depositedRows = rows.filter((row) => row.depositAmount != null);
  const uncollectedRows = rows.filter((row) => !row.collected && row.remaining > 0);
  const depositedTotal = depositedRows.reduce((acc, row) => acc + (row.depositAmount ?? 0), 0);
  const uncollectedTotal = uncollectedRows.reduce((acc, row) => acc + row.remaining, 0);

  return (
    <div className="fixed inset-0 z-[60] bg-stone-950/30 flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div
        className="cd-card rounded-3xl w-[min(980px,calc(100vw-32px))] max-h-[min(720px,calc(100vh-32px))] shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 border-b cd-border-c flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold cd-text inline-flex items-center gap-2">
              <Landmark className="w-4 h-4 cd-text-primary" />
              {companyName} 입금 내역
            </h3>
            <p className="text-xs cd-text-faint mt-1">
              입금 {depositedRows.length}건 {formatAmount(depositedTotal)}
              {uncollectedRows.length > 0 && (
                <>
                  {" · "}
                  <span className="cd-error-text">미수 {uncollectedRows.length}건 {formatAmount(uncollectedTotal)}</span>
                </>
              )}
              {" — 입금 은행은 계좌 원장(바로빌·엑셀 업로드)과 확정 대조된 건만 표시됩니다."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="cd-text-faint hover:opacity-70">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto scrollbar-hide">
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm cd-text-faint">이 거래처의 청구·수금 내역이 없습니다.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border cd-border-c">
              <table className="w-full text-sm min-w-[860px]">
                <thead>
                  <tr className="text-left text-[11px] cd-text-faint border-b cd-border-c">
                    <th className="px-3 py-2 font-bold">용역명</th>
                    <th className="px-3 py-2 font-bold">청구 단계</th>
                    <th className="px-3 py-2 font-bold">계산서 발행일</th>
                    <th className="px-3 py-2 font-bold text-right">입금액</th>
                    <th className="px-3 py-2 font-bold">입금일자</th>
                    <th className="px-3 py-2 font-bold">입금은행</th>
                    <th className="px-3 py-2 font-bold">지급 방식</th>
                    <th className="px-3 py-2 font-bold">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => {
                    const uncollected = !row.collected && row.depositAmount == null;
                    const method = paymentMethodShort(row.paymentMethod);
                    return (
                      <tr key={`${row.milestoneId}-${idx}`} className="border-b cd-border-c last:border-b-0">
                        <td className="px-3 py-2 cd-text break-words max-w-[240px]">{row.contractTitle || "-"}</td>
                        <td className="px-3 py-2 cd-text whitespace-nowrap">{row.stageLabel || "-"}</td>
                        <td className="px-3 py-2 cd-text-muted whitespace-nowrap tabular-nums">{row.invoiceIssuedAt ?? "-"}</td>
                        <td className="px-3 py-2 cd-text text-right whitespace-nowrap tabular-nums">
                          {row.depositAmount != null ? formatAmount(row.depositAmount) : "-"}
                        </td>
                        <td className="px-3 py-2 cd-text-muted whitespace-nowrap tabular-nums">{row.depositAt ?? "-"}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {row.bankName ? (
                            <span className="inline-flex items-center gap-1.5 cd-text">
                              <FinLogo kind="bank" code={row.bankCode ?? ""} label={row.bankName} size={18} />
                              {row.bankName}
                            </span>
                          ) : (
                            <span className="cd-text-faint" title={row.depositAmount != null ? "계좌 원장과 대조되지 않은 수기 수금 기록입니다." : undefined}>-</span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {method ? (
                            <span className="cd-text" title={row.paymentMethod ?? undefined}>
                              {method}
                              {method === "어음" && (row.noteKind || row.noteBank) ? (
                                <span className="cd-text-faint"> · {[row.noteKind, row.noteBank].filter(Boolean).join(" · ")}</span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="cd-text-faint">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {uncollected ? (
                            <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: "#FCEBEB", color: "#791F1F" }}>
                              미수
                            </span>
                          ) : row.collected ? (
                            <span className="rounded-full px-2 py-0.5 text-[11px] font-bold cd-tint-primary cd-text-primary">수금</span>
                          ) : (
                            <span className="rounded-full border cd-border-c px-2 py-0.5 text-[11px] font-bold cd-text-muted">부분입금</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="p-5 border-t cd-border-c flex justify-end">
          <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost rounded-xl px-4 py-2 text-sm font-bold cd-text-muted">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 업종은 여러 건이 붙는 경우가 많다. 코드와 명을 하나로 이어 붙이면 이름 뭉치 뒤에
 * 코드 뭉치가 따라붙어 짝을 알 수 없으므로, 한 줄에 한 업종씩 코드(좌)·명(우)로 나눠 적는다.
 */
function IndustryField({
  industries,
  fallbackCode,
  fallbackName,
}: {
  industries: Array<{ code: string | null; name: string | null }>;
  fallbackCode: string | null;
  fallbackName: string | null;
}) {
  const rows = industries.length
    ? industries
    : fallbackCode || fallbackName
      ? [{ code: fallbackCode, name: fallbackName }]
      : [];
  return (
    <div className="rounded-2xl border cd-border-c p-3 col-span-2">
      <p className="text-[11px] cd-text-faint">업종</p>
      {rows.length === 0 ? (
        <p className="text-sm mt-1 cd-text">-</p>
      ) : (
        <div className="mt-1 grid gap-1">
          {rows.map((row, idx) => (
            <div key={`${row.code ?? ""}-${idx}`} className="grid grid-cols-[76px_1fr] gap-2 items-baseline">
              <span className="font-mono text-xs cd-text-faint tabular-nums">{row.code || "-"}</span>
              <span className="text-sm cd-text break-words">{row.name || "-"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, wide }: { label: string; value: string | null | undefined; wide?: boolean }) {
  return (
    <div className={"rounded-2xl border cd-border-c p-3 " + (wide ? "col-span-2" : "")}>
      <p className="text-[11px] cd-text-faint">{label}</p>
      <p className="text-sm mt-1 cd-text break-words">{value || "-"}</p>
    </div>
  );
}
