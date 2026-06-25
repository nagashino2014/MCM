"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, GitMerge, Layers } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { cn } from "@/lib/utils";
import ServiceListPanel, { type LeftTab } from "@/components/work-plan/ServiceListPanel";
import ReportEditor, { type ReportSubject } from "@/components/work-plan/ReportEditor";
import { SERVICE_CATEGORIES } from "@/lib/work-plan/constants";
import type { MyServiceRow, ServiceReportListRow, ReviewReportRow, ExecReportCard } from "@/lib/work-plan/workspace";
import type { MyTaskRow, TaskCategoryRow } from "@/lib/work-plan/tasks";
import "@/components/cdash/cdash.css";

const SERVICE_ROLES = ["관리자", "실무(정)", "실무(부)", "실무(품질검토)"];
const TASK_ROLES = ["관리자", "실무자1", "실무자2", "실무자3", "실무자4"];

function contractSubject(s: MyServiceRow): ReportSubject {
  return {
    kind: "contract",
    id: s.contractId,
    serviceType: s.serviceType,
    stagesUrl: `/api/contracts/${s.contractId}/process-stages`,
    participantsUrl: `/api/contracts/${s.contractId}/participants`,
    staffingRoleOptions: SERVICE_ROLES,
  };
}
function taskSubject(t: MyTaskRow): ReportSubject {
  return {
    kind: "task",
    id: t.taskId,
    serviceType: t.categoryName,
    stagesUrl: `/api/work-tasks/${t.taskId}/process-stages`,
    participantsUrl: `/api/work-tasks/${t.taskId}/participants`,
    staffingRoleOptions: TASK_ROLES,
  };
}

const yearOf = (d: string | null): string => (d ? String(d).slice(0, 4) : "");

interface ReviewContext {
  isAdmin: boolean;
  deptId: string | null;
  deptName: string | null;
  departments?: { deptId: string; deptName: string }[];
}

