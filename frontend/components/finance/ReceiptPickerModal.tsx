"use client";

// 개인카드 영수증 불러오기 모달 (accounting-expansion 블루프린트 §2, P1)
// 지출결의서·출장보고서 기안 화면에서 본인이 촬영해 둔 미사용 영수증을 다중 선택해 지출 내역 표로 넘긴다.
// CardPickerModal(법인카드)의 형제 — 목록이 "본인 영수증"이라는 점과, 선택 시 증빙 PDF 가
// 첨부서류에 자동 추가된다는 점만 다르다. 썸네일 클릭으로 원본 이미지를 확인할 수 있다.
// 모드 2종 — 기안 화면의 버튼이 각각 연다(G-8, 2026-10-20 사용자 확정. 종전 한 창의 탭 2종을 분리):
//   mobile = [개인카드 영수증 불러오기] — 모바일 앱으로 촬영해 둔 영수증 스톡
//   manual = [기타 개인 지출증빙] — 계좌이체 확인증·수기 영수증 등 카드 영수증이 아닌 증빙(웹 전용).
//            스캔본(이미지·PDF)을 올리며 거래처·사용일·금액·지불수단·지출 목적을 입력하면 저장 즉시 표에 담긴다.
//            등록해 두고 쓰지 않은 증빙은 목록에서 골라 담거나 삭제한다.

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, AlertTriangle, FileText, Plus, Trash2, Upload, Loader2, HelpCircle } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { DigitDateInput } from "@/components/finance/DigitDateInput";
import { RelatedCellButton } from "@/components/approval/RelatedPicker";
import { PURPOSE_HINTS, purposeNeedsRelated, type RelatedRef } from "@/lib/approval/expense-purpose";

export interface ReceiptPickerItem {
  receiptId: string;
  paidAt: string | null;
  paidDate: string | null;
  storeName: string | null;
  totalAmount: number;
  cardLast4: string | null;
  items: string[];
  memo: string | null;
  docId: string | null;
  /** 촬영일 — 사용일이 없는 건의 날짜 표시에 쓴다. */
  createdAt: string;
  pdfKey: string;
  pdfName: string;
  categoryKey: string | null;
  categoryLabel: string | null;
  categorySource: string | null;
  formOption: string | null;
  /** 출처(224) — mobile 촬영 / manual 직접 첨부 */
  source?: "mobile" | "manual";
  payMethod?: string | null;
  /** 지출 목적 — 촬영(모바일)·직접 첨부 때 고른 값, 표 행 detail 프리필(2026-10-16 정해진 목록) */
  purpose?: string | null;
  /** 연관 용역/사업장 — 촬영·직접 첨부 때 고른 값 */
  related?: RelatedRef | null;
  /** 이미지 썸네일 유무(PDF 원본 직접 첨부는 false) */
  hasImage?: boolean;
}

/** 직접 첨부 입력 행(저장 전) */
interface ManualDraft {
  id: number;
  file: File | null;
  storeName: string;
  paidAt: string;
  totalAmount: string;
  payMethod: string;
  purpose: string;
  related: RelatedRef | null;
}

// 개인카드 영수증은 모바일 촬영으로 올린다(G-8) — 기타 증빙의 새 등록에서는 고르지 않는다.
const PAY_METHODS = ["계좌이체", "현금", "기타"];

/** 입력용 YYYY-MM-DD (KST 기준) — toISOString 은 UTC 라, 오전 9시 이전에는 "오늘"이 하루 밀려
 *  그날 찍은 영수증이 조회 범위에서 빠졌다. 저장 값(KST)과 기준을 맞춘다. */
const ymdInput = (ms: number) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

let draftSeq = 1;
const newDraft = (related: RelatedRef | null = null): ManualDraft => ({
  id: draftSeq++,
  file: null,
  storeName: "",
  paidAt: "",
  totalAmount: "",
  payMethod: "계좌이체",
  purpose: "",
  related,
});

