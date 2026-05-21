"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, ShieldAlert, Save } from "lucide-react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import {
  FACILITY_COMPANY_SIZE_LABELS,
  FACILITY_COMPANY_SIZE_ORDER,
  FACILITY_SERVICE_COLORS,
  FACILITY_SERVICE_LABELS,
  FACILITY_SERVICE_ORDER,
  type FacilityCompanySize,
  type FacilityServiceCategory,
} from "@/lib/ieps/facility-service";

export default function NewFacilityPage() {
  return (
    <ToastProvider>
      <Inner />
    </ToastProvider>
  );
}

function Inner() {
  const { data: session, status: sessionStatus } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const canEdit = role === "admin" || role === "editor";

  const router = useRouter();
  const toast = useToast();

  const [companyName, setCompanyName] = useState("");
  const [brn, setBrn] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [industryCode, setIndustryCode] = useState("");
  const [industryName, setIndustryName] = useState("");
  const [alias, setAlias] = useState("");
  const [serviceCategories, setServiceCategories] = useState<FacilityServiceCategory[]>(["integrated"]);
  const [companySize, setCompanySize] = useState<FacilityCompanySize | "">("");
  const [memo, setMemo] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sessionStatus === "loading") {
    return <div className="p-8 text-stone-400 text-sm">세션 확인 중…</div>;
  }
  if (!canEdit) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="glass-card rounded-3xl p-10 text-center max-w-md">
          <ShieldAlert className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-stone-800 mb-1">권한이 없습니다</h2>
          <p className="text-sm text-stone-500">사업장 등록은 편집자 이상 권한이 필요합니다.</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/facilities/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyName,
          businessRegistrationNo: brn || null,
          siteAddress: siteAddress || null,
          phoneNumber: phoneNumber || null,
          industryCode: industryCode || null,
          industryName: industryName || null,
          aliases: alias.trim() ? [{ alias: alias.trim(), aliasType: "site", isPrimary: true }] : [],
          serviceCategories,
          companySize: companySize || null,
          memo: memo || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      const body = (await res.json()) as { facilityId?: string; updatedExisting?: boolean };
      toast.show(body.updatedExisting ? "기존 사업장 정보를 갱신했습니다." : "사업장이 등록되었습니다.");
      router.replace(body.facilityId ? "/facilities?focus=" + body.facilityId : "/facilities");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-2">
      <section className="glass-panel p-8 rounded-3xl relative overflow-hidden reveal">
        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <Link
              href="/facilities"
              className="inline-flex items-center gap-1 text-xs font-bold text-stone-500 hover:text-primary mb-2"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> 사업장 마스터로
            </Link>
            <h1 className="text-3xl font-bold text-stone-800 mb-2">사업장 수동 등록</h1>
            <p className="text-stone-600 text-base max-w-3xl">
              IEPS 게시판에서 자동 수집되지 않은 사업장을 직접 등록합니다.
              source=manual 로 표시되며 향후 IEPS 데이터와 자동 병합되지 않습니다 (필요 시 “중복 병합”에서 수동 병합).
            </p>
          </div>
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-primary/10 to-transparent pointer-events-none" />
      </section>

      <section className="glass-panel rounded-3xl p-6 reveal delay-1 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="상호 *">
          <input
            className="input-field"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder="예: 주식회사 OO"
            required
          />
        </Field>
        <Field label="사업자등록번호">
          <input
            className="input-field"
            value={brn}
            onChange={(e) => setBrn(e.target.value)}
            placeholder="123-45-67890"
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="소재지">
            <input
              className="input-field"
              value={siteAddress}
              onChange={(e) => setSiteAddress(e.target.value)}
              placeholder="경기도 화성시 ..."
            />
          </Field>
        </div>
        <Field label="전화번호">
          <input
            className="input-field"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="031-000-0000"
          />
        </Field>
        <Field label="업종 코드 (5자리)">
          <input
            className="input-field"
            value={industryCode}
            onChange={(e) => setIndustryCode(e.target.value)}
            placeholder="예: 22221"
            maxLength={5}
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="업종명">
            <input
              className="input-field"
              value={industryName}
              onChange={(e) => setIndustryName(e.target.value)}
              placeholder="예: 자동차용 플라스틱 부품 제조업"
            />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="사업장 별칭">
            <input
              className="input-field"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="예: 여수1공장, TDI공장"
            />
          </Field>
        </div>
        <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="대상 용역 카테고리">
            <div className="flex flex-wrap gap-2">
              {FACILITY_SERVICE_ORDER.map((category) => (
                <label key={category} className="flex items-center gap-1.5 text-xs font-bold text-stone-700">
                  <input
                    type="checkbox"
                    checked={serviceCategories.includes(category)}
                    onChange={(e) =>
                      setServiceCategories((prev) =>
                        e.target.checked ? [...prev, category] : prev.filter((item) => item !== category)
                      )
                    }
                  />
                  <span className="rounded-full px-2 py-0.5" style={{ background: FACILITY_SERVICE_COLORS[category] }}>
                    {FACILITY_SERVICE_LABELS[category]}
                  </span>
                </label>
              ))}
            </div>
          </Field>
          <Field label="사업장 규모">
            <select
              className="ui-select"
              value={companySize}
              onChange={(e) => setCompanySize(e.target.value as FacilityCompanySize | "")}
            >
              <option value="">미지정</option>
              {FACILITY_COMPANY_SIZE_ORDER.map((size) => (
                <option key={size} value={size}>
                  {FACILITY_COMPANY_SIZE_LABELS[size]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="메모">
            <textarea
              className="ui-textarea"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="등록 사유, 출처, 영업 상태 등 자유 메모"
            />
          </Field>
        </div>

        {error && (
          <div className="md:col-span-2 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            {error}
          </div>
        )}

        <div className="md:col-span-2 flex items-center justify-end gap-2 pt-2 border-t border-stone-200/70">
          <Link
            href="/facilities"
            className="glass-button rounded-xl px-4 py-2 text-sm font-bold text-stone-700"
          >
            취소
          </Link>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending || !companyName.trim()}
            className="rounded-xl px-4 py-2 text-sm font-bold text-white bg-primary hover:bg-primary/90 shadow-sm flex items-center gap-1 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {pending ? "저장 중…" : "등록"}
          </button>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">
        {label}
      </span>
      {children}
    </div>
  );
}
