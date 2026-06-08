"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { ArrowLeft, FileText, ShieldAlert, Save, Upload, Plus, Trash2 } from "lucide-react";
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

interface IndustryInputRow {
  code: string;
  name: string;
}

interface BusinessCertificateKindInput {
  businessType: string;
  businessItem: string;
}

interface DuplicateFacilityInfo {
  facilityId: string;
  companyName: string | null;
  businessRegistrationNo: string | null;
  siteAddress: string | null;
  matchType: "businessRegistrationNo" | "companyAddress";
}

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
  const [representativeName, setRepresentativeName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [industryRows, setIndustryRows] = useState<IndustryInputRow[]>([{ code: "", name: "" }]);
  const [certificateBusinessKinds, setCertificateBusinessKinds] = useState<BusinessCertificateKindInput[]>([
    { businessType: "", businessItem: "" },
  ]);
  const [certificateCorporateNo, setCertificateCorporateNo] = useState("");
  const [certificateOcrText, setCertificateOcrText] = useState("");
  const [certificateFileName, setCertificateFileName] = useState("");
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [certificateParsing, setCertificateParsing] = useState(false);
  const [certificateWarning, setCertificateWarning] = useState<string | null>(null);
  const [alias, setAlias] = useState("");
  const [serviceCategories, setServiceCategories] = useState<FacilityServiceCategory[]>(["integrated"]);
  const [companySize, setCompanySize] = useState<FacilityCompanySize | "">("");
  const [memo, setMemo] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateFacility, setDuplicateFacility] = useState<DuplicateFacilityInfo | null>(null);

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

  const handleSubmit = async (options?: { allowDuplicateBrn?: boolean }) => {
    setPending(true);
    setError(null);
    setDuplicateFacility(null);
    try {
      const normalizedIndustryRows = industryRows
        .map((row) => ({ code: row.code.trim(), name: row.name.trim() }))
        .filter((row) => row.code || row.name);
      const normalizedCertificateKinds = certificateBusinessKinds
        .map((row) => ({ businessType: row.businessType.trim(), businessItem: row.businessItem.trim() }))
        .filter((row) => row.businessType || row.businessItem);
      const res = await fetch("/api/facilities/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyName,
          businessRegistrationNo: brn || null,
          representativeName: representativeName || null,
          siteAddress: siteAddress || null,
          phoneNumber: phoneNumber || null,
          industryCode: normalizedIndustryRows.map((row) => row.code).join("\n") || null,
          industryName: normalizedIndustryRows.map((row) => row.name).join("\n") || null,
          businessCertificateBusinessType: normalizedCertificateKinds.map((row) => row.businessType).join("\n") || null,
          businessCertificateBusinessItem: normalizedCertificateKinds.map((row) => row.businessItem).join("\n") || null,
          businessCertificateCorporateRegistrationNo: certificateCorporateNo || null,
          businessCertificateOcrText: certificateOcrText || null,
          aliases: alias.trim() ? [{ alias: alias.trim(), aliasType: "site", isPrimary: true }] : [],
          serviceCategories,
          companySize: companySize || null,
          memo: memo || null,
          allowDuplicateBusinessRegistrationNo: options?.allowDuplicateBrn ?? false,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (res.status === 409 && body?.duplicateFacility) {
          setDuplicateFacility(body.duplicateFacility as DuplicateFacilityInfo);
          setError(body?.error ?? "이미 등록된 사업장입니다.");
          return;
        }
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      const body = (await res.json()) as { facilityId?: string; updatedExisting?: boolean };
      if (body.facilityId && certificateFile) {
        const certForm = new FormData();
        certForm.set("file", certificateFile);
        certForm.set("useParsedResult", "1");
        certForm.set("businessType", normalizedCertificateKinds.map((row) => row.businessType).join("\n"));
        certForm.set("businessItem", normalizedCertificateKinds.map((row) => row.businessItem).join("\n"));
        certForm.set("corporateRegistrationNo", certificateCorporateNo);
        certForm.set("ocrText", certificateOcrText);
        certForm.set("representativeName", representativeName);
        const certRes = await fetch(`/api/facilities/${encodeURIComponent(body.facilityId)}/business-certificates`, {
          method: "POST",
          body: certForm,
        });
        if (!certRes.ok) {
          const certBody = await certRes.json().catch(() => ({}));
          toast.show("사업장은 등록됐지만 사업자등록증 저장 실패: " + (certBody?.error ?? certRes.status), "error");
        }
      }
      toast.show(body.updatedExisting ? "기존 사업장 정보를 갱신했습니다." : "사업장이 등록되었습니다.");
      router.replace(body.facilityId ? "/facilities?focus=" + body.facilityId : "/facilities");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const parseBusinessCertificate = async (file: File) => {
    setCertificateFile(file);
    setCertificateFileName(file.name);
    setCertificateParsing(true);
    setCertificateWarning(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch("/api/facilities/business-certificate/parse", {
        method: "POST",
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error ?? "HTTP " + res.status);
      if (!companyName.trim() && body.companyName) setCompanyName(String(body.companyName));
      if (!brn.trim() && body.businessRegistrationNo) setBrn(String(body.businessRegistrationNo));
      if (!representativeName.trim() && body.representativeName) setRepresentativeName(String(body.representativeName));
      if (!siteAddress.trim() && body.siteAddress) setSiteAddress(String(body.siteAddress));
      const parsedKinds = Array.isArray(body.businessKinds)
        ? body.businessKinds
            .map((item: { businessType?: unknown; businessItem?: unknown }) => ({
              businessType: String(item.businessType ?? "").trim(),
              businessItem: String(item.businessItem ?? "").trim(),
            }))
            .filter((item: BusinessCertificateKindInput) => item.businessType || item.businessItem)
        : [];
      setCertificateBusinessKinds(
        parsedKinds.length
          ? parsedKinds
          : [{ businessType: String(body.businessType ?? ""), businessItem: String(body.businessItem ?? "") }]
      );
      setCertificateCorporateNo(String(body.corporateRegistrationNo ?? ""));
      setCertificateOcrText(String(body.ocrText ?? ""));
      setCertificateWarning(body.warning ? String(body.warning) : null);
      toast.show(body.warning ? "자동 추출 결과를 확인해 주세요." : "사업자등록증 정보를 추출했습니다.");
    } catch (err) {
      setCertificateWarning("자동 추출 실패: " + (err as Error).message + " 수동 입력해 주세요.");
    } finally {
      setCertificateParsing(false);
    }
  };

  const updateIndustryRow = (index: number, patch: Partial<IndustryInputRow>) => {
    setIndustryRows((prev) => prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  };

  const removeIndustryRow = (index: number) => {
    setIndustryRows((prev) => (prev.length <= 1 ? [{ code: "", name: "" }] : prev.filter((_, idx) => idx !== index)));
  };

  const updateCertificateKind = (index: number, patch: Partial<BusinessCertificateKindInput>) => {
    setCertificateBusinessKinds((prev) => prev.map((row, idx) => (idx === index ? { ...row, ...patch } : row)));
  };

  const removeCertificateKind = (index: number) => {
    setCertificateBusinessKinds((prev) =>
      prev.length <= 1 ? [{ businessType: "", businessItem: "" }] : prev.filter((_, idx) => idx !== index)
    );
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
        <Field label="대표자명">
          <textarea
            className="input-field"
            value={representativeName}
            onChange={(e) => setRepresentativeName(e.target.value)}
            placeholder={"예: 홍길동\n복수 대표자는 줄바꿈으로 구분"}
            rows={2}
          />
        </Field>
        <div className="md:col-span-2 rounded-2xl border border-stone-200 bg-white/50 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <h2 className="text-sm font-black text-stone-800 flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              업종 코드 기반
            </h2>
            <p className="text-xs text-stone-500 mt-1">통합허가 계획서 또는 공장등록증 등에 기재된 표준산업분류 코드를 입력합니다.</p>
          </div>
          <div className="md:col-span-2 grid gap-2">
            {industryRows.map((row, index) => (
              <div key={index} className="grid grid-cols-1 md:grid-cols-[150px_1fr_auto] gap-2 items-end">
                <Field label={index === 0 ? "업종 코드 (5자리)" : "업종 코드"}>
                  <input
                    className="input-field"
                    value={row.code}
                    onChange={(e) => updateIndustryRow(index, { code: e.target.value })}
                    placeholder="예: 22221"
                    maxLength={5}
                  />
                </Field>
                <Field label={index === 0 ? "업종명" : "업종명"}>
                  <input
                    className="input-field"
                    value={row.name}
                    onChange={(e) => updateIndustryRow(index, { name: e.target.value })}
                    placeholder="예: 자동차용 플라스틱 부품 제조업"
                  />
                </Field>
                <div className="flex gap-1 pb-1">
                  <button
                    type="button"
                    className="rounded-lg border border-stone-200 bg-white px-2 py-2 text-stone-600 hover:bg-stone-50"
                    onClick={() => setIndustryRows((prev) => [...prev, { code: "", name: "" }])}
                    title="업종 행 추가"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-red-100 bg-red-50 px-2 py-2 text-red-600 hover:bg-red-100"
                    onClick={() => removeIndustryRow(index)}
                    title="업종 행 삭제"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="md:col-span-2 rounded-2xl border border-stone-200 bg-white/50 p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2 flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-black text-stone-800 flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                사업자등록증 기반
              </h2>
              <p className="text-xs text-stone-500 mt-1">
                사업자등록증 PDF의 사업의 종류 항목에서 업태·종목을, 등록증의 법인등록번호를 자동 추출합니다.
              </p>
            </div>
            <label className="rounded-xl px-3 py-2 text-xs font-bold text-white bg-primary hover:bg-primary/90 cursor-pointer inline-flex items-center gap-1">
              <Upload className="w-3.5 h-3.5" />
              {certificateParsing ? "추출 중..." : "PDF 첨부·추출"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                disabled={certificateParsing}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) parseBusinessCertificate(file);
                }}
              />
            </label>
          </div>
          {certificateFileName && (
            <p className="md:col-span-2 text-xs text-stone-500">첨부 파일: {certificateFileName}</p>
          )}
          {certificateWarning && (
            <div className="md:col-span-2 text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              {certificateWarning}
            </div>
          )}
          <div className="md:col-span-2 grid gap-2">
            <div className="text-[11px] font-bold text-stone-500">
              사업자등록증의 업태·종목이 여러 행으로 기재된 경우 각각 행을 나눠 보정하세요.
            </div>
            {certificateBusinessKinds.map((row, index) => (
              <div key={index} className="grid grid-cols-1 md:grid-cols-[180px_1fr_auto] gap-2 items-end">
                <Field label={index === 0 ? "업태" : "업태"}>
                  <input
                    className="input-field"
                    value={row.businessType}
                    onChange={(e) => updateCertificateKind(index, { businessType: e.target.value })}
                    placeholder="예: 제조업"
                  />
                </Field>
                <Field label={index === 0 ? "종목" : "종목"}>
                  <input
                    className="input-field"
                    value={row.businessItem}
                    onChange={(e) => updateCertificateKind(index, { businessItem: e.target.value })}
                    placeholder="예: 건설용기계, 농업기계"
                  />
                </Field>
                <div className="flex gap-1 pb-1">
                  <button
                    type="button"
                    className="rounded-lg border border-stone-200 bg-white px-2 py-2 text-stone-600 hover:bg-stone-50"
                    onClick={() => setCertificateBusinessKinds((prev) => [...prev, { businessType: "", businessItem: "" }])}
                    title="업태/종목 행 추가"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-red-100 bg-red-50 px-2 py-2 text-red-600 hover:bg-red-100"
                    onClick={() => removeCertificateKind(index)}
                    title="업태/종목 행 삭제"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Field label="법인등록번호">
            <input
              className="input-field"
              value={certificateCorporateNo}
              onChange={(e) => setCertificateCorporateNo(e.target.value)}
              placeholder="000000-0000000"
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="OCR 원문 확인·보정 참고">
              <textarea
                className="ui-textarea min-h-[110px] font-mono text-xs"
                value={certificateOcrText}
                onChange={(e) => setCertificateOcrText(e.target.value)}
                placeholder="자동 추출 시 OCR 원문 일부가 표시됩니다. 인식이 부족하면 위 입력란을 수동 보정하세요."
              />
            </Field>
          </div>
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
          <Field label="사업장 분류">
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
        {duplicateFacility && (
          <div className="md:col-span-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-black mb-1">기존 등록 사업장이 확인되었습니다.</div>
            <div className="text-xs leading-relaxed">
              {duplicateFacility.companyName ?? "상호 미기재"}
              {duplicateFacility.businessRegistrationNo ? ` · ${duplicateFacility.businessRegistrationNo}` : ""}
              {duplicateFacility.siteAddress ? ` · ${duplicateFacility.siteAddress}` : ""}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Link
                href={`/facilities?focus=${encodeURIComponent(duplicateFacility.facilityId)}`}
                className="inline-flex text-xs font-black text-primary hover:underline"
              >
                기존 사업장으로 이동
              </Link>
              {duplicateFacility.matchType === "businessRegistrationNo" && (
                <button
                  type="button"
                  onClick={() => handleSubmit({ allowDuplicateBrn: true })}
                  disabled={pending}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-black text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {pending ? "저장 중…" : "사업자번호 중복 확인 후 그래도 등록"}
                </button>
              )}
            </div>
            {duplicateFacility.matchType === "businessRegistrationNo" && (
              <p className="mt-2 text-[11px] leading-relaxed text-amber-700">
                동일 법인의 본사·공장 등 같은 사업자등록번호를 사용하는 별도 사업장이면 그대로 등록한 뒤 관계 법인으로 묶을 수 있습니다.
              </p>
            )}
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
            onClick={() => handleSubmit()}
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