export function ReceiptPickerModal({
  mode,
  open,
  onClose,
  formId,
  existingIds,
  onPick,
  purposeOptions,
  defaultRelated,
  lockedPeriod,
  relatedLocked,
}: {
  /** mobile = 개인카드 영수증(촬영 스톡) / manual = 기타 개인 지출증빙(웹 등록) */
  mode: "mobile" | "manual";
  open: boolean;
  onClose: () => void;
  formId: string;
  /** 이미 이 문서의 지출 내역 표에 담긴 영수증(_receiptId) */
  existingIds: string[];
  onPick: (items: ReceiptPickerItem[]) => void;
  /** 이 양식의 지출 목적 목록(직접 첨부 입력용) */
  purposeOptions: readonly string[];
  /** 출장보고서의 용역/사업장 — 연관 용역/사업장이 비어 있는 행의 기본값 */
  defaultRelated?: RelatedRef | null;
  /** 출장보고서의 출장기간 — 주어지면 조회 기간을 이 범위로 고정한다(2026-10-17 사용자 요청) */
  lockedPeriod?: { from: string; to: string } | null;
  /** 출장보고서 — 연관 용역/사업장은 문서의 업체·용역(defaultRelated)으로 고정, 행마다 고르지 않는다(2026-10-17 사용자 요청) */
  relatedLocked?: boolean;
}) {
  const tab = mode;
  const [from, setFrom] = useState(() => ymdInput(Date.now() - 90 * 86400000));
  const [to, setTo] = useState(() => ymdInput(Date.now()));
  /** 기간 무시하고 전부 — 사용일이 잘못 인식된 건을 찾을 때 쓴다. */
  const [allTime, setAllTime] = useState(false);
  const [items, setItems] = useState<ReceiptPickerItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 행별 지출 목적·연관 용역/사업장 입력(2026-10-17) — 촬영 때 안 골랐거나 고칠 때. 고치면 그 행을 선택한다 */
  const [edits, setEdits] = useState<Record<string, { purpose?: string; related?: RelatedRef | null }>>({});
  /** 표에 추가를 눌렀는데 입력이 빠진 행이 있으면 그 칸을 강조한다 */
  const [showMissing, setShowMissing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null); // receiptId — 원본 이미지 확대
  // 직접 첨부 — 입력 행 목록 + 업로드 상태
  const [drafts, setDrafts] = useState<ManualDraft[]>(() => [newDraft()]);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ formId, unusedOnly: "1", source: tab });
      if (lockedPeriod) {
        params.set("from", lockedPeriod.from);
        params.set("to", lockedPeriod.to);
      } else if (!allTime) {
        params.set("from", from);
        params.set("to", to);
      }
      const res = await fetch(`/api/receipts?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "영수증을 불러오지 못했습니다.");
      setItems(data.items ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formId, from, to, allTime, tab, lockedPeriod?.from, lockedPeriod?.to]);

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setEdits({});
      setShowMissing(false);
      setPreview(null);
      load();
    }
  }, [open, load]);

  // 열 때마다 초기화 — 출장보고서의 용역/사업장이 그 사이 바뀌었을 수 있어 연 시점 값으로 기본값을 잡는다.
  useEffect(() => {
    if (open) {
      setDrafts([newDraft(defaultRelated ?? null)]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const existing = useMemo(() => new Set(existingIds), [existingIds]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 채널 가드(법인카드 모달과 동일, 경고만): 지출결의서에 출장성 분류 건을 담으면 안내.
  const tripLikeSelected =
    (formId === "frm-expense-report" || formId === "frm-expense-personal") &&
    items.some((i) => selected.has(i.receiptId) && (i.categoryKey === "travel" || i.categoryKey === "lodging" || i.categoryKey === "fuel"));

  // 출장보고서 — 사용일을 모르는 영수증은 출장기간 대조가 안 돼 담을 수 없다(영수증 보관함에서 사용일을 고친 뒤 담는다).
  const dateUnknownLocked = (i: ReceiptPickerItem) => !!lockedPeriod && !i.paidDate;

  // 지출 목적(필수)·연관 용역/사업장(목적에 따라 필수)을 채워야 표에 담을 수 있다(2026-10-17 사용자 요청).
  // 촬영 때 고른 목적이 이 양식 목록에 없으면(지출결의서에 출장 경비 등) 빈 값으로 보고 다시 고르게 한다.
  const purposeOf = (i: ReceiptPickerItem) =>
    edits[i.receiptId]?.purpose ?? (purposeOptions.includes(i.purpose ?? "") ? i.purpose ?? "" : "");
  const relatedOf = (i: ReceiptPickerItem): RelatedRef | null =>
    relatedLocked
      ? defaultRelated ?? null
      : edits[i.receiptId] && "related" in edits[i.receiptId]
        ? edits[i.receiptId].related ?? null
        : i.related ?? defaultRelated ?? null;
  const editRow = (id: string, patch: { purpose?: string; related?: RelatedRef | null }) => {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    setSelected((prev) => new Set(prev).add(id));
  };
  const purposeMissing = (i: ReceiptPickerItem) => !purposeOf(i);
  const relatedMissing = (i: ReceiptPickerItem) => purposeNeedsRelated(purposeOf(i)) && !relatedOf(i);
  const selectedItems = items.filter((i) => selected.has(i.receiptId) && !existing.has(i.receiptId) && !dateUnknownLocked(i));
  const incomplete = selectedItems.filter((i) => purposeMissing(i) || relatedMissing(i));
  // 빠진 칸을 다 채우면 안내를 걷는다.
  useEffect(() => {
    if (showMissing && incomplete.length === 0) setError(null);
  }, [showMissing, incomplete.length]);

  const submit = () => {
    if (!selectedItems.length) return;
    if (incomplete.length) {
      setShowMissing(true);
      const np = incomplete.filter(purposeMissing).length;
      const nr = incomplete.filter((i) => !purposeMissing(i) && relatedMissing(i)).length;
      setError(
        [np ? `지출 목적 미입력 ${np}건` : "", nr ? `연관 용역/사업장 미입력 ${nr}건` : ""].filter(Boolean).join(", ") +
          " — 선택한 건마다 입력해야 표에 추가할 수 있습니다."
      );
      return;
    }
    // 고정 모드는 촬영 때 고른 용역을 그대로 넘겨 기안 화면이 출장 용역과 다른지 경고할 수 있게 한다(표에는 문서 값이 들어간다).
    onPick(selectedItems.map((i) => ({ ...i, purpose: purposeOf(i) || null, related: relatedLocked ? i.related ?? null : relatedOf(i) })));
    onClose();
  };

  // ── 직접 첨부 ──
  const patchDraft = (id: number, p: Partial<ManualDraft>) => setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...p } : d)));
  const activeDrafts = drafts.filter((d) => d.file || d.storeName.trim() || d.totalAmount.trim());

  const uploadManual = async () => {
    const rows = activeDrafts;
    if (!rows.length) return;
    const missing = rows.find((d) => !d.file || !d.storeName.trim() || !d.paidAt || !(Number(d.totalAmount.replace(/[^\d]/g, "")) > 0));
    if (missing) {
      alert("각 행에 증빙 파일·거래처·사용일·금액을 입력하세요.");
      return;
    }
    if (rows.some((d) => !d.purpose)) {
      alert("각 행의 지출 목적을 고르세요.");
      return;
    }
    if (!relatedLocked && rows.some((d) => purposeNeedsRelated(d.purpose) && !d.related)) {
      alert("지출 목적이 출장 경비·초과근무 식대·인쇄/제본비인 행은 연관 용역/사업장을 골라야 합니다.");
      return;
    }
    if (lockedPeriod && rows.some((d) => !d.paidAt || d.paidAt < lockedPeriod.from || d.paidAt > lockedPeriod.to)) {
      alert(`사용일을 출장기간(${lockedPeriod.from} ~ ${lockedPeriod.to}) 안의 날짜로 입력하세요.`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("formId", formId);
      rows.forEach((d) => fd.append("files", d.file as File));
      fd.append(
        "entries",
        JSON.stringify(
          rows.map((d, i) => ({
            storeName: d.storeName.trim(),
            paidAt: d.paidAt,
            totalAmount: Number(d.totalAmount.replace(/[^\d]/g, "")),
            payMethod: d.payMethod,
            purpose: d.purpose.trim(),
            relatedContractId: (relatedLocked ? defaultRelated : d.related)?.contractId ?? null,
            relatedFacilityId: (relatedLocked ? defaultRelated : d.related)?.facilityId ?? null,
            fileIndex: i,
          }))
        )
      );
      const res = await fetch("/api/receipts/manual", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error ?? "기타 개인 지출증빙 저장 실패");
      const saved = ((data as { items?: ReceiptPickerItem[] }).items ?? []);
      if (saved.length) {
        onPick(saved);
        onClose();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  // 등록해 두고 쓰지 않은 기타 증빙 삭제 — 문서에 담긴 증빙은 서버가 거부한다.
  const removeManual = async (item: ReceiptPickerItem) => {
    if (!confirm(`${item.paidDate ?? ""} ${item.storeName ?? ""} ${item.totalAmount.toLocaleString("ko-KR")}원 증빙을 삭제할까요?`)) return;
    const res = await fetch(`/api/receipts/${item.receiptId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError((data as { error?: string })?.error ?? "삭제하지 못했습니다.");
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(item.receiptId);
      return next;
    });
    await load();
  };

  const fmtAmount = (s: string) => {
    const n = Number(s.replace(/[^\d]/g, ""));
    return n > 0 ? n.toLocaleString("ko-KR") : "";
  };

  return (
    <CdModal
      open={open}
      onClose={onClose}
      title={tab === "manual" ? "기타 개인 지출증빙" : "개인카드 영수증 불러오기"}
      size="xl"
      footer={
        tab === "manual" ? (
          <>
            <span className="text-xs cd-text-muted mr-auto">
              새 증빙 {activeDrafts.length}건 입력 · 목록 {selectedItems.length}건 선택 — 증빙 PDF가 첨부서류에 함께 추가됩니다
              {incomplete.length > 0 && (
                <span className="ml-1.5" style={{ color: "var(--cd-error)" }}>
                  · 입력 필요 {incomplete.length}건
                </span>
              )}
            </span>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>
              취소
            </button>
            <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={selectedItems.length === 0} onClick={submit}>
              선택 건 표에 추가
            </button>
            <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={uploading || !activeDrafts.length} onClick={() => void uploadManual()}>
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} 저장 후 표에 추가
            </button>
          </>
        ) : (
          <>
            <span className="text-xs cd-text-muted mr-auto">
              {selectedItems.length}건 선택 — 영수증 PDF가 첨부서류에 함께 추가됩니다
              {incomplete.length > 0 && (
                <span className="ml-1.5" style={{ color: "var(--cd-error)" }}>
                  · 입력 필요 {incomplete.length}건
                </span>
              )}
            </span>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>
              취소
            </button>
            <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={selectedItems.length === 0} onClick={submit}>
              표에 추가
            </button>
          </>
        )
      }
    >
      <div className="space-y-3">
        {tab === "manual" && (
          <div className="rounded-xl border cd-border-c px-3.5 py-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold cd-text">새로 등록</span>
              <span className="text-[11px] cd-text-faint">
                계좌이체 확인증·수기 영수증 등 카드 영수증이 아닌 증빙의 스캔본(이미지·PDF)을 건별로 올리고 내역을 입력하세요. 개인카드 영수증은 모바일 앱으로 촬영합니다.
              </span>
              <button type="button" className="cd-btn cd-btn-soft cd-btn-sm ml-auto" onClick={() => setDrafts((p) => [...p, newDraft(defaultRelated ?? null)])}>
                <Plus className="w-3.5 h-3.5" /> 행 추가
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="cd-table-head">
                  <tr className="cd-text-muted text-left text-[11px]">
                    <th className="py-1.5 pr-2 font-normal">증빙 파일 *</th>
                    <th className="py-1.5 pr-2 font-normal">거래처 *</th>
                    <th className="py-1.5 pr-2 font-normal">사용일 *</th>
                    <th className="py-1.5 pr-2 font-normal text-right">금액 *</th>
                    <th className="py-1.5 pr-2 font-normal">지불수단</th>
                    <th className="py-1.5 pr-2 font-normal">지출 목적 *</th>
                    <th className="py-1.5 pr-2 font-normal">연관 용역/사업장</th>
                    <th className="py-1.5 font-normal w-8" />
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d) => (
                    <tr key={d.id} className="border-t cd-hairline-row-c align-middle">
                      <td className="py-1.5 pr-2" style={{ minWidth: 170 }}>
                        <label className="cd-btn cd-btn-soft cd-btn-sm cursor-pointer inline-flex items-center gap-1 max-w-[220px]">
                          <FileText className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{d.file ? d.file.name : "파일 선택"}</span>
                          <input
                            type="file"
                            accept="image/*,application/pdf,.pdf"
                            className="hidden"
                            onChange={(e) => patchDraft(d.id, { file: e.target.files?.[0] ?? null })}
                          />
                        </label>
                      </td>
                      <td className="py-1.5 pr-2" style={{ minWidth: 140 }}>
                        <input className="cd-input text-sm w-full" placeholder="상호·거래처" value={d.storeName} onChange={(e) => patchDraft(d.id, { storeName: e.target.value })} />
                      </td>
                      <td className="py-1.5 pr-2">
                        <DigitDateInput value={d.paidAt} onChange={(v) => patchDraft(d.id, { paidAt: v })} className="cd-input text-sm text-center" style={{ width: 116 }} />
                      </td>
                      <td className="py-1.5 pr-2">
                        <input
                          className="cd-input text-sm text-right"
                          style={{ width: 110 }}
                          inputMode="numeric"
                          placeholder="0"
                          value={fmtAmount(d.totalAmount)}
                          onChange={(e) => patchDraft(d.id, { totalAmount: e.target.value.replace(/[^\d]/g, "") })}
                        />
                      </td>
                      <td className="py-1.5 pr-2">
                        <select className="cd-select text-sm" style={{ width: 104 }} value={d.payMethod} onChange={(e) => patchDraft(d.id, { payMethod: e.target.value })}>
                          {PAY_METHODS.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 pr-2">
                        <select className="cd-select text-sm" style={{ width: 140 }} value={d.purpose} onChange={(e) => patchDraft(d.id, { purpose: e.target.value })}>
                          <option value="">선택</option>
                          {purposeOptions.map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 pr-2" style={{ maxWidth: 180 }}>
                        <RelatedCellButton
                          label={(relatedLocked ? defaultRelated?.label : d.related?.label) ?? ""}
                          disabled={relatedLocked}
                          missing={purposeNeedsRelated(d.purpose)}
                          className="rounded-md border cd-border-c"
                          onPick={(ref) => patchDraft(d.id, { related: ref })}
                        />
                      </td>
                      <td className="py-1.5">
                        <button
                          type="button"
                          className="cd-btn rounded-lg p-1.5"
                          title="행 삭제"
                          style={{ color: "var(--cd-error)" }}
                          onClick={() => setDrafts((p) => (p.length > 1 ? p.filter((x) => x.id !== d.id) : [newDraft(defaultRelated ?? null)]))}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 날짜 입력은 .cd-input 이 width:100% 라 폭을 고정해 [기간 ~ 전체 기간 조회]를 한 줄로 둔다(2026-09-15 사용자 지적) */}
        <div className="flex items-center gap-2 flex-wrap">
          <label className="cd-label text-xs">{lockedPeriod ? "출장기간" : "기간"}</label>
          {lockedPeriod ? (
            // 출장보고서 — 문서의 출장기간으로 고정(기간 밖 지출은 담을 수 없다)
            <span className="text-[13px] cd-text font-medium whitespace-nowrap" title="출장보고서의 출장기간 내 지출만 표시합니다">
              {lockedPeriod.from} ~ {lockedPeriod.to}
            </span>
          ) : (
            <>
              <DigitDateInput className={`cd-input shrink-0${allTime ? " opacity-60 pointer-events-none" : ""}`} style={{ width: 120 }} value={from} onChange={setFrom} />
              <span className="cd-text-muted">~</span>
              <DigitDateInput className={`cd-input shrink-0${allTime ? " opacity-60 pointer-events-none" : ""}`} style={{ width: 120 }} value={to} onChange={setTo} />
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={allTime} onChange={(e) => setAllTime(e.target.checked)} />
                전체 기간
              </label>
            </>
          )}
          <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={load} disabled={loading}>
            <RefreshCw className="w-3.5 h-3.5" /> 조회
          </button>
          <span className="text-[11px] cd-text-faint ml-auto">
            {tab === "manual"
              ? "등록해 두고 아직 쓰지 않은 기타 증빙 — 골라서 표에 추가하거나 삭제할 수 있습니다"
              : lockedPeriod
                ? '모바일 앱 "영수증 촬영"으로 찍어둔 본인 영수증 중 출장기간에 쓴 건만 표시됩니다'
                : '모바일 앱 "영수증 촬영"으로 찍어둔 본인 영수증만 표시됩니다 — 안 보이면 [전체 기간]으로 조회하세요'}
          </span>
        </div>

        {error && <div className="cd-error-text text-sm">{error}</div>}
        {tripLikeSelected && (
          <div className="flex items-center gap-1.5 text-xs" style={{ color: "var(--cd-warning,#FFAE1F)" }}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            출장성 지출(교통·숙박·유류)이 선택돼 있습니다 — 출장 경비는 출장보고서의 경비 내역 사용을 권장합니다.
          </div>
        )}

        <div className="overflow-x-auto max-h-[50vh] overflow-y-auto border cd-border-c rounded-xl">
          <table className="w-full text-sm">
            <thead className="cd-table-head sticky top-0">
              <tr className="cd-text-muted text-left">
                <th className="py-2 px-3 font-normal w-8"></th>
                <th className="py-2 pr-3 font-normal">{tab === "manual" ? "증빙" : "영수증"}</th>
                <th className="py-2 pr-3 font-normal">사용일</th>
                <th className="py-2 pr-3 font-normal">상호</th>
                <th className="py-2 pr-3 font-normal text-right">금액</th>
                <th className="py-2 pr-3 font-normal">{tab === "manual" ? "지불수단" : "카드"}</th>
                <th className="py-2 pr-3 font-normal">지출 목적 *</th>
                <th className="py-2 pr-3 font-normal">연관 용역/사업장</th>
                <th className="py-2 font-normal">자동 분류</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const used = existing.has(item.receiptId);
                const blocked = used || dateUnknownLocked(item);
                const hasImage = item.hasImage !== false;
                const shotPurpose = item.purpose && !purposeOptions.includes(item.purpose) ? item.purpose : null;
                return (
                  <tr
                    key={item.receiptId}
                    className={`border-t cd-hairline-row-c ${blocked ? "opacity-45" : "cursor-pointer cd-row-hover"}`}
                    onClick={() => !blocked && toggle(item.receiptId)}
                    title={dateUnknownLocked(item) ? "사용일이 없는 영수증 — 영수증 보관함에서 사용일을 고친 뒤 담을 수 있습니다" : undefined}
                  >
                    <td className="py-1.5 px-3">
                      <input type="checkbox" checked={selected.has(item.receiptId) && !blocked} disabled={blocked} readOnly />
                    </td>
                    <td className="py-1.5 pr-3">
                      {hasImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`/api/receipts/${item.receiptId}/image`}
                          alt=""
                          className="w-9 h-9 object-cover rounded border cd-border-c"
                          loading="lazy"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreview(preview === item.receiptId ? null : item.receiptId);
                          }}
                        />
                      ) : (
                        <a
                          className="w-9 h-9 rounded border cd-border-c inline-flex items-center justify-center cd-text-primary"
                          href={`/api/receipts/${item.receiptId}/image?kind=pdf`}
                          target="_blank"
                          rel="noreferrer"
                          title="PDF 원본 열기"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <FileText className="w-4 h-4" />
                        </a>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-xs">
                      {item.paidDate ?? (
                        <span className="cd-text-faint" title="사용일이 인식되지 않은 건 — 촬영일 기준으로 표시합니다">
                          미상 ({item.createdAt?.slice(0, 10) ?? "-"})
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 max-w-[220px] truncate" title={item.storeName ?? ""}>
                      {item.storeName ?? "-"}
                      {used && <span className="ml-1.5 text-[10px] cd-text-faint">(이미 담김)</span>}
                      {tab === "manual" && !used && (
                        <button
                          type="button"
                          className="cd-action ml-1.5 align-[-2px] cd-text-faint hover:text-[color:var(--cd-error)]"
                          title="이 증빙 삭제"
                          onClick={(e) => {
                            e.stopPropagation();
                            void removeManual(item);
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-medium whitespace-nowrap">{item.totalAmount.toLocaleString("ko-KR")}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-xs">
                      {tab === "manual" ? item.payMethod ?? "-" : item.cardLast4 ? `****${item.cardLast4}` : "-"}
                    </td>
                    {/* 지출 목적·연관 용역/사업장 — 촬영·직접 첨부 때 고른 값이 기본, 여기서 고칠 수 있다. 칸을 눌러도 행 선택은 토글하지 않는다 */}
                    <td className="py-1.5 pr-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <select
                          className="cd-input py-1 text-xs"
                          style={{
                            width: 136,
                            ...(showMissing && selected.has(item.receiptId) && !blocked && purposeMissing(item)
                              ? { borderColor: "var(--cd-error)" }
                              : {}),
                          }}
                          disabled={blocked}
                          value={purposeOf(item)}
                          onChange={(e) => editRow(item.receiptId, { purpose: e.target.value })}
                          title={shotPurpose ? `촬영 때 고른 목적: ${shotPurpose} — 이 양식 목록에 없어 다시 골라야 합니다` : undefined}
                        >
                          <option value="">{shotPurpose ? `선택 (촬영: ${shotPurpose})` : "선택"}</option>
                          {purposeOptions.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                        {PURPOSE_HINTS[purposeOf(item)] && (
                          <span className="cd-text-faint cursor-help" title={PURPOSE_HINTS[purposeOf(item)]}>
                            <HelpCircle className="w-3.5 h-3.5" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 pr-3" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 200 }}>
                      <RelatedCellButton
                        label={relatedOf(item)?.label ?? ""}
                        disabled={blocked || relatedLocked}
                        missing={purposeNeedsRelated(purposeOf(item))}
                        className={relatedLocked ? "cd-text-muted" : "rounded-md border cd-border-c"}
                        onPick={(ref) => editRow(item.receiptId, { related: ref })}
                      />
                    </td>
                    <td className="py-1.5">
                      {item.categoryLabel ? (
                        <span className="cd-pill cd-pill-info" title={`근거: ${item.categorySource}`}>
                          {item.formOption ?? item.categoryLabel}
                        </span>
                      ) : (
                        <span className="cd-pill cd-pill-idle">미분류</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-6 text-center cd-text-muted text-sm">
                    {tab === "manual"
                      ? "등록해 둔 미사용 증빙이 없습니다. 위에서 파일과 내역을 입력해 저장하세요."
                      : lockedPeriod
                        ? "출장기간에 쓴 영수증이 없습니다. 사용일이 잘못 인식된 영수증은 영수증 보관함에서 사용일을 고쳐 주세요."
                        : '선택 가능한 영수증이 없습니다. 모바일 앱 홈의 "영수증 촬영"으로 지류 영수증을 찍어 두면 여기에 표시됩니다.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/receipts/${preview}/image`}
            alt="영수증 원본"
            className="max-h-[40vh] mx-auto rounded-xl border cd-border-c cursor-zoom-out"
            onClick={() => setPreview(null)}
          />
        )}
      </div>
    </CdModal>
  );
}
