"use client";

import { Radar } from "lucide-react";
import { HomeCard } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";
import { GradeTag, RelevanceTag } from "@/components/sales/intel/intel-shared";

interface IntelSignal {
  signalId: string;
  companyName: string | null;
  reportName: string | null;
  signalGrade: string | null;
  industryRelevance: string | null;
  relevanceNote: string | null;
  url: string | null;
}

const ROW_CLS =
  "w-full flex items-start gap-2 rounded-lg border cd-border-c px-3 py-2 text-left hover:bg-[color:var(--cd-surface)] transition-colors";

/** H6 — 인텔 신호 하이라이트: 최근 confirmed·direct 신호 TOP5. 원문 새 탭 이동. */
export function IntelHighlightsCard() {
  const w = useHomeWidget<{ signals: IntelSignal[]; total: number }>(
    "/api/sales/intel/signals?grade=confirmed&relevance=direct&limit=5"
  );
  if (w.status === "forbidden") return null;
  const signals = w.status === "ok" ? w.data.signals : [];

  return (
    <HomeCard
      icon={<Radar className="w-4 h-4" />}
      title="인텔 신호 하이라이트"
      count={signals.length}
      accent="#13DEB9"
      href="/sales/intel"
      hrefLabel="API & 스크래핑"
      loading={w.status === "loading"}
      error={w.status === "error" ? w.message : undefined}
      empty={w.status === "ok" && signals.length === 0}
      emptyText="최근 확정·직접 신호가 없습니다."
    >
      <ul className="flex flex-col gap-1.5">
        {signals.map((s) => (
          <li key={s.signalId}>
            <a
              href={s.url ?? "/sales/intel"}
              target={s.url ? "_blank" : undefined}
              rel="noreferrer"
              className={ROW_CLS}
            >
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] cd-text truncate">
                  {s.companyName ?? "회사 미상"}
                </span>
                {s.reportName && (
                  <span className="block text-[11px] cd-text-faint truncate">{s.reportName}</span>
                )}
              </span>
              <span className="flex items-center gap-1 shrink-0">
                {s.signalGrade && <GradeTag grade={s.signalGrade} />}
                <RelevanceTag relevance={s.industryRelevance} note={s.relevanceNote} />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </HomeCard>
  );
}
