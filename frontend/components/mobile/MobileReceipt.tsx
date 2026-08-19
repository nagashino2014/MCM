"use client";

import { useEffect, useState } from "react";
import { Camera, Check, ImageUp, Loader2, ReceiptText, RotateCcw } from "lucide-react";
import { ErrorBox } from "./mobile-shared";

// 개인카드 영수증 촬영 플로우(웹 셸) — 촬영/앨범 → Claude vision 파싱 → 확인·수정 → 스톡 저장.
// 네이티브(apps/mobile/src/app/receipt.tsx)와 같은 API(/api/receipts/parse, /api/receipts)를 쓴다.
// 저장된 영수증은 지출결의서·출장보고서 기안 화면의 "개인카드 영수증 불러오기"에서 사용된다.

interface ReceiptFields {
  storeName: string | null;
  storeCorpNum: string | null;
  paidAt: string | null;
  totalAmount: number | null;
  supplyAmount: number | null;
  taxAmount: number | null;
  cardLast4: string | null;
  approvalNum: string | null;
  items: string[];
}

interface DuplicateInfo {
  receiptId: string;
  paidAt: string | null;
  storeName: string | null;
  totalAmount: number;
}

type Step = "pick" | "parsing" | "form" | "saving" | "done";

export function MobileReceipt() {
  const [step, setStep] = useState<Step>("pick");
  const [error, setError] = useState<string | null>(null);
  // 서버가 판정한 확인 필요 항목(사용일 이상·사업자번호 체크섬)과 자동 보정 안내.
  const [warnings, setWarnings] = useState<string[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ReceiptFields | null>(null);
  const [form, setForm] = useState({ storeName: "", paidAt: "", totalAmount: "", cardLast4: "", memo: "" });
  const [duplicates, setDuplicates] = useState<DuplicateInfo[] | null>(null);
  const [savedStore, setSavedStore] = useState<string | null>(null);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const handleFile = async (f: File | null) => {
    if (!f) return;
    setError(null);
    setWarnings([]);
    setNotices([]);
    setFile(f);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
    setStep("parsing");
    try {
      const fd = new FormData();
      fd.set("file", f, f.name || "receipt.jpg");
      const res = await fetch("/api/receipts/parse", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      const fields = (data.fields ?? null) as ReceiptFields | null;
      setWarnings([
        ...(data.warning ? [String(data.warning)] : []),
        ...((data.warnings ?? []) as string[]),
      ]);
      setNotices((data.notices ?? []) as string[]);
      setParsed(fields);
      setForm({
        storeName: fields?.storeName ?? "",
        paidAt: fields?.paidAt ?? "",
        totalAmount: fields?.totalAmount != null ? String(fields.totalAmount) : "",
        cardLast4: fields?.cardLast4 ?? "",
        memo: "",
      });
      setDuplicates(null);
      setStep("form");
    } catch (e) {
      setError((e as Error).message);
      setStep("pick");
    }
  };

  const save = async (force: boolean) => {
    const amount = Number(form.totalAmount.replace(/[^0-9]/g, ""));
    if (!(amount > 0)) {
      setError("결제 금액을 입력하세요.");
      return;
    }
    if (!file) {
      setError("영수증 이미지가 없습니다. 다시 촬영해주세요.");
      return;
    }
    setError(null);
    setStep("saving");
    try {
      const fields: ReceiptFields = {
        storeName: form.storeName.trim() || null,
        storeCorpNum: parsed?.storeCorpNum ?? null,
        paidAt: form.paidAt.trim() || null,
        totalAmount: amount,
        supplyAmount: parsed?.totalAmount === amount ? (parsed?.supplyAmount ?? null) : null,
        taxAmount: parsed?.totalAmount === amount ? (parsed?.taxAmount ?? null) : null,
        cardLast4: form.cardLast4.replace(/[^0-9]/g, "").slice(-4) || null,
        approvalNum: parsed?.approvalNum ?? null,
        items: parsed?.items ?? [],
      };
      const fd = new FormData();
      fd.set("file", file, file.name || "receipt.jpg");
      fd.set("fields", JSON.stringify(fields));
      if (parsed) fd.set("parsed", JSON.stringify(parsed));
      if (form.memo.trim()) fd.set("memo", form.memo.trim());
      if (force) fd.set("force", "1");
      const res = await fetch("/api/receipts", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && Array.isArray(data.duplicates)) {
        setDuplicates(data.duplicates as DuplicateInfo[]);
        setStep("form");
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setSavedStore(form.storeName.trim() || "영수증");
      setStep("done");
    } catch (e) {
      setError((e as Error).message);
      setStep("form");
    }
  };

  const reset = () => {
    setStep("pick");
    setError(null);
    setWarnings([]);
    setNotices([]);
    setFile(null);
    setParsed(null);
    setForm({ storeName: "", paidAt: "", totalAmount: "", cardLast4: "", memo: "" });
    setDuplicates(null);
    setSavedStore(null);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {error && <ErrorBox message={error} />}
      {warnings.length > 0 && (
        <div className="cd-warn-bg cd-warn-text space-y-1 rounded-xl px-4 py-3 text-sm">
          {warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}
      {notices.length > 0 && (
        <div className="cd-tint-primary space-y-1 rounded-xl px-4 py-3 text-sm">
          {notices.map((n, i) => (
            <p key={i}>{n}</p>
          ))}
        </div>
      )}

      {step === "pick" && (
        <div className="flex flex-col gap-2">
          <label className="cd-btn cd-btn-primary cd-btn-block justify-center" style={{ height: 52 }}>
            <Camera className="w-5 h-5" /> 영수증 촬영
            <input type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
          </label>
          <label className="cd-btn cd-btn-soft cd-btn-block justify-center" style={{ height: 52 }}>
            <ImageUp className="w-5 h-5" /> 앨범에서 선택
            <input type="file" accept="image/*" className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
          </label>
          <p className="cd-text-faint text-xs text-center mt-1">
            개인카드로 결제한 지류 영수증을 찍어두면 지출결의서·출장보고서 작성 때 자동으로 불러올 수 있습니다.
          </p>
        </div>
      )}

      {previewUrl && step !== "pick" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt="영수증 미리보기" className="rounded-2xl border cd-border-c w-full object-contain" style={{ maxHeight: 220 }} />
      )}

      {step === "parsing" && (
        <div className="cd-text-muted text-sm text-center py-8 flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> 영수증을 인식하는 중…
        </div>
      )}

      {(step === "form" || step === "saving") && (
        <div className="flex flex-col gap-3">
          {duplicates?.length ? (
            <div className="cd-warn-bg rounded-xl px-4 py-3 flex flex-col gap-1.5">
              <span className="cd-warn-text text-sm font-bold">이미 저장된 영수증일 수 있어요</span>
              {duplicates.map((d) => (
                <span key={d.receiptId} className="cd-warn-text text-xs">
                  · {d.paidAt ?? "-"} {d.storeName ?? "상호 미상"} {d.totalAmount.toLocaleString("ko-KR")}원
                </span>
              ))}
              <button className="cd-btn cd-btn-soft cd-btn-sm justify-center mt-1" onClick={() => void save(true)} disabled={step === "saving"}>
                다른 결제 건이 맞아요 — 그래도 저장
              </button>
            </div>
          ) : null}

          <section className="cd-card-bg border cd-border-c rounded-2xl p-3 flex flex-col gap-2">
            <h3 className="cd-text-muted text-xs font-bold">인식 결과 확인 — 틀린 곳만 고쳐주세요</h3>
            <Field label="상호" value={form.storeName} onChange={(v) => setForm((s) => ({ ...s, storeName: v }))} />
            <Field label="사용일시" value={form.paidAt} onChange={(v) => setForm((s) => ({ ...s, paidAt: v }))} placeholder="2026-08-16 12:30" />
            <Field label="금액 *" value={form.totalAmount} onChange={(v) => setForm((s) => ({ ...s, totalAmount: v }))} inputMode="numeric" />
            <Field label="카드 끝4" value={form.cardLast4} onChange={(v) => setForm((s) => ({ ...s, cardLast4: v }))} inputMode="numeric" />
            <Field label="메모" value={form.memo} onChange={(v) => setForm((s) => ({ ...s, memo: v }))} placeholder="(선택)" />
          </section>

          <div className="flex gap-2">
            <button className="cd-btn cd-btn-ghost shrink-0" onClick={reset} disabled={step === "saving"}>
              <RotateCcw className="w-4 h-4" /> 다시
            </button>
            <button className="cd-btn cd-btn-primary flex-1 justify-center" style={{ height: 46 }} onClick={() => void save(false)} disabled={step === "saving"}>
              {step === "saving" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} 저장
            </button>
          </div>
        </div>
      )}

      {step === "done" && (
        <div className="cd-card-bg border cd-border-c rounded-2xl p-6 text-center flex flex-col items-center gap-3">
          <span className="cd-success-bg rounded-full p-3"><ReceiptText className="w-6 h-6 cd-success-text" /></span>
          <div className="cd-text text-sm font-bold">
            {savedStore} 영수증을 저장했습니다.
            <br />
            지출결의서 작성 때 불러올 수 있어요.
          </div>
          <button className="cd-btn cd-btn-primary" onClick={reset}>
            <Camera className="w-4 h-4" /> 다음 영수증 촬영
          </button>
        </div>
      )}
    </div>
  );
}

function Field({
  label, value, onChange, inputMode, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: "numeric";
  placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="cd-text-faint text-xs shrink-0" style={{ width: 64 }}>{label}</span>
      <input className="cd-input flex-1" value={value} inputMode={inputMode} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
