"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase, ChevronDown, ChevronRight, LayoutGrid, List, Plus, Rows3, Search, SlidersHorizontal, X,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdThemeToggle } from "@/components/cdash/CdThemeToggle";
import "@/components/cdash/cdash.css";
import {
  SALES_STAGE_LABELS,
  SALES_STAGE_ORDER,
  type SalesEmployeeOption,
  type SalesProject,
  type SalesProjectPriority,
  type SalesStage,
} from "@/lib/sales/types";

const ACTIVE_STAGES: SalesStage[] = ["lead", "contact", "proposal", "bidding"];
const CLOSED_STAGES: SalesStage[] = ["won", "lost", "hold"];

const PRIORITY_LABELS: Record<SalesProjectPriority, string> = { low: "낮음", normal: "보통", high: "높음" };
const PRIORITY_DOT: Record<SalesProjectPriority, string> = {
  low: "var(--cd-faint)",
  normal: "var(--cd-secondary)",
  high: "var(--cd-error)",
};
const STAGE_PILL: Record<SalesStage, string> = {
  lead: "cd-pill-idle",
  contact: "cd-pill-info",
  proposal: "cd-pill-secondary",
  bidding: "cd-pill-warn",
  won: "cd-pill-success",
  lost: "cd-pill-error",
  hold: "cd-pill-outline",
};

type Density = "compact" | "detailed";

interface FacilityOption {
  facilityId: string;
  companyName: string;
}

