"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardList, ArrowLeft, Plus } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import ServiceListPanel, { type LeftTab } from "@/components/work-plan/ServiceListPanel";
import NewEntryPanel from "@/components/work-plan/NewEntryPanel";
import ReportEditor, { type ReportSubject } from "@/components/work-plan/ReportEditor";
import TaskCreateForm from "@/components/work-plan/TaskCreateForm";
import type { MyServiceRow, ReporterContext, ServiceReportListRow, ReviewReportRow } from "@/lib/work-plan/workspace";
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
function taskSubject(taskId: string, categoryName: string | null): ReportSubject {
  return {
    kind: "task",
    id: taskId,
    serviceType: categoryName,
    stagesUrl: `/api/work-tasks/${taskId}/process-stages`,
    participantsUrl: `/api/work-tasks/${taskId}/participants`,
    staffingRoleOptions: TASK_ROLES,
  };
}
function reviewSubject(r: ReviewReportRow): ReportSubject {
  return r.subjectKind === "task" ? taskSubject(r.subjectId, r.serviceType) : {
    kind: "contract",
    id: r.subjectId,
    serviceType: r.serviceType,
    stagesUrl: `/api/contracts/${r.subjectId}/process-stages`,
    participantsUrl: `/api/contracts/${r.subjectId}/participants`,
    staffingRoleOptions: SERVICE_ROLES,
  };
}

