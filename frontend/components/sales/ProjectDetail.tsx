"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Building2, CheckCircle2, Plus, Trash2, UserPlus, UserRound, Users, X,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdThemeToggle } from "@/components/cdash/CdThemeToggle";
import { SalesCalendar } from "./SalesCalendar";
import { ScheduleModal } from "./ScheduleModal";
import type { OrganizationSnapshot } from "@/components/admin/users/types";
import "@/components/cdash/cdash.css";
import {
  ACTIVITY_TYPE_META,
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
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
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

  // 관계자 선택용 직원 목록 + 담당인력 조직도 스냅샷(1회)
  useEffect(() => {
    fetch("/api/sales/employees", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { employees: [] }))
      .then((d) => setEmployees(Array.isArray(d.employees) ? d.employees : []))
      .catch(() => {});
    fetch("/api/sales/org", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setSnapshot(d && Array.isArray(d.departments) ? d : null))
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

      {/* 본문 2열 — 좌: 영업 스케쥴/사업장정보/진행상황, 우: 영업활동 이력/담당자 */}
      <div className="flex flex-col lg:flex-row gap-3">
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <SalesCalendar
            activities={activities}
            canEdit={canEdit}
            onPickDate={(iso) => { setEditing(null); setAddDate(iso); setAdding(true); }}
            onEditActivity={(a) => { setAddDate(null); setEditing(a); }}
          />
          <PlaceholderCard title="사업장 정보" note="일반현황 · 시설현황 · 발주정보 · 과거이력 (추후 구현)" />
          <PlaceholderCard title="영업활동 진행상황" note="진행 단계 · 활동 집계 · 투찰 정보 (추후 구현)" />
        </div>

        <div className="lg:w-[500px] shrink-0 flex flex-col gap-3">
          {/* 영업활동 이력 */}
          <div className="cd-card-bg rounded-2xl border cd-border-c p-3">
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
              <h2 className="cd-text font-extrabold text-sm">영업활동 이력</h2>
              <div className="flex items-center gap-1.5">
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
                  <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={() => { setEditing(null); setAddDate(null); setAdding(true); }}>
                    <Plus className="w-4 h-4" /> 추가
                  </button>
                )}
              </div>
            </div>
            <Timeline activities={activities} canEdit={canEdit} onEdit={setEditing} onReload={reload} />
          </div>

          {/* 담당자 */}
          <div className="cd-card-bg rounded-2xl border cd-border-c p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="cd-text font-extrabold text-sm flex items-center gap-1"><Users className="w-4 h-4" /> 담당자</h2>
              {canEdit && (
                <button className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => setMemberOpen(true)}>
                  <UserPlus className="w-4 h-4" /> 관계자 관리
                </button>
              )}
            </div>
            <div className="cd-text-faint text-[11px] font-bold mb-1">프로젝트 담당자</div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(project.members ?? []).map((m) => (
                <span key={m.id} className="cd-pill cd-pill-outline">{m.employeeName ?? m.employeeId} · {m.roleLabel}</span>
              ))}
              {(project.members ?? []).length === 0 && <span className="cd-text-faint text-xs">등록된 관계자가 없습니다.</span>}
            </div>
            <div className="cd-text-faint text-[11px] font-bold mb-1">사업장 담당자</div>
            <div className="flex flex-wrap gap-1.5">
              {people.filter((p) => p.status === "active").map((p) => (
                <span key={p.id} className="cd-pill cd-pill-idle">{p.personName}{p.title ? ` ${p.title}` : ""}</span>
              ))}
              {people.filter((p) => p.status === "active").length === 0 && <span className="cd-text-faint text-xs">등록된 담당자가 없습니다.</span>}
            </div>
          </div>
        </div>
      </div>

      {(adding || editing) && (
        <ScheduleModal
          theme={theme}
          projectId={projectId}
          activity={editing}
          defaultDate={addDate}
          people={people}
          snapshot={snapshot}
          members={project.members ?? []}
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

function PlaceholderCard({ title, note }: { title: string; note: string }) {
  return (
    <div className="cd-card-bg rounded-2xl border cd-border-c p-4">
      <h3 className="cd-text font-extrabold text-sm mb-1">{title}</h3>
      <p className="cd-text-faint text-xs">{note}</p>
    </div>
  );
}

function fmtTimelineWhen(a: SalesActivity): string {
  const s = a.scheduledAt ?? a.occurredAt ?? a.createdAt;
  if (!s) return "";
  const sDate = `${s.slice(0, 10).replace(/-/g, ".")}.`;
  const sTime = s.slice(11, 16);
  const e = a.endedAt;
  if (e && e.slice(0, 10) !== s.slice(0, 10)) {
    return `${sDate} ~ ${e.slice(0, 10).replace(/-/g, ".")}.`;
  }
  const eTime = e ? e.slice(11, 16) : "";
  if (!sTime) return sDate;
  return `${sDate} ${sTime}${eTime ? ` ~ ${eTime}` : ""}`;
}

function TimelineRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-[13px]">
      <span className="cd-text-faint shrink-0 w-14">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
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
      <div className="absolute left-[7px] top-2 bottom-2 w-0.5" style={{ background: "var(--cd-border)" }} />
      <div className="flex flex-col gap-5">
        {activities.map((a) => {
          const meta = ACTIVITY_TYPE_META[a.activityType];
          const color = a.color ?? meta.color;
          const assignees = a.assignees ?? [];
          return (
            <div key={a.activityId} className="relative group">
              {/* 노드(이중원) */}
              <span
                className="absolute -left-6 top-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                style={{ background: `${color}55` }}
              >
                <span className="w-2 h-2 rounded-full" style={{ background: color }} />
              </span>

              {/* 제목 + 배지 */}
              <div className="flex items-center gap-2">
                <h3 className="cd-text font-extrabold text-sm">{meta.label}</h3>
                <span
                  className="text-[11px] font-bold rounded-full px-2 py-0.5"
                  style={{ background: color, color: "#1f2937" }}
                >
                  {meta.short}
                </span>
                {canEdit && (
                  <span className="ml-auto hidden group-hover:flex items-center gap-1">
                    <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => onEdit(a)}>수정</button>
                    <button className="cd-btn cd-btn-danger cd-btn-sm" onClick={() => del(a)}><Trash2 className="w-3.5 h-3.5" /></button>
                  </span>
                )}
              </div>
              <div className="cd-text-faint text-xs mt-0.5 mb-2">{fmtTimelineWhen(a)}</div>

              {/* 카드 */}
              <div className="cd-card-bg rounded-xl border cd-border-c p-3 flex flex-col gap-2">
                {assignees.length > 0 && (
                  <TimelineRow label="담당자">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      {assignees.map((as) => (
                        <span key={`${as.employeeId}-${as.roleKind}`} className="inline-flex items-center gap-1.5">
                          <span className="w-6 h-6 rounded-full flex items-center justify-center cd-surface-bg shrink-0">
                            <UserRound className="w-3.5 h-3.5 cd-text-muted" />
                          </span>
                          <span className="cd-text text-[13px]">{as.employeeName ?? as.employeeId}</span>
                        </span>
                      ))}
                    </div>
                  </TimelineRow>
                )}
                {a.summary && <TimelineRow label="업무상세"><span className="cd-text whitespace-pre-wrap">{a.summary}</span></TimelineRow>}
                {a.place && <TimelineRow label="장소"><span className="cd-text">{a.place}</span></TimelineRow>}
                {a.progressNote && <TimelineRow label="경과"><span className="cd-text font-bold">{a.progressNote}</span></TimelineRow>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const MEMBER_ROLES = ["정", "부", "지원"];

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
      else next.set(id, "정");
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
      <div className="cd-modal cd-card-bg w-full" style={{ maxWidth: 460, padding: "1.25rem", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
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