export function SalesBoard() {
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as { role?: "admin" | "editor" | "viewer" } | undefined)?.role ?? "viewer";
  const canEdit = role === "admin" || role === "editor";
  const { theme, toggleTheme } = useCdashTheme();

  const [projects, setProjects] = useState<SalesProject[]>([]);
  const [employees, setEmployees] = useState<SalesEmployeeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // 뷰·밀도·필터
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [density, setDensity] = useState<Density>("compact");
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState("");
  const [priority, setPriority] = useState("");
  const [year, setYear] = useState("");
  const [showClosed, setShowClosed] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sales/projects", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      const data = await res.json();
      setProjects(Array.isArray(data.projects) ? data.projects : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    fetch("/api/sales/employees", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { employees: [] }))
      .then((d) => setEmployees(Array.isArray(d.employees) ? d.employees : []))
      .catch(() => {});
  }, []);

  const years = useMemo(
    () =>
      Array.from(new Set(projects.map((p) => (p.openedAt ?? "").slice(0, 4)).filter(Boolean)))
        .sort()
        .reverse(),
    [projects]
  );

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return projects.filter((p) => {
      if (s && !(p.title.toLowerCase().includes(s) || (p.facilityName ?? "").toLowerCase().includes(s))) return false;
      if (owner && p.ownerEmployeeId !== owner) return false;
      if (priority && p.priority !== priority) return false;
      if (year && (p.openedAt ?? "").slice(0, 4) !== year) return false;
      return true;
    });
  }, [projects, q, owner, priority, year]);

  const byStage = useMemo(() => {
    const map = new Map<SalesStage, SalesProject[]>();
    for (const s of SALES_STAGE_ORDER) map.set(s, []);
    for (const p of filtered) map.get(p.stage)?.push(p);
    return map;
  }, [filtered]);

  const closedTotal = CLOSED_STAGES.reduce((n, s) => n + (byStage.get(s)?.length ?? 0), 0);
  const hasFilter = !!(q || owner || priority || year);

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<Briefcase className="w-5 h-5" />}
        eyebrow="SALES & MARKETING"
        title="영업/마케팅"
        titleSuffix={`${filtered.length}건${hasFilter ? ` / ${projects.length}` : ""}`}
        subtitle="사업장별 영업건을 단계로 관리하고, 활동 이력·견적·입찰을 한 타임라인으로 추적합니다."
        actions={
          <>
            {canEdit && (
              <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={() => setCreating(true)}>
                <Plus className="w-4 h-4" /> 영업건 추가
              </button>
            )}
            <CdThemeToggle theme={theme} onToggle={toggleTheme} />
          </>
        }
      />

      {/* 툴바: 필터 + 뷰/밀도 토글 */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <div className="flex items-center gap-1.5">
          <Search className="w-4 h-4 cd-text-faint" />
          <input
            className="cd-input"
            style={{ width: 200 }}
            placeholder="제목·사업장 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <select className="cd-select" style={{ width: "auto" }} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">담당 전체</option>
          {employees.map((e) => (
            <option key={e.employeeId} value={e.employeeId}>{e.name}{e.deptName ? ` (${e.deptName})` : ""}</option>
          ))}
        </select>
        <select className="cd-select" style={{ width: "auto" }} value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">우선순위 전체</option>
          {(Object.keys(PRIORITY_LABELS) as SalesProjectPriority[]).map((p) => (
            <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
          ))}
        </select>
        {years.length > 0 && (
          <select className="cd-select" style={{ width: "auto" }} value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">연도 전체</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        )}
        {hasFilter && (
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => { setQ(""); setOwner(""); setPriority(""); setYear(""); }}>
            <X className="w-3.5 h-3.5" /> 초기화
          </button>
        )}

        <div className="flex-1" />

        {view === "kanban" && (
          <button
            className="cd-chip cd-chip-sm"
            onClick={() => setDensity((d) => (d === "compact" ? "detailed" : "compact"))}
            title="카드 밀도"
          >
            {density === "compact" ? <Rows3 className="w-3.5 h-3.5" /> : <SlidersHorizontal className="w-3.5 h-3.5" />}
            {density === "compact" ? "간략" : "상세"}
          </button>
        )}
        <div className="flex rounded-lg border cd-border-c overflow-hidden">
          <button
            className={`px-2.5 py-1.5 flex items-center gap-1 text-xs font-bold ${view === "kanban" ? "cd-fill-primary" : "cd-card-bg cd-text-muted"}`}
            onClick={() => setView("kanban")}
          >
            <LayoutGrid className="w-3.5 h-3.5" /> 칸반
          </button>
          <button
            className={`px-2.5 py-1.5 flex items-center gap-1 text-xs font-bold ${view === "list" ? "cd-fill-primary" : "cd-card-bg cd-text-muted"}`}
            onClick={() => setView("list")}
          >
            <List className="w-3.5 h-3.5" /> 리스트
          </button>
        </div>
      </div>

      {error && <div className="cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm mb-3">{error}</div>}

      {loading ? (
        <div className="cd-text-faint text-sm p-6">불러오는 중…</div>
      ) : view === "list" ? (
        <ListView projects={filtered} onRowClick={(id) => router.push(`/sales/${id}`)} />
      ) : (
        <>
          {/* 진행 단계 — 메인 칸반 */}
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
            {ACTIVE_STAGES.map((stage) => (
              <KanbanColumn
                key={stage}
                stage={stage}
                list={byStage.get(stage) ?? []}
                density={density}
                maxHeight="calc(100vh - 300px)"
                onCardClick={(id) => router.push(`/sales/${id}`)}
              />
            ))}
          </div>

          {/* 종결 — 접이식 */}
          <button
            className="flex items-center gap-2 mt-4 mb-2 cd-text-muted text-sm font-bold"
            onClick={() => setShowClosed((v) => !v)}
          >
            {showClosed ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            종결된 영업건
            <span className="cd-text-faint font-normal text-xs">
              수주 {byStage.get("won")?.length ?? 0} · 실주 {byStage.get("lost")?.length ?? 0} · 보류 {byStage.get("hold")?.length ?? 0}
            </span>
          </button>
          {showClosed && (
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              {CLOSED_STAGES.map((stage) => (
                <KanbanColumn
                  key={stage}
                  stage={stage}
                  list={byStage.get(stage) ?? []}
                  density={density}
                  maxHeight="360px"
                  onCardClick={(id) => router.push(`/sales/${id}`)}
                />
              ))}
            </div>
          )}
          {closedTotal === 0 && showClosed && (
            <div className="cd-text-faint text-xs px-1 py-2">종결된 영업건이 없습니다.</div>
          )}
        </>
      )}

      {creating && (
        <CreateProjectModal
          theme={theme}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            router.push(`/sales/${id}`);
          }}
        />
      )}
    </div>
  );
}

