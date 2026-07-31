"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, ExternalLink, X } from "lucide-react";

/** 계약 상세에서 업체명·대상사업장 KPI를 눌렀을 때 띄우는 사업장 정보 팝업. */
interface FacilityInfoTarget {
  facilityId: string;
  companyName: string;
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

  const region = [info?.regionSido, info?.regionSigungu].filter(Boolean).join(" ");
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
