"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Building2, CalendarClock, CheckCircle2, CircleSlash, Phone, Plus,
  Receipt, Sparkles, Trash2, UserPlus, Users, X,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdThemeToggle } from "@/components/cdash/CdThemeToggle";
import { SalesCalendar } from "./SalesCalendar";
import "@/components/cdash/cdash.css";
import {
  SALES_ACTIVITY_TYPE_LABELS,
  SALES_STAGE_LABELS,
  SALES_STAGE_ORDER,
  type SalesActivity,
  type SalesActivityInput,
  type SalesActivityType,
  type SalesEmployeeOption,
  type SalesProject,
  type SalesProjectKpi,
  type SalesProjectMember,
  type SalesStage,
} from "@/lib/sales/types";

const KPI_TYPES: SalesActivityType[] = ["telemarketing", "visit", "meeting", "quote", "bid"];

interface FacilityPerson {
  id: number;
  personName: string;
  title: string | null;
  status: string;
}

export function ProjectDetail({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { data: session } = useSession();
  const role = (session?.user as { role?: "admin" | "editor" | "viewer" } | undefined)?.role ?? "viewer";
  const canEdit = role === "admin" || role === "editor";
  const { theme, toggleTheme } = useCdashTheme();

  const [project, setProject] = useState<SalesProject | null>(null);
  const [kpi, setKpi] = useState<SalesProjectKpi | null>(null);
  const [activities, setActivities] = useState<SalesActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SalesActivity | null>(null);
  const [adding, setAdding] = useState(false);
  const [employees, setEmployees] = useState<SalesEmployeeOption[]>([]);
  const [people, setPeople] = useState<FacilityPerson[]>([]);
  const [memberOpen, setMemberOpen] = useState(false);
  const [addDate, setAddDate] = useState<string | null>(null);

  // 타임라인 필터
  const [fType, setFType] = useState<SalesActivityType | "">("");
  const [fYear, setFYear] = useState<string>("");

  const loadProject = useCallback(async () => {
    const res = await fetch(`/api/sales/projects/${projectId}`, { cache: "no-store" });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
    const data = await res.json();
    setProject(data.project);
    setKpi(data.kpi);
  }, [projectId]);

  const loadActivities = useCallback(async () => {
    const params = new URLSearchParams();
    if (fType) params.set("activityType", fType);
    if (fYear) params.set("year", fYear);
    const res = await fetch(`/api/sales/projects/${projectId}/activities?${params}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    setActivities(Array.isArray(data.activities) ? data.activities : []);
  }, [projectId, fType, fYear]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadProject(), loadActivities()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [loadProject, loadActivities]);

  useEffect(() => {
    reload();
  }, [reload]);

  // 관계자 선택용 직원 목록(1회)
  useEffect(() => {
    fetch("/api/sales/employees", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { employees: [] }))
      .then((d) => setEmployees(Array.isArray(d.employees) ? d.employees : []))
      .catch(() => {});
  }, []);

  // 활동의 "만난 사람" 후보 = 해당 사업장 담당자(연락처 마스터)
  const facilityId = project?.facilityId;
  useEffect(() => {
    if (!facilityId) return;
    fetch(`/api/facilities/${facilityId}/contacts`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { people: [] }))
      .then((d) => setPeople(Array.isArray(d.people) ? d.people : []))
      .catch(() => {});
  }, [facilityId]);

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const a of activities) {
      const d = a.occurredAt ?? a.scheduledAt ?? a.createdAt;
      if (d) set.add(d.slice(0, 4));
    }
    return Array.from(set).sort().reverse();
  }, [activities]);

  const changeStage = async (stage: SalesStage) => {
    if (!project) return;
    setProject({ ...project, stage });
    await fetch(`/api/sales/projects/${projectId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...project, stage }),
    });
    loadProject().catch(() => {});
  };

  if (loading) return <div className="cdash p-6 cd-text-faint text-sm" data-theme={theme}>불러오는 중…</div>;
  if (error || !project) {
    return (
      <div className="cdash p-6" data-theme={theme}>
        <div className="cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm">{error ?? "프로젝트를 찾을 수 없습니다."}</div>
      </div>
    );
  }

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => router.push("/sales")}>
            <ArrowLeft className="w-4 h-4" /> 보드
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 cd-text-muted text-xs">
              <Building2 className="w-3.5 h-3.5" />
              <span className="truncate">{project.facilityName ?? "사업장 미지정"}</span>
            </div>
            <h1 className="cd-text text-xl font-extrabold tracking-tight truncate">{project.title}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="cd-select"
            style={{ width: "auto" }}
            value={project.stage}
            disabled={!canEdit}
            onChange={(e) => changeStage(e.target.value as SalesStage)}
          >
            {SALES_STAGE_ORDER.map((s) => (
              <option key={s} value={s}>{SALES_STAGE_LABELS[s]}</option>
            ))}
          </select>
          <CdThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </div>

      {/* KPI 스트립 — 파생 집계 */}
      {kpi && (
        <div className="flex gap-2 overflow-x-auto pb-1 mb-4">
          {KPI_TYPES.map((t) => (
            <KpiCard key={t} label={SALES_ACTIVITY_TYPE_LABELS[t]} value={kpi.activityCounts[t] ?? 0} icon={<Phone className="w-4 h-4" />} />
          ))}
          <KpiCard label="접촉 담당자" value={kpi.contactCount} icon={<Users className="w-4 h-4" />} />
          <KpiCard label="수주" value={kpi.isWon ? "수주" : "-"} icon={<CheckCircle2 className="w-4 h-4" />} highlight={kpi.isWon} />
          <KpiCard label="투자계획" value={kpi.hasInvestmentPlan ? "있음" : "—"} icon={<Sparkles className="w-4 h-4" />} muted={!kpi.hasInvestmentPlan} />
        </div>
      )}

      {/* 캘린더 — 예정/완료 활동 */}
      <SalesCalendar
        activities={activities}
        canEdit={canEdit}
        onPickDate={(iso) => { setEditing(null); setAddDate(iso); setAdding(true); }}
      />

      {/* 영업 관계자 */}
      <div className="cd-card-bg rounded-xl border cd-border-c p-3 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="cd-text font-extrabold text-sm flex items-center gap-1">
            <Users className="w-4 h-4" /> 영업 관계자
          </h2>
          {canEdit && (
            <button className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => setMemberOpen(true)}>
              <UserPlus className="w-4 h-4" /> 관계자 관리
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(project.members ?? []).map((m) => (
            <span key={m.id} className="cd-pill cd-pill-outline">
              {m.employeeName ?? m.employeeId} · {m.roleLabel}
            </span>
          ))}
          {(project.members ?? []).length === 0 && (
            <span className="cd-text-faint text-xs">등록된 관계자가 없습니다.</span>
          )}
        </div>
      </div>

      {/* 타임라인 헤더 + 필터 */}
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="cd-text font-extrabold text-sm">활동 타임라인</h2>
        <div className="flex items-center gap-2">
          <select className="cd-select cd-btn-sm" style={{ width: "auto" }} value={fYear} onChange={(e) => setFYear(e.target.value)}>
            <option value="">전체 연도</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="cd-select cd-btn-sm" style={{ width: "auto" }} value={fType} onChange={(e) => setFType(e.target.value as SalesActivityType | "")}>
            <option value="">전체 유형</option>
            {(Object.keys(SALES_ACTIVITY_TYPE_LABELS) as SalesActivityType[]).map((t) => (
              <option key={t} value={t}>{SALES_ACTIVITY_TYPE_LABELS[t]}</option>
            ))}
          </select>
          {canEdit && (
            <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={() => setAdding(true)}>
              <Plus className="w-4 h-4" /> 활동 추가
            </button>
          )}
        </div>
      </div>

      <Timeline activities={activities} canEdit={canEdit} onEdit={setEditing} onReload={reload} />

      {(adding || editing) && (
        <ActivityModal
          theme={theme}
          projectId={projectId}
          activity={editing}
          people={people}
          defaultWhen={addDate}
          onClose={() => { setAdding(false); setEditing(null); setAddDate(null); }}
          onSaved={() => { setAdding(false); setEditing(null); setAddDate(null); reload(); }}
        />
      )}

      {memberOpen && (
        <MemberModal
          theme={theme}
          projectId={projectId}
          employees={employees}
          current={project.members ?? []}
          onClose={() => setMemberOpen(false)}
          onSaved={() => { setMemberOpen(false); loadProject().catch(() => {}); }}
        />
      )}
    </div>
  );
}