function KanbanColumn({
  stage,
  list,
  density,
  maxHeight,
  onCardClick,
}: {
  stage: SalesStage;
  list: SalesProject[];
  density: Density;
  maxHeight: string;
  onCardClick: (projectId: string) => void;
}) {
  return (
    <div className="cd-card-bg rounded-2xl border cd-border-c flex flex-col min-w-0" style={{ maxHeight }}>
      <div className="flex items-center justify-between px-3 py-2.5 border-b cd-border-c shrink-0">
        <span className={`cd-pill ${STAGE_PILL[stage]}`}>{SALES_STAGE_LABELS[stage]}</span>
        <span className="cd-text-faint text-xs font-bold">{list.length}</span>
      </div>
      <div className="flex flex-col gap-1.5 p-2 overflow-y-auto" style={{ minHeight: 80 }}>
        {list.map((p) => (
          <ProjectCard key={p.projectId} project={p} density={density} onClick={() => onCardClick(p.projectId)} />
        ))}
        {list.length === 0 && (
          <div className="flex-1 flex items-center justify-center rounded-xl border border-dashed cd-border-c cd-text-faint text-xs py-5">
            비어 있음
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectCard({ project: p, density, onClick }: { project: SalesProject; density: Density; onClick: () => void }) {
  if (density === "compact") {
    return (
      <button onClick={onClick} className="cd-surface-bg cd-listitem text-left rounded-lg border cd-border-c px-2.5 py-2 w-full min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: PRIORITY_DOT[p.priority] }} />
          <span className="cd-text font-bold text-[13px] truncate flex-1">{p.title}</span>
        </div>
        <div className="cd-text-faint text-[11px] truncate mt-0.5 pl-3">{p.facilityName ?? "사업장 미지정"}</div>
      </button>
    );
  }
  return (
    <button onClick={onClick} className="cd-surface-bg cd-listitem text-left rounded-xl border cd-border-c p-2.5 w-full min-w-0">
      <div className="flex items-start gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5" style={{ background: PRIORITY_DOT[p.priority] }} />
        <span className="cd-text font-bold text-sm leading-snug line-clamp-2 flex-1">{p.title}</span>
      </div>
      <div className="cd-text-muted text-xs mt-1 truncate pl-3">{p.facilityName ?? "사업장 미지정"}</div>
      <div className="flex items-center justify-between mt-2 gap-1 pl-3">
        <span className="cd-text-faint text-[11px] truncate">{p.ownerEmployeeName ?? "담당 미지정"}</span>
        {p.expectedAmount != null && (
          <span className="cd-text-primary text-[11px] font-bold shrink-0">{p.expectedAmount.toLocaleString()}원</span>
        )}
      </div>
    </button>
  );
}

function ListView({ projects, onRowClick }: { projects: SalesProject[]; onRowClick: (projectId: string) => void }) {
  if (projects.length === 0) {
    return <div className="cd-text-faint text-sm p-6 text-center cd-card-bg rounded-2xl border cd-border-c">표시할 영업건이 없습니다.</div>;
  }
  return (
    <div className="cd-card-bg rounded-2xl border cd-border-c overflow-hidden">
      <div className="overflow-x-auto" style={{ maxHeight: "calc(100vh - 260px)" }}>
        <table className="cd-table">
          <thead>
            <tr>
              <th>제목</th>
              <th>사업장</th>
              <th>단계</th>
              <th>담당</th>
              <th>우선순위</th>
              <th style={{ textAlign: "right" }}>예상 수주금액</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.projectId} className="cursor-pointer" onClick={() => onRowClick(p.projectId)}>
                <td className="cd-text font-bold">{p.title}</td>
                <td className="cd-text-muted">{p.facilityName ?? "—"}</td>
                <td><span className={`cd-pill ${STAGE_PILL[p.stage]}`}>{SALES_STAGE_LABELS[p.stage]}</span></td>
                <td className="cd-text-muted">{p.ownerEmployeeName ?? "—"}</td>
                <td>
                  <span className="inline-flex items-center gap-1 cd-text-muted">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: PRIORITY_DOT[p.priority] }} />
                    {PRIORITY_LABELS[p.priority]}
                  </span>
                </td>
                <td className="cd-text" style={{ textAlign: "right" }}>{p.expectedAmount != null ? `${p.expectedAmount.toLocaleString()}원` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CreateProjectModal({
  theme,
  onClose,
  onCreated,
}: {
  theme: string;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [stage, setStage] = useState<SalesStage>("lead");
  const [priority, setPriority] = useState<SalesProjectPriority>("normal");
  const [expected, setExpected] = useState("");
  const [memo, setMemo] = useState("");
  const [facility, setFacility] = useState<FacilityOption | null>(null);
  const [facilityQuery, setFacilityQuery] = useState("");
  const [facilityResults, setFacilityResults] = useState<FacilityOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (facility || !facilityQuery.trim()) {
      setFacilityResults([]);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/facilities?q=${encodeURIComponent(facilityQuery)}&limit=8`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        const items = (data.items ?? data.facilities ?? []) as Array<Record<string, unknown>>;
        setFacilityResults(
          items.map((it) => ({
            facilityId: String(it.facilityId ?? it.facility_id ?? ""),
            companyName: String(it.companyName ?? it.company_name ?? ""),
          })).filter((it) => it.facilityId)
        );
      } catch {
        setFacilityResults([]);
      }
    }, 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [facilityQuery, facility]);

  const submit = async () => {
    if (!facility || !title.trim()) {
      setErr("사업장과 제목은 필수입니다.");
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch("/api/sales/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facilityId: facility.facilityId,
          title: title.trim(),
          stage,
          priority,
          expectedAmount: expected ? Number(expected.replace(/[^0-9]/g, "")) : null,
          memo: memo.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onCreated(String(data.projectId));
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="cd-modal-overlay cdash cd-fields-white" data-theme={theme} onClick={onClose}>
      <div className="cd-modal cd-card-bg" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="cd-text text-lg font-extrabold">영업건 추가</h3>
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {err && <div className="cd-error-bg cd-error-text rounded-lg px-3 py-2 text-xs mb-3">{err}</div>}

        <label className="cd-label">사업장 *</label>
        {facility ? (
          <div className="flex items-center justify-between rounded-lg border cd-border-c px-3 py-2 mb-3">
            <span className="cd-text text-sm font-bold">{facility.companyName}</span>
            <button className="cd-text-faint" onClick={() => setFacility(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="relative mb-3">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 cd-text-faint shrink-0" />
              <input
                className="cd-input"
                placeholder="사업장명 검색"
                value={facilityQuery}
                onChange={(e) => setFacilityQuery(e.target.value)}
              />
            </div>
            {facilityResults.length > 0 && (
              <div className="cd-card-bg rounded-lg border cd-border-c mt-1 max-h-48 overflow-y-auto">
                {facilityResults.map((f) => (
                  <button
                    key={f.facilityId}
                    className="cd-row-hover w-full text-left px-3 py-2 cd-text text-sm"
                    onClick={() => {
                      setFacility(f);
                      setFacilityQuery("");
                    }}
                  >
                    {f.companyName}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <label className="cd-label">제목 *</label>
        <input className="cd-input mb-3" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 통합허가 갱신 영업" />

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="cd-label">단계</label>
            <select className="cd-select" value={stage} onChange={(e) => setStage(e.target.value as SalesStage)}>
              {SALES_STAGE_ORDER.map((s) => (
                <option key={s} value={s}>{SALES_STAGE_LABELS[s]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="cd-label">우선순위</label>
            <select className="cd-select" value={priority} onChange={(e) => setPriority(e.target.value as SalesProjectPriority)}>
              {(Object.keys(PRIORITY_LABELS) as SalesProjectPriority[]).map((p) => (
                <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
              ))}
            </select>
          </div>
        </div>

        <label className="cd-label">예상 수주금액(원)</label>
        <input className="cd-input mb-3" value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="예: 30000000" inputMode="numeric" />

        <label className="cd-label">메모</label>
        <textarea className="cd-textarea mb-4" rows={2} value={memo} onChange={(e) => setMemo(e.target.value)} />

        <div className="flex justify-end gap-2">
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>취소</button>
          <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={submit} disabled={saving}>
            {saving ? "저장 중…" : "생성"}
          </button>
        </div>
      </div>
    </div>
  );
}
