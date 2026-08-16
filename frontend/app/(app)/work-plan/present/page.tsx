"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Briefcase, ChevronLeft, ChevronRight, ClipboardList, Play, Users } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import type { OversightCard, OversightSession, OversightStage } from "@/lib/work-plan/oversight";
import { summaryLines } from "@/lib/work-plan/summary";
import "@/components/cdash/cdash.css";

const PAGE_SIZE = 6; // 2열 × 3행

/**
 * 카드 종류별 색. 앱 기본 테마(인디고~바이올렛)와 겹치지 않게 용역=틸·시안, Task=앰버·오렌지로 나눈다.
 */
const KIND_THEME = {
  contract: {
    grad: "linear-gradient(135deg, #0E9F8F, #23B5C9)",
    soft: "rgba(14, 159, 143, 0.14)",
    softDark: "rgba(35, 181, 201, 0.2)",
    strong: "#0B7F73",
    strongDark: "#5FD9CB",
    fill: "rgba(14, 159, 143, 0.3)",
  },
  task: {
    grad: "linear-gradient(135deg, #F0A63C, #E2761B)",
    soft: "rgba(226, 140, 40, 0.16)",
    softDark: "rgba(240, 166, 60, 0.22)",
    strong: "#B26410",
    strongDark: "#F3BE72",
    fill: "rgba(226, 140, 40, 0.32)",
  },
} as const;

/** 카드 종류 색 — 다크 테마에서는 대비를 위해 밝은 톤으로 바꾼다. */
function kindTone(kind: "contract" | "task", dark: boolean) {
  const t = KIND_THEME[kind];
  return { grad: t.grad, fill: t.fill, soft: dark ? t.softDark : t.soft, strong: dark ? t.strongDark : t.strong };
}

/** "2026년 32주차 · 주간회의" — 회차 선택기·헤더 공통 표기. */
function sessionLabel(s: OversightSession): string {
  return `${s.year}년 ${s.week}주차 · ${s.meetingLabel}`;
}

/** "08.03~08.09" */
function periodLabel(s: OversightSession): string {
  const md = (d: string) => (d.length >= 10 ? `${d.slice(5, 7)}.${d.slice(8, 10)}` : d);
  return `${md(s.periodStart)}~${md(s.periodEnd)}`;
}

const sessionKey = (s: OversightSession) => `${s.meetingLabel}|${s.periodStart}|${s.periodEnd}`;

