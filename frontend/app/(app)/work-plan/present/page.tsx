"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, Pause, Play, Users } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import type { OversightCard } from "@/lib/work-plan/oversight";
import "@/components/cdash/cdash.css";

export default function PresentPage() {
  const { theme, toggleTheme } = useCdashTheme();
  const [departments, setDepartments] = useState<{ deptId: string; deptName: string }[]>([]);
  const [deptId, setDeptId] = useState("");
  const [deptName, setDeptName] = useState("");
  const [cards, setCards] = useState<OversightCard[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);

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
    setIndex(0);
    fetch(`/api/work-plan/oversight?dept=${encodeURIComponent(deptId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCards(d.cards ?? []))
      .catch(() => setCards([]));
  }, [deptId]);

  const next = useCallback(() => setIndex((i) => (cards.length ? (i + 1) % cards.length : 0)), [cards.length]);
  const prev = useCallback(() => setIndex((i) => (cards.length ? (i - 1 + cards.length) % cards.length : 0)), [cards.length]);

  useEffect(() => {
    if (!playing || cards.length <= 1) return;
    const t = setInterval(next, 30000);
    return () => clearInterval(t);
  }, [playing, cards.length, next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === " ") setPlaying((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  const card = cards[index] ?? null;
  const stagePct = card && card.stageTotal > 0 ? Math.round((card.stageDone / card.stageTotal) * 100) : 0;

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-4 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<Play className="w-5 h-5" />}
        eyebrow="Work · Presentation"
        title="발표 모드"
        subtitle="회의·간담회용 부서 보고 발표. ←/→ 이동, Space 재생/정지, 30초 자동 전환."
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

      <section className="cd-card rounded-3xl flex-1 min-h-0 flex flex-col p-8 md:p-12 cd-reveal delay-1">
        {!card ? (
          <div className="flex-1 flex items-center justify-center text-center cd-text-faint">
            이 부서로 지정된 용역이 없습니다.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <span className="text-base md:text-xl font-bold cd-text-primary">{deptName} · 주간 업무 보고</span>
              <span className="text-sm md:text-lg cd-text-faint">{index + 1} / {cards.length}</span>
            </div>

            <div className="flex-1 min-h-0 flex flex-col justify-center gap-6 md:gap-8">
              <div>
                <h1 className="text-3xl md:text-5xl font-extrabold cd-text leading-tight">{card.title}</h1>
                <p className="text-lg md:text-2xl cd-text-faint mt-2">{card.subtitle}</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2 text-base md:text-xl">
                  <span className="font-bold cd-text">
                    {card.currentStage ? `${card.currentStage}${card.currentPct != null ? ` ${Math.round(card.currentPct)}%` : ""}` : `진행 ${card.stageDone}/${card.stageTotal}`}
                  </span>
                  {card.issueOpen > 0 && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm md:text-lg" style={{ background: "#FCEBEB", color: "#791F1F" }}>
                      <AlertTriangle className="w-4 h-4 md:w-5 md:h-5" /> 이슈 {card.issueOpen}건
                    </span>
                  )}
                </div>
                <span className="block h-3 md:h-4 rounded-full" style={{ background: "var(--cd-surface)" }}>
                  <span className="block h-full rounded-full" style={{ width: `${stagePct}%`, background: "#1D9E75" }} />
                </span>
              </div>

              {card.latestProgress && (
                <p className="text-xl md:text-3xl cd-text leading-relaxed">{card.latestProgress}</p>
              )}

              {card.participantNames && (
                <p className="text-base md:text-2xl cd-text-faint inline-flex items-center gap-2">
                  <Users className="w-5 h-5 md:w-6 md:h-6" /> {card.participantNames}
                </p>
              )}
            </div>

            <div className="flex items-center justify-center gap-4">
              <button type="button" onClick={prev} className="p-3 rounded-xl border cd-border-c cd-text-muted cd-row-hover" aria-label="이전">
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button type="button" onClick={() => setPlaying((p) => !p)} className="p-3 rounded-xl cd-fill-primary text-white" aria-label={playing ? "정지" : "재생"}>
                {playing ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
              </button>
              <button type="button" onClick={next} className="p-3 rounded-xl border cd-border-c cd-text-muted cd-row-hover" aria-label="다음">
                <ChevronRight className="w-6 h-6" />
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