export default function ServiceWorkspace() {
  const { theme } = useCdashTheme();

  const [reporter, setReporter] = useState<ReporterContext | null>(null);
  const [newEntry, setNewEntry] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>("service");

  // 용역(브라우즈)
  const [services, setServices] = useState<MyServiceRow[]>([]);
  const [loadingServices, setLoadingServices] = useState(true);
  const [selectedContractId, setSelectedContractId] = useState<string | null>(null);
  const [serviceReports, setServiceReports] = useState<ServiceReportListRow[]>([]);
  const [serviceReportId, setServiceReportId] = useState<string | null>(null);

  // Task(브라우즈)
  const [tasks, setTasks] = useState<MyTaskRow[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskReports, setTaskReports] = useState<ServiceReportListRow[]>([]);
  const [taskReportId, setTaskReportId] = useState<string | null>(null);

  // 신규 등록
  const [categories, setCategories] = useState<TaskCategoryRow[]>([]);
  const [newContract, setNewContract] = useState<MyServiceRow | null>(null);
  const [newCategory, setNewCategory] = useState<TaskCategoryRow | null>(null);
  const [newTask, setNewTask] = useState<{ taskId: string; taskName: string; startedAt: string } | null>(null);

  // 재보고 대상(반려된 내 보고)
  const [reboundActive, setReboundActive] = useState(false);
  const [reboundItems, setReboundItems] = useState<ReviewReportRow[]>([]);
  const [reboundSubject, setReboundSubject] = useState<ReportSubject | null>(null);
  const [reboundReportId, setReboundReportId] = useState<string | null>(null);

  const loadServices = useCallback(() => {
    setLoadingServices(true);
    fetch("/api/work-plan/my-services", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setServices(d.services ?? []);
        setReporter(d.reporter ?? null);
      })
      .finally(() => setLoadingServices(false));
  }, []);

  const loadTasks = useCallback(() => {
    setLoadingTasks(true);
    fetch("/api/work-plan/my-tasks", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks ?? []))
      .finally(() => setLoadingTasks(false));
  }, []);

  const loadCategories = useCallback(() => {
    fetch("/api/work-task-categories", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCategories(d.categories ?? []))
      .catch(() => setCategories([]));
  }, []);

  const loadRebound = useCallback(() => {
    fetch("/api/work-plan/rebound", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setReboundItems(d.reports ?? []))
      .catch(() => setReboundItems([]));
  }, []);

  useEffect(() => {
    loadServices();
    loadTasks();
    loadCategories();
    loadRebound();
  }, [loadServices, loadTasks, loadCategories, loadRebound]);

  const openRebound = (r: ReviewReportRow) => {
    setReboundSubject(reviewSubject(r));
    setReboundReportId(r.reportId);
  };

  const loadServiceReports = (contractId: string) =>
    fetch(`/api/work-plan/service/${contractId}/reports`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setServiceReports(d.reports ?? []))
      .catch(() => setServiceReports([]));

  const loadTaskReports = (taskId: string) =>
    fetch(`/api/work-tasks/${taskId}/reports`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setTaskReports(d.reports ?? []))
      .catch(() => setTaskReports([]));

  const selectService = (contractId: string) => {
    setSelectedContractId(contractId);
    setServiceReportId(null);
    loadServiceReports(contractId);
  };
  const selectTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    setTaskReportId(null);
    loadTaskReports(taskId);
  };

  const enterNew = () => {
    setNewEntry(true);
    setNewContract(null);
    setNewCategory(null);
    setNewTask(null);
  };
  const exitNew = () => {
    setNewEntry(false);
    loadServices();
    loadTasks();
  };

  const addCategory = async () => {
    const name = window.prompt("새 업무분류명을 입력하세요.", "");
    if (!name?.trim()) return;
    const res = await fetch("/api/work-task-categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryName: name.trim() }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) setCategories(d.categories ?? categories);
  };

  const handleSaved = () => {
    loadServices();
    loadTasks();
    loadRebound();
    if (selectedContractId) loadServiceReports(selectedContractId);
    if (selectedTaskId) loadTaskReports(selectedTaskId);
  };

  const deleteTask = async (taskId: string) => {
    const res = await fetch(`/api/work-tasks/${taskId}`, { method: "DELETE" });
    if (!res.ok) { alert("Task 삭제에 실패했습니다."); return; }
    if (selectedTaskId === taskId) { setSelectedTaskId(null); setTaskReportId(null); setTaskReports([]); }
    loadTasks();
  };
  const deleteServiceReports = async (contractId: string) => {
    const res = await fetch(`/api/work-plan/service/${contractId}/reports`, { method: "DELETE" });
    if (!res.ok) { alert("업무보고 삭제에 실패했습니다."); return; }
    if (selectedContractId === contractId) { setServiceReportId(null); loadServiceReports(contractId); }
    loadServices();
  };

  const selectedService = services.find((s) => s.contractId === selectedContractId) ?? null;
  const selectedTask = tasks.find((t) => t.taskId === selectedTaskId) ?? null;

  // 신규 보고 회차 태그 추정: 회의종류별 기존 제출 보고 수.
  const seqByLabel = useMemo(() => {
    const src = leftTab === "service" ? serviceReports : taskReports;
    const m: Record<string, number> = {};
    for (const r of src) if (r.status === "submitted") { const k = r.meetingLabel ?? ""; m[k] = (m[k] ?? 0) + 1; }
    return m;
  }, [leftTab, serviceReports, taskReports]);

  // 우측 페인 결정.
  const right = useMemo(() => {
    if (reboundActive) {
      if (!reboundSubject || !reboundReportId) return { kind: "empty", text: "왼쪽 재보고 대상에서 보고를 선택하면 부서장 의견을 확인하고 수정·재제출할 수 있습니다." } as const;
      return { kind: "editor", subject: reboundSubject, reportId: reboundReportId, meta: null } as const;
    }
    if (newEntry) {
      if (leftTab === "service") {
        if (!newContract) return { kind: "empty", text: "좌측에서 용역을 선택해 업무보고를 시작하세요." } as const;
        return { kind: "editor", subject: contractSubject(newContract), reportId: null, meta: serviceMeta(newContract) } as const;
      }
      // task
      if (!newCategory) return { kind: "empty", text: "좌측에서 업무분류를 선택하세요." } as const;
      if (!newTask) return { kind: "task-create", category: newCategory } as const;
      return {
        kind: "editor",
        subject: taskSubject(newTask.taskId, newCategory.categoryName),
        reportId: null,
        meta: taskMeta(newTask.taskName, newTask.startedAt, newCategory.categoryName),
      } as const;
    }
    // browse
    if (leftTab === "service") {
      if (!selectedService) return { kind: "empty", text: "좌측 진행용역에서 용역을 선택하세요." } as const;
      return { kind: "editor", subject: contractSubject(selectedService), reportId: serviceReportId, meta: null } as const;
    }
    if (!selectedTask) return { kind: "empty", text: "좌측 진행 Task에서 Task를 선택하세요." } as const;
    return { kind: "editor", subject: taskSubject(selectedTask.taskId, selectedTask.categoryName), reportId: taskReportId, meta: null } as const;
  }, [reboundActive, reboundSubject, reboundReportId, newEntry, leftTab, newContract, newCategory, newTask, selectedService, selectedTask, serviceReportId, taskReportId]);

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<ClipboardList className="w-5 h-5" />}
        eyebrow="Work · Reporting"
        title="업무추진계획"
        subtitle="수행 중인 용역·Task를 선택해 공정·진행단계·수행인력·추진내역을 한 화면에서 보고합니다."
        actions={
          <div className="flex items-center gap-2">
            {newEntry ? (
              <button type="button" onClick={exitNew} className="cd-btn rounded-xl px-3 py-2 text-sm border cd-border-c cd-text-muted inline-flex items-center gap-1.5">
                <ArrowLeft className="w-4 h-4" /> 목록
              </button>
            ) : (
              <button type="button" onClick={enterNew} className="rounded-xl px-3 py-2 text-sm text-white cd-fill-primary inline-flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> 새 업무추진계획
              </button>
            )}
          </div>
        }
      />

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[900px_1fr] gap-5">
        {newEntry ? (
          <NewEntryPanel
            tab={leftTab}
            onTabChange={setLeftTab}
            services={services}
            categories={categories}
            selectedContractId={newContract?.contractId ?? null}
            onPickContract={(s) => setNewContract(s)}
            selectedCategoryId={newCategory?.categoryId ?? null}
            onPickCategory={(c) => { setNewCategory(c); setNewTask(null); }}
            onAddCategory={addCategory}
          />
        ) : (
          <ServiceListPanel
            tab={leftTab}
            onTabChange={setLeftTab}
            services={services}
            loadingServices={loadingServices}
            serviceReports={serviceReports}
            selectedContractId={selectedContractId}
            serviceReportId={serviceReportId}
            onSelectService={selectService}
            onOpenServiceReport={setServiceReportId}
            tasks={tasks}
            loadingTasks={loadingTasks}
            taskReports={taskReports}
            selectedTaskId={selectedTaskId}
            taskReportId={taskReportId}
            onSelectTask={selectTask}
            onOpenTaskReport={setTaskReportId}
            onDeleteService={deleteServiceReports}
            onDeleteTask={deleteTask}
            reboundActive={reboundActive}
            onToggleRebound={() => { setReboundActive((v) => !v); setReboundSubject(null); setReboundReportId(null); }}
            reboundItems={reboundItems}
            reboundReportId={reboundReportId}
            onOpenRebound={openRebound}
          />
        )}

        {right.kind === "empty" ? (
          <section className="cd-card rounded-3xl p-10 flex items-center justify-center text-center cd-reveal delay-2">
            <p className="text-sm cd-text-faint">{right.text}</p>
          </section>
        ) : right.kind === "task-create" ? (
          <TaskCreateForm
            category={right.category}
            onCreated={(t) => { setNewTask(t); loadTasks(); }}
          />
        ) : (
          <ReportEditor
            key={`${right.subject.kind}:${right.subject.id}:${right.reportId ?? "new"}`}
            subject={right.subject}
            reportId={right.reportId}
            reporter={reporter}
            metaRow={right.meta}
            onSaved={handleSaved}
            theme={theme}
            seqByLabel={seqByLabel}
          />
        )}
      </div>
    </div>
  );
}

function serviceMeta(s: MyServiceRow) {
  return (
    <MetaRow
      cols={[
        { label: "계약명", value: s.contractTitle, grow: true },
        { label: "계약일", value: s.contractDate ?? "—" },
        { label: "계약분류", value: s.serviceType ?? "—" },
      ]}
    />
  );
}
function taskMeta(taskName: string, startedAt: string, categoryName: string) {
  return (
    <MetaRow
      cols={[
        { label: "업무명", value: taskName, grow: true },
        { label: "착수일", value: startedAt || "—" },
        { label: "업무분류", value: categoryName },
      ]}
    />
  );
}

function MetaRow({ cols }: { cols: { label: string; value: string; grow?: boolean }[] }) {
  return (
    <div className="rounded-2xl border cd-border-c p-4 flex flex-col md:flex-row gap-3">
      {cols.map((c, i) => (
        <label key={i} className={c.grow ? "flex flex-col gap-1.5 flex-1 min-w-0" : "flex flex-col gap-1.5"}>
          <span className="text-[11px] font-semibold cd-text-faint">{c.label}</span>
          <div className="cd-input text-sm w-full flex items-center cd-text font-medium truncate">{c.value}</div>
        </label>
      ))}
    </div>
  );
}
