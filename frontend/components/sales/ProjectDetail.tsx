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
import { SalesProgressCard } from "./SalesProgressCard";
import { ScheduleModal } from "./ScheduleModal";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationEmployeeRow, OrganizationSnapshot } from "@/components/admin/users/types";
import { filterAssigneeTree } from "@/lib/sales/org-tree";
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
  departmentId: number | null;
  personName: string;
  title: string | null;
  officePhone: string | null;
  mobilePhone: string | null;
  email: string | null;
  duties: string | null;
  status: string;
  deptType: string | null;
  appointedAt: string | null;
  transferredAt: string | null;
  resignedAt: string | null;
}

const MEMBER_ROLE_PILL: Record<string, string> = {
  정: "cd-pill-info",
  부: "cd-pill-success",
  입찰: "cd-pill-warn",
};
const MEMBER_ROLE_ORDER: Record<string, number> = { 정: 0, 부: 1, 입찰: 2, 지원: 3 };

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
  const [departments, setDepartments] = useState<{ id: number; departmentName: string }[]>([]);
  const [memberOpen, setMemberOpen] = useState(false);
  const [siteContactOpen, setSiteContactOpen] = useState(false);
  const [selectedSite, setSelectedSite] = useState<FacilityPerson | null>(null);
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

  // 활동의 "만난 사람" 후보 + 사업장 담당자 = 해당 사업장 연락처 마스터
  const facilityId = project?.facilityId;
  const reloadPeople = useCallback(() => {
    if (!facilityId) return;
    fetch(`/api/facilities/${facilityId}/contacts`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { people: [], departments: [] }))
      .then((d) => {
        setPeople(Array.isArray(d.people) ? d.people : []);
        setDepartments(Array.isArray(d.departments) ? d.departments : []);
      })
      .catch(() => {});
  }, [facilityId]);
  useEffect(() => { reloadPeople(); }, [reloadPeople]);

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
      <div className="flex flex-col lg:flex-row gap-3 lg:items-stretch">
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <SalesCalendar
            activities={activities}
            canEdit={canEdit}
            onPickDate={(iso) => { setEditing(null); setAddDate(iso); setAdding(true); }}
            onEditActivity={(a) => { setAddDate(null); setEditing(a); }}
          />
          <PlaceholderCard title="사업장 정보" note="일반현황 · 시설현황 · 발주정보 · 과거이력 (추후 구현)" />
          <SalesProgressCard project={project} activities={activities} />
        </div>

        <div className="lg:w-[640px] shrink-0 flex flex-col gap-3">
          {/* 영업활동 이력 — 고정 높이 + 세로 스크롤(스크롤바 숨김) */}
          <div className="cd-card-bg rounded-2xl border cd-border-c p-3 flex flex-col shrink-0" style={{ height: 800 }}>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-3 shrink-0">
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
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide pt-1">
              <Timeline activities={activities} canEdit={canEdit} onEdit={setEditing} onReload={reload} />
            </div>
          </div>

          {/* 담당자 — 좌: 프로젝트 / 우: 사업장 */}
          <div className="cd-card-bg rounded-2xl border cd-border-c p-3 flex-1 min-h-0 flex flex-col lg:flex-row gap-3">
            {/* 프로젝트 담당자 */}
            <div className="flex-1 min-w-0 flex flex-col">
              <h2 className="cd-text font-extrabold text-sm flex items-center gap-1 mb-2"><Users className="w-4 h-4" /> 프로젝트 담당자</h2>
              <div className="flex flex-col gap-2 flex-1 overflow-y-auto scrollbar-hide">
                {[...(project.members ?? [])]
                  .sort((a, b) => (MEMBER_ROLE_ORDER[a.roleLabel] ?? 9) - (MEMBER_ROLE_ORDER[b.roleLabel] ?? 9))
                  .map((m) => (
                    <div key={m.id} className="flex items-center gap-2">
                      <span className={`cd-pill ${MEMBER_ROLE_PILL[m.roleLabel] ?? "cd-pill-idle"} shrink-0`} style={{ minWidth: 40, justifyContent: "center" }}>{m.roleLabel}</span>
                      <Avatar src={m.photoPath} size={28} />
                      <span className="cd-text text-sm font-bold">{m.employeeName ?? m.employeeId}</span>
                      {m.positionName && <span className="cd-text-faint text-xs">{m.positionName}</span>}
                    </div>
                  ))}
                {(project.members ?? []).length === 0 && <span className="cd-text-faint text-xs">등록된 담당자가 없습니다.</span>}
              </div>
              {canEdit && (
                <button className="cd-btn cd-btn-soft cd-btn-sm mt-3 self-start" onClick={() => setMemberOpen(true)}><UserPlus className="w-4 h-4" /> 담당자 설정</button>
              )}
            </div>

            <div className="shrink-0 self-stretch" style={{ width: 1, background: "var(--cd-border)" }} />

            {/* 사업장 담당자 */}
            <div className="flex-1 min-w-0 flex flex-col">
              <h2 className="cd-text font-extrabold text-sm flex items-center gap-1 mb-2"><Building2 className="w-4 h-4" /> 사업장 담당자</h2>
              <div className="flex flex-col gap-1.5 overflow-y-auto scrollbar-hide">
                {people.filter((p) => p.deptType && p.status === "active").map((p) => {
                  const on = selectedSite?.id === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedSite(on ? null : p)}
                      className="flex items-center gap-2 text-left rounded-lg px-1.5 py-1 cd-row-hover"
                      data-active={on}
                    >
                      <span className={`cd-pill ${p.deptType === "contract" ? "cd-pill-warn" : "cd-pill-success"} shrink-0`} style={{ minWidth: 56, justifyContent: "center" }}>
                        {p.deptType === "contract" ? "계약부서" : "환경부서"}
                      </span>
                      <span className="cd-text text-sm font-bold">{p.personName}</span>
                      {p.title && <span className="cd-text-faint text-xs">{p.title}</span>}
                    </button>
                  );
                })}
                {people.filter((p) => p.deptType && p.status === "active").length === 0 && <span className="cd-text-faint text-xs">등록된 담당자가 없습니다.</span>}
              </div>

              {selectedSite && (
                <div className="rounded-xl border cd-border-c p-3 mt-2 text-[13px] flex flex-col gap-1.5">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                    <div className="flex gap-2 min-w-0"><span className="cd-text-faint w-10 shrink-0">성명</span><span className="cd-text font-bold truncate">{selectedSite.personName}</span></div>
                    <div className="flex gap-2 min-w-0"><span className="cd-text-faint w-10 shrink-0">부서</span><span className="cd-text truncate">{departments.find((d) => d.id === selectedSite.departmentId)?.departmentName ?? (selectedSite.deptType === "contract" ? "계약부서" : "환경부서")}</span></div>
                    <div className="flex gap-2 min-w-0"><span className="cd-text-faint w-10 shrink-0">직급</span><span className="cd-text truncate">{selectedSite.title ?? "—"}</span></div>
                    <div className="flex gap-2 min-w-0"><span className="cd-text-faint w-10 shrink-0">전화</span><span className="cd-text truncate">{selectedSite.mobilePhone ?? selectedSite.officePhone ?? "—"}</span></div>
                  </div>
                  <div className="flex gap-2"><span className="cd-text-faint w-10 shrink-0">메일</span><span className="cd-text break-all">{selectedSite.email ?? "—"}</span></div>
                  <div className="flex gap-2"><span className="cd-text-faint w-10 shrink-0">업무</span><span className="cd-text">{selectedSite.duties ?? "—"}</span></div>
                </div>
              )}

              <div className="flex-1" />
              {canEdit && (
                <button className="cd-btn cd-btn-soft cd-btn-sm mt-3 self-start" onClick={() => setSiteContactOpen(true)}><UserPlus className="w-4 h-4" /> 담당자 설정</button>
              )}
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
          snapshot={snapshot}
          current={project.members ?? []}
          onClose={() => setMemberOpen(false)}
          onSaved={() => { setMemberOpen(false); loadProject().catch(() => {}); }}
        />
      )}

      {siteContactOpen && project.facilityId && (
        <SiteContactModal
          theme={theme}
          facilityId={project.facilityId}
          onClose={() => setSiteContactOpen(false)}
          onSaved={() => { setSiteContactOpen(false); reloadPeople(); }}
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

function Avatar({ src, size = 24 }: { src?: string | null; size?: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <span className="rounded-full flex items-center justify-center cd-surface-bg shrink-0" style={{ width: size, height: size }}>
      <UserRound className="cd-text-muted" style={{ width: size * 0.58, height: size * 0.58 }} />
    </span>
  );
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
          // 담당자 = 해당 스케쥴의 수행자(행위자, attendee)만. 프로젝트 담당자(정/부/입찰) 상속분은 제외.
          const actors = (a.assignees ?? []).filter((x) => x.roleKind === "attendee");
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
                {actors.length > 0 && (
                  <TimelineRow label="담당자">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      {actors.map((as) => (
                        <span key={`${as.employeeId}-${as.roleKind}`} className="inline-flex items-center gap-1.5">
                          <Avatar src={as.photoPath} size={24} />
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

const MEMBER_ROLES = ["정", "부", "입찰"];

function MemberModal({ theme, projectId, snapshot, current, onClose, onSaved }: {
  theme: string;
  projectId: string;
  snapshot: OrganizationSnapshot | null;
  current: SalesProjectMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [picks, setPicks] = useState<{ employeeId: string; name: string; role: string }[]>(
    current.map((m) => ({ employeeId: m.employeeId, name: m.employeeName ?? m.employeeId, role: m.roleLabel }))
  );
  const [activeRole, setActiveRole] = useState("정");
  const [saving, setSaving] = useState(false);
  const treeSnapshot = useMemo(() => filterAssigneeTree(snapshot), [snapshot]);

  const toggle = (emp: OrganizationEmployeeRow) =>
    setPicks((prev) => {
      const ex = prev.find((p) => p.employeeId === emp.employeeId && p.role === activeRole);
      if (ex) return prev.filter((p) => !(p.employeeId === emp.employeeId && p.role === activeRole));
      return [...prev, { employeeId: emp.employeeId, name: emp.name, role: activeRole }];
    });

  const save = async () => {
    setSaving(true);
    try {
      await fetch(`/api/sales/projects/${projectId}/members`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ members: picks.map((p) => ({ employeeId: p.employeeId, roleLabel: p.role })) }),
      });
      onSaved();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="cd-modal-overlay cdash cd-fields-white" data-theme={theme} onClick={onClose}>
      <div className="cd-modal cd-card-bg w-full" style={{ maxWidth: 520, padding: "1.25rem", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="cd-text text-lg font-extrabold">프로젝트 담당자 설정</h3>
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <label className="cd-label">역할</label>
        <div className="flex gap-1.5 mb-2">
          {MEMBER_ROLES.map((r) => (
            <button key={r} type="button" className="cd-chip cd-chip-sm" data-active={activeRole === r} onClick={() => setActiveRole(r)}>{r}</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 mb-2">
          {picks.map((p) => (
            <span key={`${p.employeeId}-${p.role}`} className="cd-pill cd-pill-info inline-flex items-center gap-1">
              {p.role}·{p.name}
              <button onClick={() => setPicks((prev) => prev.filter((x) => !(x.employeeId === p.employeeId && x.role === p.role)))}><X className="w-3 h-3" /></button>
            </span>
          ))}
          {picks.length === 0 && <span className="cd-text-faint text-xs">역할 선택 후 조직도에서 인원을 클릭하세요.</span>}
        </div>
        <OrganizationTree snapshot={treeSnapshot} embedded title="조직도" onSelectEmployee={toggle} />
        <div className="flex justify-end gap-2 mt-4">
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>취소</button>
          <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={save} disabled={saving}>{saving ? "저장 중…" : "저장"}</button>
        </div>
      </div>
    </div>
  );
}

interface SitePersonEdit {
  id: number | null;
  deptType: string;
  personName: string;
  departmentId: number | null;
  title: string;
  officePhone: string;
  mobilePhone: string;
  email: string;
  duties: string;
  appointedAt: string;
  transferredAt: string;
  resignedAt: string;
}

const SITE_DEPT_TYPES = [
  { v: "contract", l: "계약부서" },
  { v: "env", l: "환경부서" },
];

function SiteContactModal({ theme, facilityId, onClose, onSaved }: {
  theme: string;
  facilityId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loaded, setLoaded] = useState<{ mainNumber: unknown; departments: unknown; logs: unknown; people: FacilityPerson[] } | null>(null);
  const [depts, setDepts] = useState<{ id: number; departmentName: string }[]>([]);
  const [rows, setRows] = useState<SitePersonEdit[]>([]);
  const [newDeptName, setNewDeptName] = useState("");
  const [saving, setSaving] = useState(false);

  const addDept = () => {
    const n = newDeptName.trim();
    if (!n) return;
    setDepts((ds) => [...ds, { id: -Date.now(), departmentName: n }]);
    setNewDeptName("");
  };

  useEffect(() => {
    fetch(`/api/facilities/${facilityId}/contacts`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setLoaded(d);
        setDepts(Array.isArray(d.departments) ? d.departments : []);
        setRows(
          (Array.isArray(d.people) ? d.people : [])
            .filter((p: FacilityPerson) => p.deptType)
            .map((p: FacilityPerson) => ({
              id: p.id, deptType: p.deptType ?? "contract", personName: p.personName, departmentId: p.departmentId,
              title: p.title ?? "", officePhone: p.officePhone ?? "", mobilePhone: p.mobilePhone ?? "",
              email: p.email ?? "", duties: p.duties ?? "",
              appointedAt: p.appointedAt ?? "", transferredAt: p.transferredAt ?? "", resignedAt: p.resignedAt ?? "",
            }))
        );
      })
      .catch(() => {});
  }, [facilityId]);

  const upd = (i: number, patch: Partial<SitePersonEdit>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { id: null, deptType: "contract", personName: "", departmentId: null, title: "", officePhone: "", mobilePhone: "", email: "", duties: "", appointedAt: "", transferredAt: "", resignedAt: "" }]);

  const save = async () => {
    setSaving(true);
    try {
      const others = (loaded?.people ?? []).filter((p) => !p.deptType).map((p) => ({ ...p }));
      const newDepts = depts.filter((d) => d.id < 0).map((d) => ({ id: d.id, departmentName: d.departmentName }));
      const edited = rows.filter((r) => r.personName.trim()).map((r) => ({
        id: r.id, deptType: r.deptType, personName: r.personName.trim(), departmentId: r.departmentId,
        title: r.title || null, officePhone: r.officePhone || null, mobilePhone: r.mobilePhone || null,
        email: r.email || null, duties: r.duties || null,
        appointedAt: r.appointedAt || null, transferredAt: r.transferredAt || null, resignedAt: r.resignedAt || null,
        status: r.resignedAt ? "inactive" : "active",
      }));
      await fetch(`/api/facilities/${facilityId}/contacts`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mainNumber: loaded?.mainNumber ?? null,
          departments: [...((loaded?.departments as { id: number; departmentName: string }[]) ?? []), ...newDepts],
          people: [...others, ...edited],
          logs: loaded?.logs ?? [],
        }),
      });
      onSaved();
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="cd-modal-overlay cdash cd-fields-white" data-theme={theme} onClick={onClose}>
      <div className="cd-modal cd-card-bg w-full" style={{ maxWidth: 640, padding: "1.25rem", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="cd-text text-lg font-extrabold">사업장 담당자 설정</h3>
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}><X className="w-4 h-4" /></button>
        </div>

        <div className="flex items-end gap-2 mb-3">
          <div className="flex-1">
            <label className="cd-label">부서 신규 등록</label>
            <input className="cd-input" placeholder="부서명 입력 후 추가" value={newDeptName} onChange={(e) => setNewDeptName(e.target.value)} />
          </div>
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={addDept}><Plus className="w-4 h-4" /> 부서 추가</button>
        </div>

        <div className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <div key={i} className="rounded-xl border cd-border-c p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex gap-1.5">
                  {SITE_DEPT_TYPES.map((d) => (
                    <button key={d.v} type="button" className="cd-chip cd-chip-sm" data-active={r.deptType === d.v} onClick={() => upd(i, { deptType: d.v })}>{d.l}</button>
                  ))}
                </div>
                <button className="cd-text-faint" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input className="cd-input" placeholder="성명" value={r.personName} onChange={(e) => upd(i, { personName: e.target.value })} />
                <input className="cd-input" placeholder="직급/직함" value={r.title} onChange={(e) => upd(i, { title: e.target.value })} />
                <select className="cd-select" value={r.departmentId ?? ""} onChange={(e) => upd(i, { departmentId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">부서 미지정</option>
                  {depts.map((d) => <option key={d.id} value={d.id}>{d.departmentName}</option>)}
                </select>
                <input className="cd-input" placeholder="이메일" value={r.email} onChange={(e) => upd(i, { email: e.target.value })} />
                <input className="cd-input" placeholder="전화(회사)" value={r.officePhone} onChange={(e) => upd(i, { officePhone: e.target.value })} />
                <input className="cd-input" placeholder="전화(HP)" value={r.mobilePhone} onChange={(e) => upd(i, { mobilePhone: e.target.value })} />
              </div>
              <input className="cd-input" placeholder="업무 개요" value={r.duties} onChange={(e) => upd(i, { duties: e.target.value })} />
              <div className="flex flex-wrap gap-3 items-center">
                <label className="flex items-center gap-1 cd-text-muted text-xs">
                  <input type="checkbox" checked={!!r.appointedAt} onChange={(e) => upd(i, { appointedAt: e.target.checked ? new Date().toISOString().slice(0, 10) : "" })} /> 신규 선임
                </label>
                {r.appointedAt && <input type="date" className="cd-input" style={{ width: "auto" }} value={r.appointedAt} onChange={(e) => upd(i, { appointedAt: e.target.value })} />}
                <label className="flex items-center gap-1 cd-text-muted text-xs">
                  <input type="checkbox" checked={!!r.transferredAt} onChange={(e) => upd(i, { transferredAt: e.target.checked ? new Date().toISOString().slice(0, 10) : "" })} /> 부서 변경
                </label>
                {r.transferredAt && <input type="date" className="cd-input" style={{ width: "auto" }} value={r.transferredAt} onChange={(e) => upd(i, { transferredAt: e.target.value })} />}
                <label className="flex items-center gap-1 cd-text-muted text-xs">
                  <input type="checkbox" checked={!!r.resignedAt} onChange={(e) => upd(i, { resignedAt: e.target.checked ? new Date().toISOString().slice(0, 10) : "" })} /> 퇴사
                </label>
                {r.resignedAt && <input type="date" className="cd-input" style={{ width: "auto" }} value={r.resignedAt} onChange={(e) => upd(i, { resignedAt: e.target.value })} />}
                {r.resignedAt && <span className="cd-pill cd-pill-error">퇴직</span>}
              </div>
            </div>
          ))}
          {rows.length === 0 && <div className="cd-text-faint text-xs">등록된 사업장 담당자가 없습니다.</div>}
          <button className="cd-btn cd-btn-ghost cd-btn-sm self-start" onClick={addRow}><Plus className="w-4 h-4" /> 담당자 추가</button>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>취소</button>
          <button className="cd-btn cd-btn-primary cd-btn-sm" onClick={save} disabled={saving}>{saving ? "저장 중…" : "저장"}</button>
        </div>
      </div>
    </div>
  );
}
