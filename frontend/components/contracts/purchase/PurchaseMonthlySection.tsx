"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BookOpen, Upload } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { CdHelp } from "@/components/cdash/CdHelp";
import type { CdTheme } from "@/components/contracts/dashboard/types";
import type { PdfViewerDoc } from "@/components/contracts/DraggablePdfViewer";
import type { PurchaseMonthlyKind } from "@/lib/contracts/purchase/options";
import type { PurchaseMonthlyEntry, PurchaseMonthlyPayload } from "@/lib/contracts/purchase/types";
import type { FeeStatementParsed } from "@/lib/contracts/purchase/fee-statement-llm";
import type { FeeStatementDetail } from "@/lib/contracts/purchase/type-details";
import { purchaseApi, purchaseJson } from "@/lib/contracts/purchase/client";
import { PURCHASE_MONTHLY_LABELS, PurchaseMonthlyPanel, emptyMonthlyEntries } from "./PurchaseMonthlyPanel";
import { FeeStatementPreviewModal } from "./FeeStatementPreviewModal";

/**
 * 저장된 계약의 월별 금액(333) — 상세 화면·변경계약 모달이 쓴다. 연도별로 GET 하고, 칸을 고치면 짧은 지연 뒤 PUT 한다
 * (매달 변경계약 모달을 열지 않아도 입력할 수 있게, 2026-11-03 사용자 결정). 관리비는 좌하단에서 명세서 PDF 를 올려
 * AI 인식 → 확인 모달 → 월 칸 반영까지 이 안에서 끝낸다.
 */
