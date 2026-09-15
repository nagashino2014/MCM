"use client";

// 개인카드 영수증 불러오기 모달 (accounting-expansion 블루프린트 §2, P1)
// 지출결의서·출장보고서 기안 화면에서 본인이 촬영해 둔 미사용 영수증을 다중 선택해 지출 내역 표로 넘긴다.
// CardPickerModal(법인카드)의 형제 — 목록이 "본인 영수증"이라는 점과, 선택 시 증빙 PDF 가
// 첨부서류에 자동 추가된다는 점만 다르다. 썸네일 클릭으로 원본 이미지를 확인할 수 있다.
// 탭 2종(2026-09-15 사용자 요청): '모바일앱 첨부'(촬영 스톡) / '직접 첨부'(계좌이체 확인증·수기 전표 등
// 스캔본을 여러 건 올리며 상호·사용일·금액·지불수단·지출 목적을 직접 입력 — 저장 즉시 표에 담긴다).

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, AlertTriangle, FileText, Plus, Trash2, Upload, Loader2 } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { DigitDateInput } from "@/components/finance/DigitDateInput";

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
  /** 직접 첨부의 지출 목적 — 표 행 detail 프리필 */
  purpose?: string | null;
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
}

const PAY_METHODS = ["현금", "계좌이체", "개인카드", "기타"];

/** 입력용 YYYY-MM-DD (KST 기준) — toISOString 은 UTC 라, 오전 9시 이전에는 "오늘"이 하루 밀려
 *  그날 찍은 영수증이 조회 범위에서 빠졌다. 저장 값(KST)과 기준을 맞춘다. */
const ymdInput = (ms: number) => new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);

let draftSeq = 1;
const newDraft = (): ManualDraft => ({ id: draftSeq++, file: null, storeName: "", paidAt: "", totalAmount: "", payMethod: "계좌이체", purpose: "" });