export default function OversightWorkspace() {
  const { theme, toggleTheme } = useCdashTheme();

  const [ctx, setCtx] = useState<ReviewContext | null>(null);
  const [deptId, setDeptId] = useState("");
  const [leftTab, setLeftTab] = useState<LeftTab>("service");

  const [services, setServices] = useState<MyServiceRow[]>([]);
  const [tasks, setTasks] = useState<MyTaskRow[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [members, setMembers] = useState<{ employeeId: string; name: string }[]>([]);
  const [categories, setCategories] = useState<TaskCategoryRow[]>([]);

  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [serviceReports, setServiceReports] = useState<ServiceReportListRow[]>([]);
  const [serviceReportId, setServiceReportId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskReports, setTaskReports] = useState<ServiceReportListRow[]>([]);
  const [taskReportId, setTaskReportId] = useState<string | null>(null);

  // 필터 상태
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [year, setYear] = useState("");
  const [subtype, setSubtype] = useState("");
  const [taskCat, setTaskCat] = useState("");
  const [member, setMember] = useState("");

  // Merging 대상(확인 완료 보고)
  const [merging, setMerging] = useState(false);
  const [confirmed, setConfirmed] = useState<ReviewReportRow[]>([]);
  const [mergeChecked, setMergeChecked] = useState<Set<string>>(new Set());
  const [mergeBusy, setMergeBusy] = useState(false);

  // 임원지시(부서장 답변·재보고)
  const [execDirected, setExecDirected] = useState<ExecReportCard[]>([]);
  const [execResponseReportId, setExecResponseReportId] = useState<string | null>(null);
  const [execResponseSubject, setExecResponseSubject] = useState<ReportSubject | null>(null);

  // 권한 컨텍스트 + 업무분류
  useEffect(() => {
    fetch("/api/work-plan/review-context", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ReviewContext) => {
        setCtx(d);
        if (!d.isAdmin) setDeptId(d.deptId ?? "");
        else if (d.departments?.length) setDeptId(d.departments[0].deptId);
      })
      .catch(() => setCtx({ isAdmin: false, deptId: null, deptName: null }));
    fetch("/api/work-task-categories", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCategories(d.categories ?? []))
      .catch(() => setCategories([]));
  }, []);

  // 부서 데이터 로드
  useEffect(() => {
    setSelectedContractId(null); setServiceReportId(null); setServiceReports([]);
    setSelectedTaskId(null); setTaskReportId(null); setTaskReports([]);
    setCats(new Set()); setYear(""); setSubtype(""); setTaskCat(""); setMember("");
    setMerging(false); setConfirmed([]); setMergeChecked(new Set());
    setExecDirected([]); setExecResponseReportId(null); setExecResponseSubject(null);
    if (!deptId) { setServices([]); setTasks([]); setMembers([]); return; }
    fetch(`/api/work-plan/exec-cards?filter=directed&dept=${encodeURIComponent(deptId)}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => setExecDirected(d.cards ?? [])).catch(() => setExecDirected([]));
    setLoadingServices(true);
    fetch(`/api/work-plan/dept-services?dept=${encodeURIComponent(deptId)}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => setServices(d.services ?? [])).catch(() => setServices([])).finally(() => setLoadingServices(false));
    setLoadingTasks(true);
    fetch(`/api/work-plan/dept-tasks?dept=${encodeURIComponent(deptId)}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => setTasks(d.tasks ?? [])).catch(() => setTasks([])).finally(() => setLoadingTasks(false));
    fetch(`/api/work-plan/dept-members?dept=${encodeURIComponent(deptId)}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => setMembers(d.members ?? [])).catch(() => setMembers([]));
  }, [deptId]);

  const loadServiceReports = (contractId: string): Promise<ServiceReportListRow[]> =>
    fetch(`/api/work-plan/service/${contractId}/reports`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => { const list = d.reports ?? []; setServiceReports(list); return list; }).catch(() => { setServiceReports([]); return []; });
  const loadTaskReports = (taskId: string): Promise<ServiceReportListRow[]> =>
    fetch(`/api/work-tasks/${taskId}/reports`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => { const list = d.reports ?? []; setTaskReports(list); return list; }).catch(() => { setTaskReports([]); return []; });

  // 용역/Task 태그 선택 시 가장 최신 보고 상세를 바로 연다.
  const selectService = async (contractId: string) => {
    setExecResponseReportId(null); setExecResponseSubject(null);
    setSelectedContractId(contractId);
    const list = await loadServiceReports(contractId);
    setServiceReportId(list[0]?.reportId ?? null);
  };
  const selectTask = async (taskId: string) => {
    setExecResponseReportId(null); setExecResponseSubject(null);
    setSelectedTaskId(taskId);
    const list = await loadTaskReports(taskId);
    setTaskReportId(list[0]?.reportId ?? null);
  };

  const reloadDept = () => {
    if (!deptId) return;
    fetch(`/api/work-plan/dept-services?dept=${encodeURIComponent(deptId)}`, { cache: "no-store" }).then((r) => r.json()).then((d) => setServices(d.services ?? [])).catch(() => {});
    fetch(`/api/work-plan/dept-tasks?dept=${encodeURIComponent(deptId)}`, { cache: "no-store" }).then((r) => r.json()).then((d) => setTasks(d.tasks ?? [])).catch(() => {});
  };
  const loadExecDirected = () => {
    if (!deptId) return;
    fetch(`/api/work-plan/exec-cards?filter=directed&dept=${encodeURIComponent(deptId)}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => setExecDirected(d.cards ?? [])).catch(() => {});
  };
  const openExecDirected = (c: ExecReportCard) => {
    setExecResponseReportId(c.reportId);
    setExecResponseSubject(
      c.subjectKind === "task"
        ? { kind: "task", id: c.subjectId, serviceType: c.serviceType, stagesUrl: `/api/work-tasks/${c.subjectId}/process-stages`, participantsUrl: `/api/work-tasks/${c.subjectId}/participants`, staffingRoleOptions: TASK_ROLES }
        : { kind: "contract", id: c.subjectId, serviceType: c.serviceType, stagesUrl: `/api/contracts/${c.subjectId}/process-stages`, participantsUrl: `/api/contracts/${c.subjectId}/participants`, staffingRoleOptions: SERVICE_ROLES }
    );
  };
  const handleSaved = () => {
    reloadDept();
    loadExecDirected();
    if (selectedContractId) loadServiceReports(selectedContractId);
    if (selectedTaskId) loadTaskReports(selectedTaskId);
    if (merging) loadConfirmed();
  };

  const loadConfirmed = () => {
    if (!deptId) return;
    fetch(`/api/work-plan/confirmed?dept=${encodeURIComponent(deptId)}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => setConfirmed(d.reports ?? [])).catch(() => setConfirmed([]));
  };
  // Merging 대상 토글 시 확인 목록 로드.
  useEffect(() => {
    if (merging) { loadConfirmed(); setMergeChecked(new Set()); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merging, deptId]);

  const toggleMergeCheck = (reportId: string) =>
    setMergeChecked((prev) => { const n = new Set(prev); if (n.has(reportId)) n.delete(reportId); else n.add(reportId); return n; });

  const createConsolidated = async () => {
    if (mergeChecked.size === 0) return;
    setMergeBusy(true);
    try {
      const res = await fetch("/api/work-plan/merge-confirmed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deptId, reportIds: Array.from(mergeChecked) }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b?.error ?? "통합 보고 생성 실패"); }
      setMergeChecked(new Set());
      loadConfirmed();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setMergeBusy(false);
    }
  };
  const deleteServiceReports = async (contractId: string) => {
    if (!confirm("이 용역에 작성한 업무보고를 모두 삭제합니다. 계속할까요?")) return;
    await fetch(`/api/work-plan/service/${contractId}/reports`, { method: "DELETE" });
    if (selectedContractId === contractId) { setServiceReportId(null); loadServiceReports(contractId); }
    reloadDept();
  };
  const deleteTask = async (taskId: string) => {
    await fetch(`/api/work-tasks/${taskId}`, { method: "DELETE" });
    if (selectedTaskId === taskId) { setSelectedTaskId(null); setTaskReportId(null); setTaskReports([]); }
    reloadDept();
  };

  // 필터 적용
  const filteredServices = useMemo(() => services.filter((s) => {
    if (cats.size && !(s.serviceType && cats.has(s.serviceType))) return false;
    if (year && yearOf(s.contractDate ?? s.startedAt) !== year) return false;
    if (subtype && s.serviceSubtype !== subtype) return false;
    if (member && !s.workerNames.includes(member)) return false;
    return true;
  }), [services, cats, year, subtype, member]);

  const filteredTasks = useMemo(() => tasks.filter((t) => {
    if (year && yearOf(t.startedAt) !== year) return false;
    if (taskCat && t.categoryId !== taskCat) return false;
    if (member && !t.workerNames.includes(member)) return false;
    return true;
  }), [tasks, year, taskCat, member]);

  const yearOptions = useMemo(() => {
    const set = new Set<string>();
    if (leftTab === "service") services.forEach((s) => { const y = yearOf(s.contractDate ?? s.startedAt); if (y) set.add(y); });
    else tasks.forEach((t) => { const y = yearOf(t.startedAt); if (y) set.add(y); });
    return Array.from(set).sort().reverse();
  }, [leftTab, services, tasks]);

  const subtypeOptions = useMemo(() => {
    const set = new Set<string>();
    services.forEach((s) => { if (cats.size && !(s.serviceType && cats.has(s.serviceType))) return; if (s.serviceSubtype) set.add(s.serviceSubtype); });
    return Array.from(set).sort();
  }, [services, cats]);

  const toggleCat = (value: string) =>
    setCats((prev) => { const n = new Set(prev); if (n.has(value)) n.delete(value); else n.add(value); return n; });

  const selectedService = services.find((s) => s.contractId === selectedContractId) ?? null;
  const selectedTask = tasks.find((t) => t.taskId === selectedTaskId) ?? null;
  const reportId = leftTab === "service" ? serviceReportId : taskReportId;
  const subject: ReportSubject | null = leftTab === "service"
    ? (selectedService ? contractSubject(selectedService) : null)
    : (selectedTask ? taskSubject(selectedTask) : null);

  // 체크박스 묶음(용역 탭만) — 탭 위 별도 행. 셀렉트 묶음과 같은 폭(w-[400px]).
  const filtersTop = leftTab === "service" ? (
    <div className="flex justify-between w-[400px] max-w-full">
      {SERVICE_CATEGORIES.map((c) => (
        <label key={c.value} className="inline-flex items-center gap-1 text-[11px] cd-text-muted cursor-pointer whitespace-nowrap">
          <input type="checkbox" checked={cats.has(c.value)} onChange={() => toggleCat(c.value)} /> {c.label}
        </label>
      ))}
    </div>
  ) : null;

  // 셀렉트 묶음 — 연도/수행인력은 좁게(5~6글자), 세분류·업무분류는 나머지 폭.
  const filtersBottom = (
    <div className="flex gap-1.5 w-[400px] max-w-full">
      <select className="cd-select text-xs !w-[72px] shrink-0" value={year} onChange={(e) => setYear(e.target.value)}>
        <option value="">연도</option>
        {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
      </select>
      {leftTab === "service" ? (
        <select className="cd-select text-xs flex-1 min-w-0" value={subtype} onChange={(e) => setSubtype(e.target.value)}>
          <option value="">용역세분류</option>
          {subtypeOptions.map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
      ) : (
        <select className="cd-select text-xs flex-1 min-w-0" value={taskCat} onChange={(e) => setTaskCat(e.target.value)}>
          <option value="">업무분류</option>
          {categories.map((c) => <option key={c.categoryId} value={c.categoryId}>{c.categoryName}</option>)}
        </select>
      )}
      <select className="cd-select text-xs !w-[88px] shrink-0" value={member} onChange={(e) => setMember(e.target.value)}>
        <option value="">수행인력</option>
        {members.map((m) => <option key={m.employeeId} value={m.name}>{m.name}</option>)}
      </select>
    </div>
  );

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<ClipboardCheck className="w-5 h-5" />}
        eyebrow="Work · Oversight"
        title="부서장 감독"
        subtitle="부서원이 보고한 용역·Task를 검토·첨삭하고 부서장 의견·이슈를 기재합니다."
        actions={
          <div className="flex items-start gap-2">
            <div className="flex flex-col items-end gap-1.5">
              {ctx?.isAdmin && (
                <select className="cd-select text-sm" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
                  {(ctx.departments ?? []).map((d) => (
                    <option key={d.deptId} value={d.deptId}>{d.deptName}</option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => setMerging((m) => !m)}
                className={cn(
                  "rounded-xl px-3 py-2 text-sm inline-flex items-center gap-1.5 border",
                  merging ? "cd-fill-primary text-white border-transparent" : "cd-border-c cd-text-muted"
                )}
              >
                <Layers className="w-4 h-4" /> Merging 대상
              </button>
            </div>
          </div>
        }
      />

      {merging ? (
        <section className="cd-card rounded-3xl p-4 cd-reveal delay-1 flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-3 px-1">
            <h2 className="font-bold cd-text flex items-center gap-2">
              <Layers className="w-4 h-4 cd-text-primary" /> Merging 대상 (확인 완료)
              <span className="text-xs cd-text-faint font-normal">{confirmed.length}건</span>
            </h2>
            <button
              type="button"
              disabled={mergeBusy || mergeChecked.size === 0}
              onClick={createConsolidated}
              className="rounded-xl px-4 py-2 text-sm text-white cd-fill-primary inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <GitMerge className="w-4 h-4" /> {mergeBusy ? "생성 중…" : `통합 보고 생성 (${mergeChecked.size})`}
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-1 pb-1">
            {confirmed.length === 0 ? (
              <div className="p-12 text-center text-sm cd-text-faint">확인 완료한 보고가 없습니다. (감독 상세에서 [확인]을 누르면 여기로 모입니다.)</div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-2.5">
                {confirmed.map((r) => {
                  const checked = mergeChecked.has(r.reportId);
                  return (
                    <button
                      key={r.reportId}
                      type="button"
                      onClick={() => toggleMergeCheck(r.reportId)}
                      className={cn("text-left rounded-2xl border p-3.5 transition", checked ? "border-[color:var(--cd-primary)] cd-tint-primary" : "cd-border-c cd-row-hover")}
                    >
                      <div className="flex items-start gap-2.5">
                        <input type="checkbox" className="mt-1" checked={checked} readOnly />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold cd-text">
                            업무보고 <span className="text-[11px] font-normal cd-text-faint">({r.meetingLabel || "보고"} {r.meetingSeq ?? 1}회차)</span>
                          </p>
                          <p className="text-[11px] cd-text-faint truncate">{r.subjectLabel}{r.serviceType ? ` · ${r.serviceType}` : ""}</p>
                          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                            <span className="cd-text-faint">보고자 <span className="cd-text-muted">{r.authorName ?? "—"}</span></span>
                            <span className="cd-text-faint">보고일 <span className="cd-text-muted">{r.reportDate ?? r.periodEnd}</span></span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      ) : (
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[900px_1fr] gap-5">
        <ServiceListPanel
          tab={leftTab}
          onTabChange={setLeftTab}
          services={filteredServices}
          loadingServices={loadingServices}
          serviceReports={serviceReports}
          selectedContractId={selectedContractId}
          serviceReportId={serviceReportId}
          onSelectService={selectService}
          onOpenServiceReport={setServiceReportId}
          tasks={filteredTasks}
          loadingTasks={loadingTasks}
          taskReports={taskReports}
          selectedTaskId={selectedTaskId}
          taskReportId={taskReportId}
          onSelectTask={selectTask}
          onOpenTaskReport={setTaskReportId}
          onDeleteService={deleteServiceReports}
          onDeleteTask={deleteTask}
          filtersTop={filtersTop}
          filtersBottom={filtersBottom}
          showExecTab
          execDirectedItems={execDirected}
          execDirectedReportId={execResponseReportId}
          onOpenExecDirected={openExecDirected}
        />

        {execResponseSubject && execResponseReportId ? (
          <ReportEditor
            key={`exec:${execResponseSubject.kind}:${execResponseSubject.id}:${execResponseReportId}`}
            subject={execResponseSubject}
            reportId={execResponseReportId}
            reporter={null}
            onSaved={handleSaved}
            theme={theme}
            execResponse
          />
        ) : subject && reportId ? (
          <ReportEditor
            key={`${subject.kind}:${subject.id}:${reportId}`}
            subject={subject}
            reportId={reportId}
            reporter={null}
            onSaved={handleSaved}
            theme={theme}
            review
          />
        ) : (
          <section className="cd-card rounded-3xl p-10 flex items-center justify-center text-center cd-reveal delay-2">
            <p className="text-sm cd-text-faint">
              {!deptId
                ? "부서를 선택하세요."
                : !subject
                ? "좌측에서 용역·Task를 선택하세요."
                : "보고 Log에서 검토할 보고를 선택하세요."}
            </p>
          </section>
        )}
      </div>
      )}
    </div>
  );
}