export function PurchaseMonthlySection({
  purchaseContractId,
  kind,
  years,
  canEdit,
  theme,
  onOpenPdf,
  title,
}: {
  purchaseContractId: string;
  kind: PurchaseMonthlyKind;
  years: number[];
  canEdit: boolean;
  theme: CdTheme;
  onOpenPdf: (state: { title: string; url: string; docs?: PdfViewerDoc[]; initialIndex?: number }) => void;
  /** 섹션 제목을 바꿀 때(기본 = 탭 이름). */
  title?: string;
}) {
  const toast = useToast();
  const [year, setYear] = useState(() => years[0] ?? new Date().getFullYear());
  const [payload, setPayload] = useState<PurchaseMonthlyPayload | null>(null);
  const [months, setMonths] = useState<PurchaseMonthlyEntry[]>(emptyMonthlyEntries);
  const [status, setStatus] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ parsed: FeeStatementParsed | null; documentId: string; documentName: string } | null>(null);
  const dirtyRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labels = PURCHASE_MONTHLY_LABELS[kind];

  const load = useCallback(
    async (y: number) => {
      try {
        const json = await purchaseApi<PurchaseMonthlyPayload>(
          `/api/purchase-contracts/${encodeURIComponent(purchaseContractId)}/monthly?kind=${kind}&year=${y}`
        );
        setPayload(json);
        setMonths(json.months);
        dirtyRef.current = false;
      } catch (err) {
        toast.show("월별 금액 조회 실패: " + (err as Error).message, "error");
      }
    },
    [purchaseContractId, kind, toast]
  );

  useEffect(() => {
    load(year);
  }, [load, year]);

  const save = useCallback(
    async (y: number, rows: PurchaseMonthlyEntry[]) => {
      setStatus("저장 중…");
      try {
        const json = await purchaseApi<PurchaseMonthlyPayload>(`/api/purchase-contracts/${encodeURIComponent(purchaseContractId)}/monthly`, {
          method: "PUT",
          ...purchaseJson({ kind, year: y, months: rows.map((m) => ({ month: m.month, amount: m.amount, purpose: m.purpose })) }),
        });
        setPayload(json);
        dirtyRef.current = false;
        setStatus("저장됨");
        setTimeout(() => setStatus(""), 1500);
      } catch (err) {
        setStatus("");
        toast.show("월별 금액 저장 실패: " + (err as Error).message, "error");
      }
    },
    [purchaseContractId, kind, toast]
  );

  const changeMonth = (month: number, patch: { amount?: string; purpose?: string }) => {
    setMonths((prev) => {
      const next = prev.map((m) =>
        m.month === month
          ? { ...m, ...(patch.amount !== undefined ? { amount: patch.amount === "" ? null : Number(patch.amount) } : {}), ...(patch.purpose !== undefined ? { purpose: patch.purpose } : {}) }
          : m
      );
      dirtyRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => save(year, next), 700);
      return next;
    });
  };

  // 연도를 바꾸기 전에 미저장분을 먼저 보낸다.
  const changeYear = (y: number) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (dirtyRef.current) void save(year, months).then(() => setYear(y));
    else setYear(y);
  };

  const uploadStatement = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await purchaseApi<{ documentId: string; displayName: string; duplicate: boolean; parsed: FeeStatementParsed | null }>(
        `/api/purchase-contracts/${encodeURIComponent(purchaseContractId)}/fee-statements`,
        { method: "POST", body: fd }
      );
      if (res.duplicate) toast.show("이미 올린 명세서와 같은 PDF 입니다. 기존 문서로 이어서 확인합니다.", "error");
      setPreview({ parsed: res.parsed, documentId: res.documentId, documentName: res.displayName });
    } catch (err) {
      toast.show("명세서 업로드 실패: " + (err as Error).message, "error");
    } finally {
      setUploading(false);
    }
  };

  const confirmStatement = async (value: { year: number; month: number; amount: number; detail: FeeStatementDetail }) => {
    if (!preview) return;
    const json = await purchaseApi<PurchaseMonthlyPayload>(`/api/purchase-contracts/${encodeURIComponent(purchaseContractId)}/fee-statements/confirm`, {
      method: "POST",
      ...purchaseJson({ documentId: preview.documentId, ...value }),
    });
    setPreview(null);
    toast.show(`${value.year}년 ${value.month}월 관리비를 반영했습니다.`, "success");
    if (value.year === year) {
      setPayload(json);
      setMonths(json.months);
    } else {
      setYear(value.year);
    }
  };

  const openDocument = (entry: PurchaseMonthlyEntry) => {
    if (!entry.documentPath) return;
    onOpenPdf({ title: `${year}년 ${entry.month}월 관리비 명세서`, url: entry.documentPath });
  };

  const footerLeft =
    kind === "metered" ? (
      <Link href="/finance?tab=journal" target="_blank" className="cd-btn cd-btn-ghost cd-btn-sm inline-flex items-center gap-1">
        <BookOpen className="w-3.5 h-3.5" /> 분개장으로 이동
      </Link>
    ) : kind === "management_fee" && canEdit ? (
      <label className={"cd-btn cd-btn-ghost cd-btn-sm inline-flex items-center gap-1 cursor-pointer " + (uploading ? "opacity-60 pointer-events-none" : "")}>
        <Upload className="w-3.5 h-3.5" /> {uploading ? "인식 중…" : "관리비 명세서 PDF 업로드"}
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadStatement(f);
            e.target.value = "";
          }}
        />
      </label>
    ) : null;

  return (
    <section className="grid gap-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold cd-text">{title ?? labels.title}</h3>
        {kind === "management_fee" ? <CdHelp topic="purchase.fee-statement" /> : <CdHelp topic="purchase.monthly" />}
      </div>
      <PurchaseMonthlyPanel
        kind={kind}
        year={year}
        years={[...new Set([...years, ...(payload?.yearlyTotals.map((t) => t.year) ?? [])])]}
        onYearChange={changeYear}
        months={months}
        yearlyTotals={payload?.yearlyTotals ?? []}
        onChangeMonth={changeMonth}
        readOnly={!canEdit}
        theme={theme}
        footerLeft={footerLeft}
        onOpenDocument={openDocument}
        status={status}
      />
      {preview && (
        <FeeStatementPreviewModal
          parsed={preview.parsed}
          documentName={preview.documentName}
          defaultYear={year}
          onClose={() => setPreview(null)}
          onConfirm={confirmStatement}
        />
      )}
    </section>
  );
}