function KpiCard({ label, value, icon, highlight, muted }: {
  label: string; value: string | number; icon: React.ReactNode; highlight?: boolean; muted?: boolean;
}) {
  return (
    <div className={`shrink-0 rounded-xl border cd-border-c px-3 py-2 min-w-[88px] ${highlight ? "cd-tint-primary" : "cd-card-bg"}`}>
      <div className={`flex items-center gap-1 text-[11px] font-bold ${muted ? "cd-text-faint" : "cd-text-muted"}`}>
        {icon}{label}
      </div>
      <div className={`text-lg font-extrabold mt-0.5 ${highlight ? "cd-text-primary" : "cd-text"}`}>{value}</div>
    </div>
  );
}

function Timeline({ activities, canEdit, onEdit, onReload }: {
  activities: SalesActivity[];
  canEdit: boolean;
  onEdit: (a: SalesActivity) => void;
  onReload: () => void;
}) {
  if (activities.length === 0) {
    return <div className="cd-text-faint text-sm p-6 text-center">등록된 활동이 없습니다.</div>;
  }
  const del = async (a: SalesActivity) => {
    if (!confirm("이 활동을 삭제할까요?")) return;
    await fetch(`/api/sales/activities/${a.activityId}`, { method: "DELETE" });
    onReload();
  };
  return (
    <div className="relative pl-6">
      <div className="absolute left-2 top-1 bottom-1 w-px" style={{ background: "var(--cd-border)" }} />
      <div className="flex flex-col gap-3">
        {activities.map((a) => {
          const when = a.occurredAt ?? a.scheduledAt ?? a.createdAt;
          const isPlanned = a.status === "planned";
          const isCanceled = a.status === "canceled";
          return (
            <div key={a.activityId} className="relative">
              <span
                className="absolute -left-[18px] top-2 w-3 h-3 rounded-full border-2"
                style={{
                  background: isCanceled ? "var(--cd-faint)" : isPlanned ? "var(--cd-primary)" : "var(--cd-success)",
                  borderColor: "var(--cd-card)",
                }}
              />
              <div className="cd-card-bg rounded-xl border cd-border-c p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`cd-pill ${isPlanned ? "cd-pill-info" : isCanceled ? "cd-pill-outline" : "cd-pill-success"}`}>
                      {SALES_ACTIVITY_TYPE_LABELS[a.activityType]}
                    </span>
                    {isPlanned && <span className="cd-text-primary text-[11px] font-bold flex items-center gap-1"><CalendarClock className="w-3 h-3" />예정</span>}
                    {isCanceled && <span className="cd-text-faint text-[11px] flex items-center gap-1"><CircleSlash className="w-3 h-3" />취소</span>}
                  </div>
                  <span className="cd-text-faint text-xs">{when ? when.slice(0, 16).replace("T", " ") : ""}</span>
                </div>
                {a.summary && <p className="cd-text text-sm mt-2 whitespace-pre-wrap">{a.summary}</p>}
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  {a.place && <span className="cd-text-muted text-xs">📍 {a.place}</span>}
                  {a.authorName && <span className="cd-text-faint text-xs">기록: {a.authorName}</span>}
                  {a.quoteAmount != null && <span className="cd-text-muted text-xs flex items-center gap-1"><Receipt className="w-3 h-3" />견적 {a.quoteAmount.toLocaleString()}원</span>}
                  {a.bidAmount != null && <span className="cd-text-muted text-xs">입찰 {a.bidAmount.toLocaleString()}원</span>}
                </div>
                {canEdit && (
                  <div className="flex justify-end gap-1 mt-2">
                    <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => onEdit(a)}>수정</button>
                    <button className="cd-btn cd-btn-danger cd-btn-sm" onClick={() => del(a)}><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActivityModal({ theme, projectId, activity, people, defaultWhen, onClose, onSaved }: {
  theme: string;
  projectId: string;
  activity: SalesActivity | null;
  people: FacilityPerson[];
  defaultWhen?: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editingExisting = !!activity;
  const [type, setType] = useState<SalesActivityType>(activity?.activityType ?? "meeting");
  const [planned, setPlanned] = useState(activity ? activity.status === "planned" : !!defaultWhen);
  const [when, setWhen] = useState(
    activity ? (activity.occurredAt ?? activity.scheduledAt ?? "").slice(0, 16) : defaultWhen ? `${defaultWhen}T09:00` : ""
  );
  const [place, setPlace] = useState(activity?.place ?? "");
  const [summary, setSummary] = useState(activity?.summary ?? "");
  const [quote, setQuote] = useState(activity?.quoteAmount != null ? String(activity.quoteAmount) : "");
  const [bid, setBid] = useState(activity?.bidAmount != null ? String(activity.bidAmount) : "");
  const [selectedPersons, setSelectedPersons] = useState<number[]>(activity?.contacts?.map((c) => c.personId) ?? []);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setErr(null);
    const body: SalesActivityInput = {
      activityType: type,
      status: planned ? "planned" : "done",
      scheduledAt: planned ? (when || null) : null,
      occurredAt: planned ? null : (when || null),
      place: place.trim() || null,
      summary: summary.trim() || null,
      quoteAmount: quote ? Number(quote.replace(/[^0-9]/g, "")) : null,
      bidAmount: bid ? Number(bid.replace(/[^0-9]/g, "")) : null,
      contactPersonIds: selectedPersons,
    };
    try {
      const url = editingExisting
        ? `/api/sales/activities/${activity!.activityId}`
        : `/api/sales/projects/${projectId}/activities`;
      const res = await fetch(url, {
        method: editingExisting ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  };

  return (
    <div className="cd-modal-overlay cdash cd-fields-white" data-theme={theme} onClick={onClose}>
      <div className="cd-modal cd-card-bg" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="cd-text text-lg font-extrabold">{editingExisting ? "활동 수정" : "활동 추가"}</h3>
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        {err && <div className="cd-error-bg cd-error-text rounded-lg px-3 py-2 text-xs mb-3">{err}</div>}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="cd-label">유형</label>
            <select className="cd-select" value={type} onChange={(e) => setType(e.target.value as SalesActivityType)}>
              {(Object.keys(SALES_ACTIVITY_TYPE_LABELS) as SalesActivityType[]).map((t) => (
                <option key={t} value={t}>{SALES_ACTIVITY_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="cd-label">구분</label>
            <select className="cd-select" value={planned ? "planned" : "done"} onChange={(e) => setPlanned(e.target.value === "planned")}>
              <option value="done">완료</option>
              <option value="planned">예정</option>
            </select>
          </div>
        </div>

        <label className="cd-label">{planned ? "예정 일시" : "발생 일시"}</label>
        <input type="datetime-local" className="cd-input mb-3" value={when} onChange={(e) => setWhen(e.target.value)} />

        <label className="cd-label">장소</label>
        <input className="cd-input mb-3" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="어디서 만났는지" />

        <label className="cd-label">내용</label>
        <textarea className="cd-textarea mb-3" rows={3} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="무슨 얘기를 나눴는지" />

        {people.filter((p) => p.status === "active").length > 0 && (
          <div className="mb-3">
            <label className="cd-label">만난 담당자</label>
            <div className="flex flex-wrap gap-1.5">
              {people.filter((p) => p.status === "active").map((p) => {
                const on = selectedPersons.includes(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className="cd-chip cd-chip-sm"
                    data-active={on}
                    onClick={() => setSelectedPersons((prev) => (on ? prev.filter((x) => x !== p.id) : [...prev, p.id]))}
                  >
                    {p.personName}{p.title ? ` ${p.title}` : ""}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="cd-label">견적가(원)</label>
            <input className="cd-input" value={quote} onChange={(e) => setQuote(e.target.value)} inputMode="numeric" />
          </div>
          <div>
            <label className="cd-label">입찰가(원)</label>
            <input className="cd-input" value={bid} onChange={(e) => setBid(e.target.value)} inputMode="numeric" />
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>취소</button>
          <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={submit} disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

const MEMBER_ROLES = ["담당", "임원", "부서장", "지원"];

function MemberModal({ theme, projectId, employees, current, onClose, onSaved }: {
  theme: string;
  projectId: string;
  employees: SalesEmployeeOption[];
  current: SalesProjectMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sel, setSel] = useState<Map<string, string>>(new Map(current.map((m) => [m.employeeId, m.roleLabel])));
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = employees.filter(
    (e) => !q.trim() || e.name.includes(q.trim()) || (e.deptName ?? "").includes(q.trim())
  );

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, "담당");
      return next;
    });

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/sales/projects/${projectId}/members`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          members: Array.from(sel.entries()).map(([employeeId, roleLabel]) => ({ employeeId, roleLabel })),
        }),
      });
      onSaved();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="cd-modal-overlay cdash cd-fields-white" data-theme={theme} onClick={onClose}>
      <div className="cd-modal cd-card-bg" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="cd-text text-lg font-extrabold">영업 관계자 관리</h3>
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        <input className="cd-input mb-3" placeholder="이름·부서 검색" value={q} onChange={(e) => setQ(e.target.value)} />

        <div className="rounded-lg border cd-border-c max-h-72 overflow-y-auto mb-4">
          {filtered.map((e) => {
            const on = sel.has(e.employeeId);
            return (
              <div key={e.employeeId} className="flex items-center justify-between gap-2 px-3 py-2 border-b cd-border-c last:border-0">
                <button type="button" className="flex items-center gap-2 text-left min-w-0" onClick={() => toggle(e.employeeId)}>
                  <span
                    className="w-4 h-4 rounded border shrink-0 flex items-center justify-center"
                    style={{ borderColor: "var(--cd-border)", background: on ? "var(--cd-primary)" : "transparent" }}
                  >
                    {on && <CheckCircle2 className="w-3 h-3 text-white" />}
                  </span>
                  <span className="min-w-0">
                    <span className="cd-text text-sm font-bold">{e.name}</span>
                    <span className="cd-text-faint text-xs ml-1">{e.deptName ?? ""} {e.positionName ?? ""}</span>
                  </span>
                </button>
                {on && (
                  <select
                    className="cd-select"
                    style={{ width: "auto" }}
                    value={sel.get(e.employeeId)}
                    onChange={(ev) => setSel((prev) => new Map(prev).set(e.employeeId, ev.target.value))}
                  >
                    {MEMBER_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <div className="cd-text-faint text-xs px-3 py-4">검색 결과 없음</div>}
        </div>

        <div className="flex justify-end gap-2">
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>취소</button>
          <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={save} disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
