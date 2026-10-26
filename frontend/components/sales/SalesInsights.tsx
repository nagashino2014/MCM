"use client";

// Salesboard 하단 인포그래픽 존(2026-10-26, 3단계) — 기록된 위젯 W4~W7 + W8 요약 카드.
//   W4 파이프라인 퍼널 · W5 용역 분류 분포 · W6 수주 성과(연도별) · W7 담당자 현황 · W8 인텔·AI 브리핑 요약.
// 데이터: W4~W7 은 목록 응답(가시성 scope 적용)·탭 패널 응답에서만 파생한다(새 API 없음). W8 은 기존 인텔·RAG API.
// 기준: 상단 KPI 띠와 같이 '보이는 영업건 전체'. 아래 목록의 검색·담당·연도·태그 필터와 무관하다.
// 차트 규칙(dataviz): 막대 ≤24px·끝 4px 둥글게, 값은 막대 끝 텍스트 색, 단일 계열은 범례 없음, 호버·포커스 툴팁은
//   보조일 뿐 값은 화면에 모두 보인다. 수주·실주를 녹/적 두 색으로 칠하면 적록 색각에서 구분이 약해(ΔE 6.2, 다크 명도 범위 이탈)
//   W6 는 수주율 한 색 게이지 + 건수 글자로 그린다.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Bot, Filter, PieChart, Radar, Trophy, Users } from "lucide-react";
import { CdHelp } from "@/components/cdash/CdHelp";
import {
  SALES_SERVICE_CATEGORIES,
  SALES_SUBCATEGORY_LABELS,
  type SalesEmployeeOption,
  type SalesProject,
  type SalesStage,
} from "@/lib/sales/types";

// 퍼널 단계(도달 단계 기준) — 첫 칸은 전체(모든 영업건이 리드 이상)
export const FUNNEL_STEPS: { stage: SalesStage; label: string }[] = [
  { stage: "lead", label: "전체 영업건" },
  { stage: "contact", label: "컨택 이상" },
  { stage: "proposal", label: "제안 이상" },
  { stage: "bidding", label: "입찰 이상" },
  { stage: "won", label: "수주" },
];
const RANK: Partial<Record<SalesStage, number>> = { lead: 0, contact: 1, proposal: 2, bidding: 3, won: 4 };
/** 도달 단계가 stage 이상인지 — Salesboard 목록 필터와 W4 가 같은 판정을 쓴다. */
export const reachedAtLeast = (p: SalesProject, stage: SalesStage) =>
  (RANK[p.reachedStage ?? (p.stage === "won" ? "won" : "lead")] ?? 0) >= (RANK[stage] ?? 0);
export const funnelLabel = (stage: SalesStage) => FUNNEL_STEPS.find((s) => s.stage === stage)?.label ?? stage;

const CATEGORY_UNSET = "unset"; // SalesBoard 업종분류 태그의 미분류 id 와 같아야 한다

// 금액 축약 — 1억 이상 '0.0억', 1만 이상 '0만', 그 밖 원
function won(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(n >= 1e9 ? 0 : 1)}억`;
  if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString()}만`;
  return `${n.toLocaleString()}원`;
}

const kstYear = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 4);
const outcomeYear = (p: SalesProject) => (p.outcomeAt ?? p.closedAt ?? p.openedAt ?? "").slice(0, 4);
const isActive = (p: SalesProject) => p.status !== "closed" && p.stage !== "won" && p.stage !== "lost";

interface UpcomingLike { projectId: string }
interface PendingLike { projectId: string; activities: unknown[] }