export function ReceiptPickerModal({
  open,
  onClose,
  formId,
  existingIds,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  formId: string;
  /** 이미 이 문서의 지출 내역 표에 담긴 영수증(_receiptId) */
  existingIds: string[];
  onPick: (items: ReceiptPickerItem[]) => void;
}) {
  const [tab, setTab] = useState<"mobile" | "manual">("mobile");
  const [from, setFrom] = useState(() => ymdInput(Date.now() - 90 * 86400000));
  const [to, setTo] = useState(() => ymdInput(Date.now()));
  /** 기간 무시하고 전부 — 사용일이 잘못 인식된 건을 찾을 때 쓴다. */
  const [allTime, setAllTime] = useState(false);
  const [items, setItems] = useState<ReceiptPickerItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
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
      if (!allTime) {
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
  }, [formId, from, to, allTime, tab]);

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setPreview(null);
      load();
    }
  }, [open, load]);

  useEffect(() => {
    if (!open) {
      setTab("mobile");
      setDrafts([newDraft()]);
    }
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

  const submit = () => {
    const picked = items.filter((i) => selected.has(i.receiptId));
    if (!picked.length) return;
    onPick(picked);
    onClose();
  };

  // ── 직접 첨부 ──
  const patchDraft = (id: number, p: Partial<ManualDraft>) => setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...p } : d)));
  const activeDrafts = drafts.filter((d) => d.file || d.storeName.trim() || d.totalAmount.trim());

  const uploadManual = async () => {
    const rows = activeDrafts;
    if (!rows.length) return;
    const missing = rows.find((d) => !d.file || !d.storeName.trim() || !(Number(d.totalAmount.replace(/[^\d]/g, "")) > 0));
    if (missing) {
      alert("각 행에 증빙 파일·상호·금액을 입력하세요.");
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
            fileIndex: i,
          }))
        )
      );
      const res = await fetch("/api/receipts/manual", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string })?.error ?? "직접 첨부 저장 실패");
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

  const fmtAmount = (s: string) => {
    const n = Number(s.replace(/[^\d]/g, ""));
    return n > 0 ? n.toLocaleString("ko-KR") : "";
  };

  return (
    <CdModal
      open={open}
      onClose={onClose}
      title={tab === "manual" ? "영수증 직접 첨부" : "개인카드 영수증 불러오기"}
      size="xl"
      footer={
        tab === "manual" ? (
          <>
            <span className="text-xs cd-text-muted mr-auto">
              {activeDrafts.length}건 입력 — 저장하면 표 행과 첨부서류에 바로 추가됩니다
            </span>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>
              취소
            </button>
            <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={uploading || !activeDrafts.length} onClick={() => void uploadManual()}>
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} 저장 후 표에 추가
            </button>
          </>
        ) : (
          <>
            <span className="text-xs cd-text-muted mr-auto">{selected.size}건 선택 — 영수증 PDF가 첨부서류에 함께 추가됩니다</span>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>
              취소
            </button>
            <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={selected.size === 0} onClick={submit}>
              표에 추가
            </button>
          </>
        )
      }
    >
      <div className="space-y-3">
        {/* 탭 — 모바일앱 첨부 / 직접 첨부 */}
        <div className="flex rounded-xl border cd-border-c overflow-hidden text-sm font-semibold w-fit">
          {(
            [
              ["mobile", "모바일앱 첨부"],
              ["manual", "직접 첨부"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setTab(k);
                setSelected(new Set());
                setPreview(null);
              }}
              data-active={tab === k}
              aria-pressed={tab === k}
              className={`cd-choice px-3.5 py-1.5 transition ${tab === k ? "cd-fill-primary text-white" : "cd-text"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "manual" && (
          <div className="rounded-xl border cd-border-c px-3.5 py-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold cd-text">새로 올리기</span>
              <span className="text-[11px] cd-text-faint">
                현금 계좌이체 확인증·수기 전표 등의 스캔본(이미지·PDF)을 건별로 올리고 내역을 입력하세요. 여러 건을 한 번에 저장할 수 있습니다.
              </span>
              <button type="button" className="cd-btn cd-btn-soft cd-btn-sm ml-auto" onClick={() => setDrafts((p) => [...p, newDraft()])}>
                <Plus className="w-3.5 h-3.5" /> 행 추가
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="cd-table-head">
                  <tr className="cd-text-muted text-left text-[11px]">
                    <th className="py-1.5 pr-2 font-normal">증빙 파일 *</th>
                    <th className="py-1.5 pr-2 font-normal">상호 *</th>
                    <th className="py-1.5 pr-2 font-normal">사용일</th>
                    <th className="py-1.5 pr-2 font-normal text-right">금액 *</th>
                    <th className="py-1.5 pr-2 font-normal">지불수단</th>
                    <th className="py-1.5 pr-2 font-normal">지출 목적</th>
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
                      <td className="py-1.5 pr-2" style={{ minWidth: 160 }}>
                        <input className="cd-input text-sm w-full" placeholder="지출 목적" value={d.purpose} onChange={(e) => patchDraft(d.id, { purpose: e.target.value })} />
                      </td>
                      <td className="py-1.5">
                        <button
                          type="button"
                          className="cd-btn rounded-lg p-1.5"
                          title="행 삭제"
                          style={{ color: "var(--cd-error)" }}
                          onClick={() => setDrafts((p) => (p.length > 1 ? p.filter((x) => x.id !== d.id) : [newDraft()]))}
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
          <label className="cd-label text-xs">기간</label>
          <input
            type="date"
            className="cd-input shrink-0"
            style={{ width: 150 }}
            value={from}
            disabled={allTime}
            onChange={(e) => setFrom(e.target.value)}
          />
          <span className="cd-text-muted">~</span>
          <input
            type="date"
            className="cd-input shrink-0"
            style={{ width: 150 }}
            value={to}
            disabled={allTime}
            onChange={(e) => setTo(e.target.value)}
          />
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input type="checkbox" checked={allTime} onChange={(e) => setAllTime(e.target.checked)} />
            전체 기간
          </label>
          <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={load} disabled={loading}>
            <RefreshCw className="w-3.5 h-3.5" /> 조회
          </button>
          <span className="text-[11px] cd-text-faint ml-auto">
            {tab === "manual"
              ? "이전에 직접 첨부해 둔 미사용 증빙 — 골라서 표에 추가할 수 있습니다"
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
                <th className="py-2 font-normal">{tab === "manual" ? "지출 목적" : "자동 분류"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const used = existing.has(item.receiptId);
                const hasImage = item.hasImage !== false;
                return (
                  <tr
                    key={item.receiptId}
                    className={`border-t cd-hairline-row-c ${used ? "opacity-45" : "cursor-pointer cd-row-hover"}`}
                    onClick={() => !used && toggle(item.receiptId)}
                  >
                    <td className="py-1.5 px-3">
                      <input type="checkbox" checked={selected.has(item.receiptId)} disabled={used} readOnly />
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
                    </td>
                    <td className="py-1.5 pr-3 text-right font-medium whitespace-nowrap">{item.totalAmount.toLocaleString("ko-KR")}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-xs">
                      {tab === "manual" ? item.payMethod ?? "-" : item.cardLast4 ? `****${item.cardLast4}` : "-"}
                    </td>
                    <td className="py-1.5">
                      {tab === "manual" ? (
                        <span className="text-xs cd-text-muted truncate block max-w-[220px]" title={item.purpose ?? ""}>{item.purpose ?? "-"}</span>
                      ) : item.categoryLabel ? (
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
                  <td colSpan={7} className="py-6 text-center cd-text-muted text-sm">
                    {tab === "manual"
                      ? "직접 첨부해 둔 미사용 증빙이 없습니다. 위에서 파일과 내역을 입력해 저장하세요."
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
