"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Briefcase, ChevronLeft, ChevronRight, ClipboardList, Play, Users } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import type { OversightCard } from "@/lib/work-plan/oversight";
import "@/components/cdash/cdash.css";

const PAGE_SIZE = 8; // 2열 × 4행

export default function PresentPage() {
  const { theme } = useCdashTheme();
  const [departments, setDepartments] = useState<{ deptId: string; deptName: string }[]>([]);
  const [deptId, setDeptId] = useState("");
  const [deptName, setDeptName] = useState("");
  const [cards, setCards] = useState<OversightCard[]>([]);
  const [page, setPage] = useState(0);

  useEffect(() => {
    fetch("/api/departments", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list = d.departments ?? [];
        setDepartments(list);
        if (list.length && !deptId) {
          setDeptId(list[0].deptId);
          setDeptName(list[0].deptName);
        }
      })
      .catch(() => setDepartments([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!deptId) return;
    setPage(0);
    fetch(`/api/work-plan/oversight?dept=${encodeURIComponent(deptId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCards(d.cards ?? []))
      .catch(() => setCards([]));
  }, [deptId]);

  const totalPages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
  const next = useCallback(() => setPage((p) => Math.min(p + 1, totalPages - 1)), [totalPages]);
  const prev = useCallback(() => setPage((p) => Math.max(p - 1, 0)), []);

  // 자동 전환 없음 — ←/→ 키·버튼 수동 조작만.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  const pageCards = useMemo(() => cards.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE), [cards, page]);

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-4 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<Play className="w-5 h-5" />}
        eyebrow="Work · Presentation"
        title="발표 모드"
        subtitle="회의·간담회용 부서 보고 발표. ←/→ 또는 버튼으로 페이지 이동."
        actions={
          <div className="flex items-center gap-2">
            <select
              className="cd-select text-sm"
              value={deptId}
              onChange={(e) => {
                setDeptId(e.target.value);
                setDeptName(departments.find((d) => d.deptId === e.target.value)?.deptName ?? "");
              }}
            >
              {departments.map((d) => (
                <option key={d.deptId} value={d.deptId}>{d.deptName}</option>
              ))}
            </select>
            <Link href="/work-plan" className="cd-btn rounded-xl px-3 py-2 text-sm border cd-border-c cd-text-muted inline-flex items-center gap-1.5">
              <ArrowLeft className="w-4 h-4" /> 나가기
            </Link>
          </div>
        }
      />

      <section className="cd-card rounded-3xl flex-1 min-h-0 flex flex-col p-4 md:p-6 cd-reveal delay-1">
        {cards.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-center cd-text-faint">
            이 부서로 지정된 용역이 없습니다.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 mb-3">
              <span className="text-base md:text-lg font-bold cd-text-primary">{deptName} · 주간 업무 보고</span>
              <span className="text-sm md:text-base cd-text-faint">{page + 1} / {totalPages}</span>
            </div>

            {/* 용역·Task 카드 — 2열 × 4행 */}
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide grid grid-cols-1 lg:grid-cols-2 auto-rows-fr gap-3">
              {pageCards.map((card) => {
                const stagePct = card.stageTotal > 0 ? Math.round((card.stageDone / card.stageTotal) * 100) : 0;
                const summary = card.summaryText || card.latestProgress;
                return (
                  <div key={`${card.kind}:${card.subjectId}`} className="rounded-2xl border cd-border-c p-3.5 flex flex-col gap-2 min-h-0">
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md cd-tint-primary cd-text-primary">
                        {card.kind === "task" ? <ClipboardList className="w-3 h-3" /> : <Briefcase className="w-3 h-3" />}
                        {card.kind === "task" ? "Task" : "용역"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm md:text-base font-bold cd-text leading-snug line-clamp-2">{card.title}</p>
                        <p className="text-[11px] md:text-xs cd-text-faint truncate">
                          {[card.counterpartyName, card.categoryLabel].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>
                      {card.issueOpen > 0 && (
                        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px]" style={{ background: "#FCEBEB", color: "#791F1F" }}>
                          <AlertTriangle className="w-3 h-3" /> 이슈 {card.issueOpen}
                        </span>
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1 text-[11px] md:text-xs">
                        <span className="font-bold cd-text truncate">
                          {card.currentStage ? `${card.currentStage}${card.currentPct != null ? ` ${Math.round(card.currentPct)}%` : ""}` : `진행 ${card.stageDone}/${card.stageTotal}`}
                        </span>
                        <span className="cd-text-faint shrink-0 ml-2">{stagePct}%</span>
                      </div>
                      <span className="block h-1.5 rounded-full" style={{ background: "var(--cd-surface)" }}>
                        <span className="block h-full rounded-full" style={{ width: `${stagePct}%`, background: "#1D9E75" }} />
                      </span>
                    </div>

                    {summary && (
                      <p className="text-[11px] md:text-xs cd-text-muted leading-relaxed line-clamp-4 flex-1">{summary}</p>
                    )}

                    {card.participantNames && (
                      <p className="text-[11px] md:text-xs cd-text-faint inline-flex items-center gap-1.5 mt-auto">
                        <Users className="w-3.5 h-3.5 shrink-0" /> <span className="truncate">{card.participantNames}</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-center gap-4 pt-3">
              <button type="button" onClick={prev} disabled={page === 0} className="p-3 rounded-xl border cd-border-c cd-text-muted cd-row-hover disabled:opacity-40" aria-label="이전">
                <ChevronLeft className="w-6 h-6" />
              </button>
              <span className="text-sm cd-text-faint min-w-[64px] text-center">{page + 1} / {totalPages}</span>
              <button type="button" onClick={next} disabled={page >= totalPages - 1} className="p-3 rounded-xl border cd-border-c cd-text-muted cd-row-hover disabled:opacity-40" aria-label="다음">
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