export function SalesInsightZone({
  projects,
  assignees,
  upcomingActs,
  pendingReports,
  loading,
  reachedFilter,
  onReached,
  categoryIds,
  onToggleCategory,
  owner,
  onOwner,
}: {
  projects: SalesProject[];
  assignees: SalesEmployeeOption[];
  upcomingActs: UpcomingLike[];
  pendingReports: PendingLike[];
  loading: boolean;
  reachedFilter: SalesStage | null;
  onReached: (stage: SalesStage) => void;
  categoryIds: string[];
  onToggleCategory: (id: string) => void;
  owner: string;
  onOwner: (employeeId: string) => void;
}) {
  return (
    <section className="mt-3" aria-label="영업 현황">
      {/* 카드 막대·행 공통 — 호버·포커스 툴팁(값 먼저, 이름 다음). 툴팁 내용은 화면 글자에도 모두 있다 */}
      <style>{`
        .si-row { position: relative; }
        .si-tip { display: none; position: absolute; z-index: 20; left: 8px; bottom: calc(100% + 4px); min-width: 160px; max-width: 280px;
          padding: 6px 8px; border-radius: 8px; border: 1px solid var(--cd-border); background: var(--cd-card); color: var(--cd-text);
          font-size: 12px; line-height: 1.45; pointer-events: none; white-space: normal; text-align: left; }
        .si-row:hover .si-tip, .si-row:focus-visible .si-tip { display: block; }
        .si-row[data-active="true"] { box-shadow: inset 0 0 0 1px var(--cd-primary); }
      `}</style>
      <div className="flex items-center gap-2 mb-2 px-1">
        <h2 className="cd-text text-sm font-extrabold">영업 현황</h2>
        <span className="cd-text-faint text-[11px]">보이는 영업건 전체 기준 · 막대·행을 누르면 목록이 좁혀집니다</span>
        <CdHelp topic="sales.insights" />
      </div>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-4" style={{ opacity: loading ? 0.5 : 1 }}>
        <FunnelCard projects={projects} active={reachedFilter} onPick={onReached} />
        <CategoryCard projects={projects} active={categoryIds} onToggle={onToggleCategory} />
        <OutcomeCard projects={projects} />
        <StaffCard
          projects={projects}
          assignees={assignees}
          upcomingActs={upcomingActs}
          pendingReports={pendingReports}
          owner={owner}
          onOwner={onOwner}
        />
      </div>
      <IntelSummaryCard />
    </section>
  );
}

function Card({ icon, title, caption, children }: { icon: ReactNode; title: string; caption: string; children: ReactNode }) {
  return (
    <div className="cd-card-bg rounded-2xl border cd-border-c p-3 flex flex-col min-w-0">
      <div className="flex items-center gap-2 mb-1">
        <span className="cd-text-muted shrink-0">{icon}</span>
        <h3 className="cd-text text-[13px] font-extrabold truncate">{title}</h3>
      </div>
      <p className="cd-text-faint text-[11px] mb-2 truncate" title={caption}>{caption}</p>
      {children}
    </div>
  );
}

// 가로 막대 한 줄 — 라벨 | 막대(트랙 위) + 끝 값. 막대 14px, 끝 4px 둥글게(기준선 쪽 각짐).
function BarRow({
  label,
  value,
  max,
  note,
  tip,
  active,
  onClick,
}: {
  label: string;
  value: number;
  max: number;
  note?: string;
  tip: ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  const pct = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  const body = (
    <>
      <span className="cd-text-muted text-[12px] truncate" style={{ width: 72, flex: "none" }}>{label}</span>
      <span className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="flex-1 min-w-0 relative" style={{ height: 14 }}>
          <span
            className="absolute left-0 top-0 h-full"
            style={{ width: `${pct}%`, background: "var(--cd-primary)", borderRadius: "0 4px 4px 0" }}
          />
        </span>
        <span className="cd-text text-[12px] font-bold shrink-0" style={{ minWidth: 20, textAlign: "right" }}>{value}</span>
      </span>
      <span className="cd-text-faint text-[11px] shrink-0 text-right" style={{ width: 40 }}>{note ?? ""}</span>
      <span className="si-tip" role="tooltip">{tip}</span>
    </>
  );
  const cls = "si-row w-full flex items-center gap-2 rounded-lg px-1.5 py-1";
  return onClick ? (
    <button type="button" className={`${cls} cd-row-hover text-left`} data-active={!!active} aria-pressed={!!active} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls} tabIndex={0}>{body}</div>
  );
}

// W4 파이프라인 퍼널 — 도달 단계 누적. 오른쪽 작은 글씨는 앞 단계 대비 전환율.
function FunnelCard({ projects, active, onPick }: { projects: SalesProject[]; active: SalesStage | null; onPick: (s: SalesStage) => void }) {
  const counts = FUNNEL_STEPS.map((s) => projects.filter((p) => reachedAtLeast(p, s.stage)).length);
  const total = counts[0] ?? 0;
  return (
    <Card icon={<Filter className="w-4 h-4" />} title="파이프라인 퍼널" caption="도달한 가장 높은 단계 기준 · 오른쪽은 전환율">
      <div className="flex flex-col gap-0.5">
        {FUNNEL_STEPS.map((s, i) => {
          const n = counts[i];
          const prev = i > 0 ? counts[i - 1] : null;
          const conv = prev != null && prev > 0 ? `${Math.round((n / prev) * 100)}%` : prev === 0 ? "—" : "";
          return (
            <BarRow
              key={s.stage}
              label={s.label}
              value={n}
              max={total}
              note={conv}
              active={active === s.stage}
              onClick={i === 0 ? undefined : () => onPick(s.stage)}
              tip={
                <>
                  <b>{n}건</b> {s.label}
                  {prev != null && <><br />앞 단계 {prev}건 중 {conv}</>}
                  {i > 0 && <><br />누르면 목록에 {s.label} 도달 건만</>}
                </>
              }
            />
          );
        })}
      </div>
    </Card>
  );
}

