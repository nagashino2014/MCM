"use client";

import { ReceiptText } from "lucide-react";
import { useHomeWidget } from "@/components/home/useHomeWidget";

/**
 * 내 급여명세서 위젯 (블루프린트 §4-1 후속) — 발행된 월별 명세서 열람·내려받기.
 * 근로기준법 제48조② 임금명세서 교부는 이 카드(사내 전산망)로 이뤄지며, 메일은 도착 알림만 보낸다.
 */

interface MyPayslipRow {
  entryId: string;
  payYear: number;
  payMonth: number;
  payTotal: number;
  deductionTotal: number;
  netPay: number;
  sentAt: string | null;
}

interface MyPayslipsData {
  rows: MyPayslipRow[];
  linked: boolean;
}

const won = (v: number) => Math.round(v).toLocaleString();

export function PayslipInboxCard() {
  const w = useHomeWidget<MyPayslipsData>("/api/payroll/my-statements");

  if (w.status === "forbidden") return null;

  return (
    <section className="cd-card rounded-3xl p-4 flex h-full min-h-0 flex-col gap-3 cd-reveal">
      <header className="flex items-center gap-2">
        <span className="cd-title-icon"><ReceiptText className="w-4 h-4" /></span>
        <h3 className="text-sm font-extrabold cd-text">내 급여명세서</h3>
        {w.status === "ok" && w.data.rows.length > 0 && (
          <span className="ml-auto text-[10px] cd-text-faint">최근 {w.data.rows.length}개월</span>
        )}
      </header>
      {w.status === "loading" ? (
        <div className="flex-1 rounded-2xl border cd-border-c animate-pulse" />
      ) : w.status === "error" ? (
        <p className="text-xs cd-text-faint">불러오지 못했습니다.</p>
      ) : !w.data.linked ? (
        <p className="text-xs cd-text-faint leading-relaxed">계정과 직원 정보가 연결되어 있지 않습니다.</p>
      ) : w.data.rows.length === 0 ? (
        <p className="text-xs cd-text-faint leading-relaxed">발행된 급여명세서가 없습니다.</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide flex flex-col gap-2">
          {w.data.rows.map((row) => (
            <div key={row.entryId} className="flex items-center gap-2 rounded-2xl border cd-border-c px-3 py-2">
              <span
                className="rounded-full px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap"
                style={{ color: "var(--cd-primary)", background: "var(--cd-primary-soft)" }}
              >
                {row.payMonth}월
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold cd-text truncate">
                  {row.payYear}년 {row.payMonth}월분 · 실지급 {won(row.netPay)}원
                </p>
                <p className="text-[10px] cd-text-faint">
                  지급 {won(row.payTotal)} · 공제 {won(row.deductionTotal)}
                </p>
              </div>
              <a
                className="ml-auto text-[11px] font-bold whitespace-nowrap"
                style={{ color: "var(--cd-primary)" }}
                href={`/api/payroll/my-statements/${row.entryId}/file`}
                target="_blank"
                rel="noreferrer"
              >
                열람
              </a>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
