"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { ClipboardCheck, Download, RefreshCw } from "lucide-react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import {
  ReviewQueueTable,
  type ReviewRow,
} from "@/components/review/ReviewQueueTable";
import { ReviewSidePanel } from "@/components/review/ReviewSidePanel";
import { PaginationControls } from "@/components/ui/PaginationControls";

export default function ReviewPage() {
  return (
    <ToastProvider>
      <ReviewPageInner />
    </ToastProvider>
  );
}

function ReviewPageInner() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: "admin" | "editor" | "viewer" } | undefined)?.role ?? "viewer";
  const canEdit = role === "admin" || role === "editor";
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [includeReviewed, setIncludeReviewed] = useState(false);
  const [limit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ReviewRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url =
        "/api/parsed-fields?limit=" + limit + "&offset=" + offset +
        (includeReviewed ? "&includeReviewed=1" : "");
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = (await res.json()) as { items: ReviewRow[]; total: number };
      setRows(json.items || []);
      setTotal(json.total || 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [includeReviewed, limit, offset]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleSave = useCallback(
    async (id: number, reviewedValue: string) => {
      const res = await fetch("/api/parsed-fields/" + id, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reviewedValue, needsReview: false }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error("HTTP " + res.status + " " + text.slice(0, 200));
      }
      toast.show("검수 값이 저장되었습니다.");
      // 현재 선택 해제 + 목록 새로고침
      setSelected(null);
      reload();
    },
    [reload, toast]
  );

  const handleExportDiagnostic = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const url =
        "/api/parsed-fields/export?limit=500" +
        (includeReviewed ? "&includeReviewed=1" : "");
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error("HTTP " + res.status + " " + text.slice(0, 200));
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") || "";
      const m = cd.match(/filename="?([^";]+)"?/i);
      const fileName = m ? m[1] : "review-diagnostic.json";
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
      toast.show("진단 JSON 다운로드 완료: " + fileName);
    } catch (err) {
      toast.show("진단 JSON 다운로드 실패: " + (err as Error).message);
    } finally {
      setExporting(false);
    }
  }, [exporting, includeReviewed, toast]);

  const headerStats = useMemo(
    () => ({
      total,
      shown: rows.length,
    }),
    [rows.length, total]
  );

  return (
    <div className="flex flex-col gap-6 p-2">
      <section className="glass-panel p-8 rounded-3xl relative overflow-hidden reveal">
        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-stone-800 mb-2 flex items-center gap-3">
              <ClipboardCheck className="w-7 h-7 text-primary" />
              데이터 · 검수 대기열
            </h1>
            <p className="text-stone-600 text-base max-w-3xl">
              OCR 추출 시 신뢰도가 낮거나 필수 항목이 빈 값으로 잡힌 필드가 표시됩니다.
              우측 패널에서 source text를 확인한 뒤 확정 값을 입력하세요.
            </p>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <label className="flex items-center gap-2 text-xs font-bold text-stone-600">
              <input
                type="checkbox"
                checked={includeReviewed}
                onChange={(e) => {
                  setOffset(0);
                  setIncludeReviewed(e.target.checked);
                }}
              />
              검수 완료 항목 포함
            </label>
            <button
              type="button"
              onClick={handleExportDiagnostic}
              disabled={exporting}
              className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700 flex items-center gap-1 disabled:opacity-50"
              title="첨부 단위로 묶인 실패 사유/원본 텍스트/페이지 위치를 JSON으로 다운로드"
            >
              <Download className={"w-3 h-3 " + (exporting ? "animate-pulse" : "")} />
              진단 JSON
            </button>
            <button
              type="button"
              onClick={reload}
              className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700 flex items-center gap-1"
            >
              <RefreshCw className={"w-3 h-3 " + (loading ? "animate-spin" : "")} />
              새로고침
            </button>
          </div>
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-primary/10 to-transparent pointer-events-none" />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-6">
        <section className="glass-panel rounded-3xl p-6 reveal delay-1">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-stone-700">검수 항목 ({headerStats.total}건)</h3>
            <span className="text-[11px] text-stone-400 font-medium">
              표시 {headerStats.shown} / 총 {headerStats.total}
            </span>
          </div>
          {error && (
            <div className="text-red-600 text-sm font-bold mb-3">조회 실패: {error}</div>
          )}
          <ReviewQueueTable
            rows={rows}
            selectedId={selected?.id ?? null}
            onSelect={(r) => setSelected(r)}
            loading={loading}
          />
          <div className="pt-4 mt-4 border-t border-white/50">
            <PaginationControls
              total={total}
              limit={limit}
              offset={offset}
              loading={loading}
              onPageChange={(nextOffset) => {
                setSelected(null);
                setOffset(nextOffset);
              }}
            />
          </div>
        </section>

        <aside className="reveal delay-2">
          <ReviewSidePanel
            row={selected}
            onSave={handleSave}
            onClose={() => setSelected(null)}
            canEdit={canEdit}
          />
        </aside>
      </div>
    </div>
  );
}
