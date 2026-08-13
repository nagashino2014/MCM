"use client";

import { Coins } from "lucide-react";
import { useHomeWidget } from "@/components/home/useHomeWidget";

/**
 * 내 성과급 지급내역 위젯 — 본인 반기별 성과급(bonus_statements, 서버에서 본인 강제).
 * 지급 명세서 발송(BS-P3)과 함께 앱 내 확인 채널로 제공(블루프린트 §6).
 */

interface BonusMeRow {
  periodYear: number;
  periodHalf: string;
  bucket: string;
  totalAmount: number;
  lineCount: number;
}

interface BonusMeData {
  rows: BonusMeRow[];
  linked: boolean;
}

function periodLabel(row: BonusMeRow): string {
  return `${row.periodYear}년 ${row.periodHalf === "H1" ? "상반기" : "하반기"}`;
}

export function BonusMyCard() {
  const w = useHomeWidget<BonusMeData>("/api/bonus/me");
  if (w.status === "forbidden") return null;

  return (
    <section className="cd-card rounded-3xl p-4 flex h-full min-h-0 flex-col gap-3 cd-reveal">
      <header className="flex items-center gap-2">
        <span className="cd-title-icon"><Coins className="w-4 h-4" /></span>
        <h3 className="text-sm font-extrabold cd-text">내 성과급 지급내역</h3>
      </header>
      {w.status === "loading" ? (
        <div className="flex-1 rounded-2xl border cd-border-c animate-pulse" />
      ) : w.status === "error" ? (
        <p className="text-xs cd-text-faint">불러오지 못했습니다.</p>
      ) : !w.data.linked ? (
        <p className="text-xs cd-text-faint leading-relaxed">
          계정과 직원 정보가 연결되어 있지 않습니다. 관리자에게 문의하세요.
        </p>
      ) : w.data.rows.length === 0 ? (
        <p className="text-xs cd-text-faint leading-relaxed">아직 산정된 성과급 내역이 없습니다.</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide flex flex-col gap-2">
          {w.data.rows.map((row, i) => (
            <div
              key={`${row.periodYear}-${row.periodHalf}`}
              className={`flex items-center gap-2 rounded-2xl border cd-border-c px-3 py-2 ${i === 0 ? "cd-tint-primary" : ""}`}
            >
              <span className="text-xs font-semibold cd-text whitespace-nowrap">{periodLabel(row)}</span>
              {row.lineCount > 0 && (
                <span className="text-[10px] cd-text-faint whitespace-nowrap">용역 {row.lineCount}건</span>
              )}
              <span className="ml-auto text-sm font-extrabold cd-text whitespace-nowrap">
                {Math.round(row.totalAmount).toLocaleString()}원
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
