"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, ImageUp, Loader2, RotateCcw, Search } from "lucide-react";
import { Empty, ErrorBox } from "./mobile-shared";

// 명함 촬영 플로우 — 촬영/앨범 → Claude vision 파싱 → 필드 미리보기·수정 →
// 사업장 검색·선택(회사명 자동 후보) → 저장(/api/facilities/[id]/contacts/card).

interface CardFields {
  personName: string | null;
  title: string | null;
  department: string | null;
  companyName: string | null;
  mobilePhone: string | null;
  officePhone: string | null;
  faxNumber: string | null;
  email: string | null;
  address: string | null;
  etc: string | null;
}

interface FacilityOption {
  facilityId: string;
  companyName: string;
  siteAddress: string | null;
}

type Step = "pick" | "parsing" | "form" | "saving" | "done";

export function MobileCard() {
  const [step, setStep] = useState<Step>("pick");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [parsed, setParsed] = useState<CardFields | null>(null); // 파싱 원본(보존용)
  const [form, setForm] = useState<Record<string, string>>({});
  const [facilityQuery, setFacilityQuery] = useState("");
  const [facilityOptions, setFacilityOptions] = useState<FacilityOption[]>([]);
  const [facility, setFacility] = useState<FacilityOption | null>(null);
  const [savedMode, setSavedMode] = useState<"created" | "updated" | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const albumRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const searchFacilities = useCallback(async (query: string) => {
    if (!query.trim()) {
      setFacilityOptions([]);
      return;
    }
    try {
      const res = await fetch(`/api/facilities?q=${encodeURIComponent(query.trim())}&limit=5&sort=name`, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setFacilityOptions(Array.isArray(data.items) ? data.items : []);
    } catch {
      // 검색 실패는 조용히 — 수동 재검색 가능
    }
  }, []);

  const handleFile = async (f: File | null) => {
    if (!f) return;
    setError(null);
    setWarning(null);
    setFile(f);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
    setStep("parsing");
    try {
      const fd = new FormData();
      fd.set("file", f, f.name || "card.jpg");
      const res = await fetch("/api/facilities/business-card/parse", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      const fields = (data.fields ?? null) as CardFields | null;
      if (data.warning) setWarning(String(data.warning));
      setParsed(fields);
      setForm({
        personName: fields?.personName ?? "",
        title: fields?.title ?? "",
        departmentName: fields?.department ?? "",
        mobilePhone: fields?.mobilePhone ?? "",
        officePhone: fields?.officePhone ?? "",
        email: fields?.email ?? "",
        duties: "",
        deptType: "",
      });
      const company = fields?.companyName ?? "";
      setFacilityQuery(company);
      setFacility(null);
      if (company) await searchFacilities(company);
      setStep("form");
    } catch (e) {
      setError((e as Error).message);
      setStep("pick");
    }
  };

  const save = async () => {
    if (!facility) {
      setError("사업장을 선택하세요.");
      return;
    }
    if (!form.personName?.trim()) {
      setError("이름은 필수입니다.");
      return;
    }
    setError(null);
    setStep("saving");
    try {
      const fd = new FormData();
      if (file) fd.set("file", file, file.name || "card.jpg");
      fd.set("fields", JSON.stringify(form));
      if (parsed) fd.set("parsed", JSON.stringify(parsed));
      const res = await fetch(`/api/facilities/${encodeURIComponent(facility.facilityId)}/contacts/card`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setSavedMode((data.mode as "created" | "updated") ?? "created");
      setStep("done");
    } catch (e) {
      setError((e as Error).message);
      setStep("form");
    }
  };

  const reset = () => {
    setStep("pick");
    setError(null);
    setWarning(null);
    setFile(null);
    setParsed(null);
    setForm({});
    setFacility(null);
    setFacilityQuery("");
    setFacilityOptions([]);
    setSavedMode(null);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBox message={error} />}
      {warning && <div className="cd-warn-bg cd-warn-text rounded-xl px-4 py-3 text-sm">{warning}</div>}

      {/* 파일 입력(숨김) — 촬영은 capture, 앨범은 일반 선택 */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
      <input ref={albumRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />

      {step === "pick" && (
        <div className="flex flex-col gap-2">
          <button className="cd-btn cd-btn-primary cd-btn-block justify-center" style={{ height: 52 }} onClick={() => cameraRef.current?.click()}>
            <Camera className="w-5 h-5" /> 명함 촬영
          </button>
          <button className="cd-btn cd-btn-soft cd-btn-block justify-center" style={{ height: 52 }} onClick={() => albumRef.current?.click()}>
            <ImageUp className="w-5 h-5" /> 앨범에서 선택
          </button>
          <p className="cd-text-faint text-xs text-center mt-1">촬영한 명함은 AI가 자동으로 인식해 담당자 정보로 정리합니다.</p>
        </div>
      )}

      {previewUrl && step !== "pick" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt="명함 미리보기" className="rounded-2xl border cd-border-c w-full object-contain" style={{ maxHeight: 180 }} />
      )}

      {step === "parsing" && (
        <div className="cd-text-muted text-sm text-center py-8 flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> 명함을 인식하는 중…
        </div>
      )}

      {(step === "form" || step === "saving") && (
        <div className="flex flex-col gap-3">
          {/* 사업장 선택 */}
          <section className="cd-card-bg border cd-border-c rounded-2xl p-3">
            <h3 className="cd-text-muted text-xs font-bold mb-2">사업장 선택 *</h3>
            {facility ? (
              <div className="cd-tint-primary rounded-xl px-3 py-2.5 flex items-center gap-2">
                <Check className="w-4 h-4 cd-text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="cd-text text-sm font-bold truncate">{facility.companyName}</div>
                  <div className="cd-text-faint text-xs truncate">{facility.siteAddress ?? ""}</div>
                </div>
                <button className="cd-btn cd-btn-ghost cd-btn-sm shrink-0" onClick={() => setFacility(null)}>변경</button>
              </div>
            ) : (
              <>
                <form
                  className="flex items-center gap-2 mb-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    searchFacilities(facilityQuery);
                  }}
                >
                  <input className="cd-input flex-1" placeholder="사업장명 검색" value={facilityQuery}
                    onChange={(e) => setFacilityQuery(e.target.value)} />
                  <button type="submit" className="cd-btn cd-btn-soft shrink-0" aria-label="사업장 검색">
                    <Search className="w-4 h-4" />
                  </button>
                </form>
                {facilityOptions.length === 0 ? (
                  <Empty label="검색 결과가 없습니다. 사업장명으로 검색하세요." />
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {facilityOptions.map((f) => (
                      <button key={f.facilityId} className="rounded-xl border cd-border-c px-3 py-2 text-left" onClick={() => setFacility(f)}>
                        <div className="cd-text text-sm font-bold truncate">{f.companyName}</div>
                        <div className="cd-text-faint text-xs truncate">{f.siteAddress ?? "—"}</div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>

          {/* 필드 미리보기·수정 */}
          <section className="cd-card-bg border cd-border-c rounded-2xl p-3 flex flex-col gap-2">
            <h3 className="cd-text-muted text-xs font-bold">담당자 정보</h3>
            <Field label="이름 *" value={form.personName ?? ""} onChange={(v) => setForm((s) => ({ ...s, personName: v }))} />
            <Field label="직급" value={form.title ?? ""} onChange={(v) => setForm((s) => ({ ...s, title: v }))} />
            <Field label="부서" value={form.departmentName ?? ""} onChange={(v) => setForm((s) => ({ ...s, departmentName: v }))} />
            <div className="flex items-center gap-2">
              <span className="cd-text-faint text-xs shrink-0" style={{ width: 64 }}>부서유형</span>
              <select className="cd-select flex-1" value={form.deptType ?? ""} onChange={(e) => setForm((s) => ({ ...s, deptType: e.target.value }))}>
                <option value="">미지정</option>
                <option value="contract">계약</option>
                <option value="env">환경</option>
              </select>
            </div>
            <Field label="휴대폰" value={form.mobilePhone ?? ""} onChange={(v) => setForm((s) => ({ ...s, mobilePhone: v }))} inputMode="tel" />
            <Field label="사무실" value={form.officePhone ?? ""} onChange={(v) => setForm((s) => ({ ...s, officePhone: v }))} inputMode="tel" />
            <Field label="이메일" value={form.email ?? ""} onChange={(v) => setForm((s) => ({ ...s, email: v }))} inputMode="email" />
            <Field label="업무" value={form.duties ?? ""} onChange={(v) => setForm((s) => ({ ...s, duties: v }))} />
          </section>

          <div className="flex gap-2">
            <button className="cd-btn cd-btn-ghost shrink-0" onClick={reset} disabled={step === "saving"}>
              <RotateCcw className="w-4 h-4" /> 다시
            </button>
            <button className="cd-btn cd-btn-primary flex-1 justify-center" style={{ height: 46 }} onClick={save} disabled={step === "saving"}>
              {step === "saving" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} 저장
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="cd-card-bg border cd-border-c rounded-2xl p-6 text-center flex flex-col items-center gap-3">
          <span className="cd-success-bg rounded-full p-3"><Check className="w-6 h-6 cd-success-text" /></span>
          <div className="cd-text text-sm font-bold">
            {form.personName} 님을 {facility?.companyName}에 {savedMode === "updated" ? "갱신" : "등록"}했습니다.
          </div>
          <button className="cd-btn cd-btn-primary" onClick={reset}>
            <Camera className="w-4 h-4" /> 다음 명함 촬영
          </button>
        </div>
      )}
    </div>
  );
}

function Field({
  label, value, onChange, inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: "tel" | "email";
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="cd-text-faint text-xs shrink-0" style={{ width: 64 }}>{label}</span>
      <input className="cd-input flex-1" value={value} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