// W5 용역 분류 분포 — 4대 분류(+미분류) 막대, 아래 줄에 세분류 상위 3개. 누르면 왼쪽 업종분류 태그와 같은 필터.
function CategoryCard({ projects, active, onToggle }: { projects: SalesProject[]; active: string[]; onToggle: (id: string) => void }) {
  const rows = useMemo(() => {
    const cats = [...SALES_SERVICE_CATEGORIES.map((c) => ({ id: c.code as string, label: c.label as string })), { id: CATEGORY_UNSET, label: "미분류" }];
    return cats.map((c) => {
      const list = projects.filter((p) => (p.serviceCategory ?? CATEGORY_UNSET) === c.id);
      const sub = new Map<string, number>();
      for (const p of list) if (p.serviceSubcategory) sub.set(p.serviceSubcategory, (sub.get(p.serviceSubcategory) ?? 0) + 1);
      const subText = Array.from(sub.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([code, n]) => `${SALES_SUBCATEGORY_LABELS[code] ?? code} ${n}`);
      return { ...c, n: list.length, subText };
    });
  }, [projects]);
  const max = Math.max(0, ...rows.map((r) => r.n));
  const total = rows.reduce((s, r) => s + r.n, 0);
  return (
    <Card icon={<PieChart className="w-4 h-4" />} title="용역 분류 분포" caption="영업건의 용역 분류 · 오른쪽은 전체 대비 비율">
      <div className="flex flex-col gap-0.5">
        {rows.map((r) => (
          <div key={r.id} className="min-w-0">
            <BarRow
              label={r.label}
              value={r.n}
              max={max}
              note={total > 0 ? `${Math.round((r.n / total) * 100)}%` : ""}
              active={active.includes(r.id)}
              onClick={() => onToggle(r.id)}
              tip={
                <>
                  <b>{r.n}건</b> {r.label}
                  {r.subText.length > 0 && <><br />{r.subText.join(" · ")}</>}
                  <br />누르면 업종분류 태그 필터를 켜고 끕니다
                </>
              }
            />
            {r.subText.length > 0 && (
              <p className="cd-text-faint text-[11px] truncate" style={{ paddingLeft: 86 }} title={r.subText.join(" · ")}>
                {r.subText.slice(0, 3).join(" · ")}
              </p>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// W6 수주 성과 — 최근 3개 연도. 수주율 게이지(한 색: 채움 = 수주 비율, 트랙 = 같은 색 옅게) + 건수·금액 글자.
function OutcomeCard({ projects }: { projects: SalesProject[] }) {
  const y = Number(kstYear());
  const years = [y, y - 1, y - 2].map(String);
  const rows = years.map((yy) => {
    const done = projects.filter((p) => (p.stage === "won" || p.stage === "lost") && outcomeYear(p) === yy);
    const w = done.filter((p) => p.stage === "won");
    const sum = (arr: SalesProject[]) => arr.reduce((s, p) => s + (p.finalBidAmount ?? 0), 0);
    const priced = done.filter((p) => p.finalBidAmount != null).length;
    return {
      year: yy,
      won: w.length,
      lost: done.length - w.length,
      rate: done.length ? Math.round((w.length / done.length) * 100) : null,
      wonAmt: sum(w),
      bidAmt: sum(done),
      priced,
      total: done.length,
    };
  });
  return (
    <Card icon={<Trophy className="w-4 h-4" />} title="수주 성과" caption="결과 스케쥴 연도 기준 · 금액은 최종 투찰가(기록된 건만)">
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.year} className="si-row rounded-lg px-1.5 py-1" tabIndex={0}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="cd-text text-[12px] font-bold">{r.year}년</span>
              <span className="cd-text-muted text-[12px]">
                수주 <b className="cd-text">{r.won}</b> · 실주 <b className="cd-text">{r.lost}</b>
                <span className="cd-text ml-2 font-extrabold">{r.rate == null ? "—" : `${r.rate}%`}</span>
              </span>
            </div>
            <div
              className="mt-1 w-full"
              style={{ height: 8, borderRadius: 4, background: "color-mix(in srgb, var(--cd-primary) 16%, var(--cd-card))" }}
              role="meter"
              aria-label={`${r.year}년 수주율`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={r.rate ?? 0}
            >
              <div style={{ width: `${r.rate ?? 0}%`, height: "100%", borderRadius: 4, background: "var(--cd-primary)" }} />
            </div>
            <div className="cd-text-faint text-[11px] mt-1 truncate">
              {r.total === 0
                ? "결과 없음"
                : r.priced === 0
                  ? `투찰가 기록 없음 (${r.total}건)`
                  : `낙찰 ${won(r.wonAmt)} / 투찰 ${won(r.bidAmt)}${r.priced < r.total ? ` · 금액 기록 ${r.priced}/${r.total}건` : ""}`}
            </div>
            <span className="si-tip" role="tooltip">
              <b>{r.rate == null ? "—" : `${r.rate}%`}</b> {r.year}년 수주율
              <br />수주 {r.won}건 · 실주 {r.lost}건
              {r.total > 0 && <><br />낙찰 {r.wonAmt.toLocaleString()}원 / 투찰 {r.bidAmt.toLocaleString()}원</>}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

// W7 담당자 현황 — 영업 담당자(영업 제설정에서 지정)별 표. 담당 판정은 목록 담당 필터와 같다(담당자 또는 대표 멤버).
function StaffCard({
  projects,
  assignees,
  upcomingActs,
  pendingReports,
  owner,
  onOwner,
}: {
  projects: SalesProject[];
  assignees: SalesEmployeeOption[];
  upcomingActs: UpcomingLike[];
  pendingReports: PendingLike[];
  owner: string;
  onOwner: (id: string) => void;
}) {
  const year = kstYear();
  const rows = useMemo(() => {
    const upcomingBy = new Map<string, number>();
    for (const a of upcomingActs) upcomingBy.set(a.projectId, (upcomingBy.get(a.projectId) ?? 0) + 1);
    const pendingBy = new Map<string, number>();
    for (const r of pendingReports) pendingBy.set(r.projectId, (pendingBy.get(r.projectId) ?? 0) + (Array.isArray(r.activities) ? r.activities.length : 0));
    const mine = (e: string) => projects.filter((p) => p.ownerEmployeeId === e || p.leadMemberId === e);
    const sumBy = (list: SalesProject[], m: Map<string, number>) => list.reduce((s, p) => s + (m.get(p.projectId) ?? 0), 0);
    const out = assignees.map((e) => {
      const list = mine(e.employeeId);
      return {
        id: e.employeeId,
        name: e.name,
        dept: e.deptName ?? null,
        active: list.filter(isActive).length,
        upcoming: sumBy(list, upcomingBy),
        pending: sumBy(list, pendingBy),
        wonYear: list.filter((p) => p.stage === "won" && outcomeYear(p) === year).length,
      };
    });
    const unassigned = projects.filter((p) => !p.ownerEmployeeId && !p.leadMemberId);
    return {
      list: out.sort((a, b) => b.active - a.active || a.name.localeCompare(b.name, "ko")),
      unassigned: {
        active: unassigned.filter(isActive).length,
        upcoming: sumBy(unassigned, upcomingBy),
        pending: sumBy(unassigned, pendingBy),
        wonYear: unassigned.filter((p) => p.stage === "won" && outcomeYear(p) === year).length,
        total: unassigned.length,
      },
    };
  }, [projects, assignees, upcomingActs, pendingReports, year]);

  const thBase = "cd-text-faint text-[11px] font-bold px-1 py-1";
  const th = `${thBase} text-right`;
  const td = "cd-text text-[12px] text-right px-1 py-1 tabular-nums";
  return (
    <Card icon={<Users className="w-4 h-4" />} title="담당자 현황" caption={`진행 중 · 14일 일정 · 미보고 경과 · ${year}년 수주`}>
      {rows.list.length === 0 && rows.unassigned.total === 0 ? (
        <p className="cd-text-faint text-[12px] py-2">영업 담당자가 지정되지 않았습니다.</p>
      ) : (
        <div className="overflow-y-auto" style={{ maxHeight: 186 }}>
          <table className="w-full" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th className={`${thBase} text-left`}>담당</th>
                <th className={th}>진행</th>
                <th className={th}>일정</th>
                <th className={th}>미보고</th>
                <th className={th}>수주</th>
              </tr>
            </thead>
            <tbody>
              {rows.list.map((r) => {
                const on = owner === r.id;
                return (
                  <tr
                    key={r.id}
                    className="cd-row-hover cursor-pointer"
                    style={on ? { boxShadow: "inset 0 0 0 1px var(--cd-primary)" } : undefined}
                    tabIndex={0}
                    aria-selected={on}
                    title={`${r.name} 담당 영업건만 목록에 보기`}
                    onClick={() => onOwner(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOwner(r.id); }
                    }}
                  >
                    <td className="cd-text text-[12px] px-1 py-1 truncate" style={{ maxWidth: 110 }}>
                      {r.name}
                      {r.dept && <span className="cd-text-faint text-[11px]"> {r.dept}</span>}
                    </td>
                    <td className={td}>{r.active}</td>
                    <td className={td}>{r.upcoming}</td>
                    <td className={td} style={r.pending > 0 ? { fontWeight: 800 } : undefined}>{r.pending}</td>
                    <td className={td}>{r.wonYear}</td>
                  </tr>
                );
              })}
              {rows.unassigned.total > 0 && (
                <tr>
                  <td className="cd-text-faint text-[12px] px-1 py-1">미지정</td>
                  <td className={td}>{rows.unassigned.active}</td>
                  <td className={td}>{rows.unassigned.upcoming}</td>
                  <td className={td}>{rows.unassigned.pending}</td>
                  <td className={td}>{rows.unassigned.wonYear}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// W8 인텔·AI 브리핑 요약 — 최근 7일 수집 신호(등급별)와 최근 브리핑 1건. 상세는 API & 스크래핑·RAG 화면.
interface IntelSummary {
  collected: number;
  adopted: number;
  byGrade: Record<string, number>;
}
interface BriefingSummary {
  question: string;
  createdAt: string;
}

function IntelSummaryCard() {
  const [intel, setIntel] = useState<IntelSummary | null>(null);
  const [intelErr, setIntelErr] = useState(false);
  const [brief, setBrief] = useState<BriefingSummary | null | undefined>(undefined);

  useEffect(() => {
    const today = new Date(Date.now() + 9 * 3600000);
    const to = today.toISOString().slice(0, 10);
    const from = new Date(today.getTime() - 6 * 86400000).toISOString().slice(0, 10);
    fetch(`/api/sales/intel/stats?from=${from}&to=${to}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        const byGrade: Record<string, number> = {};
        for (const row of Array.isArray(d.breakdown) ? d.breakdown : []) {
          const g = String(row.grade ?? "");
          if (g) byGrade[g] = (byGrade[g] ?? 0) + Number(row.count ?? 0);
        }
        setIntel({ collected: Number(d.total?.collected ?? 0), adopted: Number(d.total?.adopted ?? 0), byGrade });
      })
      .catch(() => setIntelErr(true));
    fetch("/api/sales/rag/briefings?limit=1", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { briefings: [] }))
      .then((d) => {
        const b = Array.isArray(d.briefings) ? d.briefings[0] : null;
        setBrief(b ? { question: String(b.question ?? ""), createdAt: String(b.createdAt ?? "") } : null);
      })
      .catch(() => setBrief(null));
  }, []);

  const n = (k: string) => intel?.byGrade[k] ?? 0;
  return (
    <div className="cd-card-bg rounded-2xl border cd-border-c px-3 py-2.5 mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
      <Link href="/sales/intel" className="cd-row-hover cd-action rounded-lg px-1.5 py-1 flex items-center gap-2 min-w-0">
        <Radar className="w-4 h-4 cd-text-muted shrink-0" />
        <span className="cd-text text-[13px] font-extrabold shrink-0">투자·발주 인텔</span>
        <span className="cd-text-muted text-[12px] truncate">
          {intelErr
            ? "불러오지 못했습니다"
            : intel == null
              ? "불러오는 중…"
              : `최근 7일 수집 ${intel.collected} · 채택 ${intel.adopted} · 확정 ${n("confirmed")} · 후보 ${n("candidate")} · 관찰 ${n("monitoring")}`}
        </span>
      </Link>
      <Link href="/sales/rag" className="cd-row-hover cd-action rounded-lg px-1.5 py-1 flex items-center gap-2 min-w-0 flex-1">
        <Bot className="w-4 h-4 cd-text-muted shrink-0" />
        <span className="cd-text text-[13px] font-extrabold shrink-0">최근 AI 브리핑</span>
        <span className="cd-text-muted text-[12px] truncate" title={brief?.question}>
          {brief === undefined ? "불러오는 중…" : brief == null ? "아직 만든 브리핑이 없습니다" : brief.question}
        </span>
        {brief && <span className="cd-text-faint text-[11px] shrink-0">{brief.createdAt.slice(0, 10)}</span>}
      </Link>
    </div>
  );
}