/** 공정표형 가로 타임라인(화살표 세그먼트). 단계별 상태 + 진행 단계의 진행률 표기. */
function StageTimeline({ card, dark }: { card: OversightCard; dark: boolean }) {
  const stages: OversightStage[] = card.stages ?? [];
  const tone = kindTone(card.kind, dark);

  // 공정표 미등록 계약·Task 는 기존 요약 진행바로 폴백.
  if (stages.length === 0) {
    const pct = card.stageTotal > 0 ? Math.round((card.stageDone / card.stageTotal) * 100) : 0;
    return (
      <div>
        <div className="flex items-center justify-between mb-1 text-xs md:text-sm">
          <span className="font-bold cd-text truncate">
            {card.currentStage ? `${card.currentStage}${card.currentPct != null ? ` ${Math.round(card.currentPct)}%` : ""}` : `진행 ${card.stageDone}/${card.stageTotal}`}
          </span>
          <span className="cd-text-faint shrink-0 ml-2">{pct}%</span>
        </div>
        <span className="block h-2 rounded-full" style={{ background: "var(--cd-surface)" }}>
          <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: tone.grad }} />
        </span>
      </div>
    );
  }

  const notch = stages.length >= 7 ? 7 : 10; // 단계가 많으면 화살촉을 줄여 라벨 폭 확보
  return (
    <div className="flex gap-[3px]">
      {stages.map((stage, i) => {
        const first = i === 0;
        const last = i === stages.length - 1;
        const head = last ? "100% 0, 100% 100%" : `calc(100% - ${notch}px) 0, 100% 50%, calc(100% - ${notch}px) 100%`;
        const tail = first ? "" : `, ${notch}px 50%`;
        const clipPath = `polygon(0 0, ${head}, 0 100%${tail})`;
        const done = stage.status === "done";
        const active = stage.status === "in_progress";
        const pct = Math.round(stage.pct || 0);
        return (
          <span
            key={`${stage.name}:${i}`}
            className="relative overflow-hidden text-center px-1.5 py-1.5 text-[11px] md:text-[13px] leading-tight"
            style={{
              flex: active ? "1.5 1 0" : "1 1 0",
              clipPath,
              background: done ? tone.grad : active ? tone.soft : "var(--cd-surface)",
              color: done ? "#fff" : active ? tone.strong : "var(--cd-faint)",
              fontWeight: done || active ? 600 : 500,
            }}
            title={`${stage.name}${active ? ` ${pct}%` : ""}`}
          >
            {active && (
              <span className="absolute inset-y-0 left-0" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: tone.fill }} />
            )}
            <span className="relative block truncate">
              {stage.name}
              {active && pct > 0 ? ` ${pct}%` : ""}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export default function PresentPage() {
  const { theme } = useCdashTheme();
  const [departments, setDepartments] = useState<{ deptId: string; deptName: string }[]>([]);
  const [deptId, setDeptId] = useState("");
  const [deptName, setDeptName] = useState("");
  const [cards, setCards] = useState<OversightCard[]>([]);
  const [sessions, setSessions] = useState<OversightSession[]>([]);
  const [selectedKey, setSelectedKey] = useState(""); // "" = 전체(회차 무관 현재 현황)
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

  // 부서를 고르면 회차 목록을 받아 오늘이 속한 회차(없으면 최신 회차)를 기본 선택한다.
  useEffect(() => {
    if (!deptId) return;
    fetch(`/api/work-plan/oversight/sessions?dept=${encodeURIComponent(deptId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list: OversightSession[] = d.sessions ?? [];
        setSessions(list);
        const today = new Date().toISOString().slice(0, 10);
        const current = list.find((s) => s.periodStart <= today && today <= s.periodEnd);
        setSelectedKey(current ? sessionKey(current) : list.length ? sessionKey(list[0]) : "");
      })
      .catch(() => {
        setSessions([]);
        setSelectedKey("");
      });
  }, [deptId]);

  const selected = useMemo(() => sessions.find((s) => sessionKey(s) === selectedKey) ?? null, [sessions, selectedKey]);

  useEffect(() => {
    if (!deptId) return;
    setPage(0);
    const params = new URLSearchParams({ dept: deptId });
    if (selected) {
      params.set("meetingLabel", selected.meetingLabel);
      params.set("periodStart", selected.periodStart);
      params.set("periodEnd", selected.periodEnd);
    }
    fetch(`/api/work-plan/oversight?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCards(d.cards ?? []))
      .catch(() => setCards([]));
  }, [deptId, selected]);

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
            <select
              className="cd-select text-sm"
              value={selectedKey}
              onChange={(e) => setSelectedKey(e.target.value)}
              title="발표 회차"
            >
              {sessions.map((s) => (
                <option key={sessionKey(s)} value={sessionKey(s)}>
                  {sessionLabel(s)} ({periodLabel(s)}) · {s.reportCount}건
                </option>
              ))}
              <option value="">회차 무관 — 현재 진행 현황</option>
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
            {selected ? "이 회차에 등록된 보고가 없습니다." : "이 부서로 지정된 용역이 없습니다."}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 mb-3">
              <div className="min-w-0 flex items-baseline gap-2.5 flex-wrap">
                <span className="text-lg md:text-2xl font-bold cd-text">
                  {deptName} · {selected ? selected.meetingLabel : "진행 현황"}
                </span>
                {selected && (
                  <span className="text-sm md:text-lg font-semibold cd-text-primary">
                    {selected.year}년 {selected.week}주차
                    <span className="cd-text-faint font-normal"> ({periodLabel(selected)})</span>
                  </span>
                )}
              </div>
              <span className="text-sm md:text-base cd-text-faint shrink-0">{page + 1} / {totalPages}</span>
            </div>

            {/* 용역·Task 카드 — 2열 × 3행 */}
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide grid grid-cols-1 lg:grid-cols-2 auto-rows-fr gap-4">
              {pageCards.map((card) => {
                const lines = summaryLines(card.summaryText || card.latestProgress);
                const tone = kindTone(card.kind, theme === "dark");
                return (
                  <div
                    key={`${card.kind}:${card.subjectId}`}
                    className="relative overflow-hidden rounded-2xl border cd-border-c p-4 md:p-5 pl-5 md:pl-6 flex flex-col gap-3 min-h-0"
                  >
                    {/* 종류 구분 색띠 — 용역=틸·시안, Task=앰버·오렌지 */}
                    <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: tone.grad }} />
                    <div className="flex items-start gap-2.5">
                      <span
                        className="shrink-0 mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md"
                        style={{ background: tone.soft, color: tone.strong }}
                      >
                        {card.kind === "task" ? <ClipboardList className="w-3.5 h-3.5" /> : <Briefcase className="w-3.5 h-3.5" />}
                        {card.kind === "task" ? "Task" : "용역"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-base md:text-xl font-bold cd-text leading-snug line-clamp-2">{card.title}</p>
                        <p className="text-xs md:text-sm cd-text-faint truncate">
                          {[card.counterpartyName, card.categoryLabel].filter(Boolean).join(" · ") || "—"}
                        </p>
                      </div>
                      {card.issueOpen > 0 && (
                        <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs" style={{ background: "var(--cd-error-soft)", color: "var(--cd-error)" }}>
                          <AlertTriangle className="w-3.5 h-3.5" /> 이슈 {card.issueOpen}
                        </span>
                      )}
                    </div>

                    <StageTimeline card={card} dark={theme === "dark"} />

                    {lines.length > 0 && (
                      <ul className="flex-1 min-h-0 flex flex-col gap-1.5">
                        {lines.map((line, i) => (
                          <li key={i} className="flex gap-2 text-sm md:text-lg leading-relaxed cd-text">
                            <span className="shrink-0" style={{ color: tone.strong }}>•</span>
                            <span className="line-clamp-2">{line}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {card.participantNames && (
                      <p className="text-xs md:text-sm cd-text-faint inline-flex items-center gap-1.5 mt-auto">
                        <Users className="w-4 h-4 shrink-0" /> <span className="truncate">{card.participantNames}</span>
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
