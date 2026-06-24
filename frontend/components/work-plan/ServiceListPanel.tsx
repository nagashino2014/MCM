"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MyServiceRow, ServiceReportListRow, ReviewReportRow, ExecReportCard } from "@/lib/work-plan/workspace";
import type { MyTaskRow } from "@/lib/work-plan/tasks";

export type LeftTab = "service" | "task";
type LeftMode = "progress" | "done" | "log" | "exec";

const STATUS_LABEL: Record<string, string> = {
  draft: "작성중",
  submitted: "제출",
  reviewed: "검토",
  finalized: "확정",
};

function elapsedLabel(from: string | null): string {
  if (!from) return "—";
  const start = new Date(from);
  if (Number.isNaN(start.getTime())) return "—";
  const now = new Date();
  const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (months <= 0) return "1개월 미만";
  if (months < 12) return `${months}개월`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m ? `${y}년 ${m}개월` : `${y}년`;
}

export default function ServiceListPanel({
  tab,
  onTabChange,
  services,
  loadingServices,
  serviceReports,
  selectedContractId,
  serviceReportId,
  onSelectService,
  onOpenServiceReport,
  tasks,
  loadingTasks,
  taskReports,
  selectedTaskId,
  taskReportId,
  onSelectTask,
  onOpenTaskReport,
  onDeleteService,
  onDeleteTask,
  filtersTop,
  filtersBottom,
  reboundActive,
  onToggleRebound,
  reboundItems,
  reboundReportId,
  onOpenRebound,
  showExecTab,
  execDirectedItems,
  execDirectedReportId,
  onOpenExecDirected,
}: {
  tab: LeftTab;
  onTabChange: (t: LeftTab) => void;
  services: MyServiceRow[];
  loadingServices: boolean;
  serviceReports: ServiceReportListRow[];
  selectedContractId: string | null;
  serviceReportId: string | null;
  onSelectService: (contractId: string) => void;
  onOpenServiceReport: (reportId: string) => void;
  tasks: MyTaskRow[];
  loadingTasks: boolean;
  taskReports: ServiceReportListRow[];
  selectedTaskId: string | null;
  taskReportId: string | null;
  onSelectTask: (taskId: string) => void;
  onOpenTaskReport: (reportId: string) => void;
  onDeleteService: (contractId: string) => void;
  onDeleteTask: (taskId: string) => void;
  /** 감독 필터 — 체크박스 묶음(탭 위 별도 행). */
  filtersTop?: React.ReactNode;
  /** 감독 필터 — 셀렉트 묶음(탭과 같은 행 우측). */
  filtersBottom?: React.ReactNode;
  /** 재보고 대상(보고작성) — 버튼/목록. 미지정 시 미표시. */
  reboundActive?: boolean;
  onToggleRebound?: () => void;
  reboundItems?: ReviewReportRow[];
  reboundReportId?: string | null;
  onOpenRebound?: (item: ReviewReportRow) => void;
  /** 감독 임원지시 탭 — exec_status='directed' 보고 목록. */
  showExecTab?: boolean;
  execDirectedItems?: ExecReportCard[];
  execDirectedReportId?: string | null;
  onOpenExecDirected?: (item: ExecReportCard) => void;
}) {
  const [mode, setMode] = useState<LeftMode>("progress");
  const [menu, setMenu] = useState<{ x: number; y: number; kind: "service" | "task"; id: string } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openMenu = (e: React.MouseEvent, kind: "service" | "task", id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, kind, id });
  };

  const isService = tab === "service";
  const selectedId = isService ? selectedContractId : selectedTaskId;
  const reports = isService ? serviceReports : taskReports;
  const reportId = isService ? serviceReportId : taskReportId;
  const onOpenReport = isService ? onOpenServiceReport : onOpenTaskReport;

  return (
    <section className="cd-card rounded-3xl p-3 cd-reveal delay-1 flex flex-col min-h-0">
      <div className="flex items-end gap-1 px-1 mb-3">
        {(["service", "task"] as LeftTab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onTabChange(t)}
            className={cn(
              "rounded-t-xl px-4 py-2 text-sm font-semibold border-b-2",
              tab === t ? "cd-text-primary border-current cd-tint-primary" : "cd-text-faint border-transparent cd-row-hover"
            )}
          >
            {t === "service" ? "용역" : "Task"}
          </button>
        ))}
      </div>

      {/* (감독) 체크박스 필터 — 탭 위 별도 행 */}
      {filtersTop && <div className="flex justify-end mb-2 ml-1">{filtersTop}</div>}

      {/* 진행 / 완료 / 보고 Log 토글 + (감독) 셀렉트 필터 (같은 행) */}
      <div className="flex items-center justify-between gap-3 mb-3 ml-1 flex-wrap">
        <div className="inline-flex self-start rounded-xl border cd-border-c overflow-hidden text-xs font-semibold">
          <button
            type="button"
            onClick={() => setMode("progress")}
            className={cn("px-3 py-1.5", mode === "progress" ? "cd-fill-primary text-white" : "cd-text-muted")}
          >
            {isService ? "진행용역" : "진행 Task"}
          </button>
          <button
            type="button"
            onClick={() => setMode("done")}
            className={cn("px-3 py-1.5 border-l cd-border-c", mode === "done" ? "cd-fill-primary text-white" : "cd-text-muted")}
          >
            완료
          </button>
          <button
            type="button"
            onClick={() => setMode("log")}
            className={cn("px-3 py-1.5 border-l cd-border-c", mode === "log" ? "cd-fill-primary text-white" : "cd-text-muted")}
          >
            보고 Log
          </button>
          {showExecTab && (
            <button
              type="button"
              onClick={() => setMode("exec")}
              className={cn("px-3 py-1.5 border-l cd-border-c inline-flex items-center gap-1", mode === "exec" ? "cd-fill-primary text-white" : "cd-text-muted")}
            >
              임원지시
              {execDirectedItems && execDirectedItems.length > 0 && (
                <span className={cn("rounded-full px-1.5 text-[10px]", mode === "exec" ? "bg-white/25" : "cd-tint-primary cd-text-primary")}>{execDirectedItems.length}</span>
              )}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onToggleRebound && (
            <button
              type="button"
              onClick={onToggleRebound}
              className={cn(
                "rounded-xl px-3 py-1.5 text-xs font-semibold inline-flex items-center gap-1.5 border",
                reboundActive ? "cd-fill-primary text-white border-transparent" : "cd-border-c cd-text-muted"
              )}
            >
              <RotateCcw className="w-3.5 h-3.5" /> 재보고 대상
              {reboundItems && reboundItems.length > 0 && (
                <span className={cn("rounded-full px-1.5 text-[10px]", reboundActive ? "bg-white/25" : "cd-tint-primary cd-text-primary")}>{reboundItems.length}</span>
              )}
            </button>
          )}
          {filtersBottom}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide flex flex-col gap-2 px-1 pb-1">
        {reboundActive ? (
          !reboundItems || reboundItems.length === 0 ? (
            <div className="p-8 text-center text-xs cd-text-faint">반려된 재보고 대상이 없습니다.</div>
          ) : (
            reboundItems.map((r) => {
              const active = r.reportId === reboundReportId;
              return (
                <button
                  key={r.reportId}
                  type="button"
                  onClick={() => onOpenRebound?.(r)}
                  className={cn("text-left rounded-2xl border p-3 transition-colors", active ? "cd-tint-primary border-current cd-text-primary" : "cd-border-c cd-row-hover")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold cd-text truncate">{r.subjectLabel}</p>
                      <p className="text-[11px] cd-text-faint truncate">{r.meetingLabel || "보고"} {r.meetingSeq ?? 1}회차 · {r.reportDate ?? r.periodEnd}</p>
                    </div>
                    <span className="shrink-0 text-[10px] font-semibold rounded-full px-2 py-0.5 border" style={{ borderColor: "var(--cd-error)", color: "var(--cd-error)" }}>반려</span>
                  </div>
                  {r.reviewerComment && <p className="text-[11px] cd-text-muted mt-1.5 line-clamp-2"><span className="cd-text-primary font-semibold">부서장 의견</span> · {r.reviewerComment}</p>}
                </button>
              );
            })
          )
        ) : mode === "exec" ? (
          !execDirectedItems || execDirectedItems.length === 0 ? (
            <div className="p-8 text-center text-xs cd-text-faint">임원 지시가 내려온 보고가 없습니다.</div>
          ) : (
            execDirectedItems
              .filter((c) => (isService ? c.subjectKind === "contract" : c.subjectKind === "task"))
              .map((c) => {
                const active = c.reportId === execDirectedReportId;
                return (
                  <button
                    key={c.reportId}
                    type="button"
                    onClick={() => onOpenExecDirected?.(c)}
                    className={cn("text-left rounded-2xl border p-3 transition-colors", active ? "cd-tint-primary border-current cd-text-primary" : "cd-border-c cd-row-hover")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold cd-text truncate">{c.subjectLabel}</p>
                        <p className="text-[11px] cd-text-faint truncate">{c.meetingLabel || "보고"} {c.meetingSeq ?? 1}회차</p>
                      </div>
                      <span className="shrink-0 text-[10px] font-semibold rounded-full px-2 py-0.5 cd-tint-primary cd-text-primary">임원지시</span>
                    </div>
                  </button>
                );
              })
          )
        ) : mode !== "log" ? (
          isService ? (
            <ServiceCards
              services={services.filter((s) => (mode === "done" ? s.completed : !s.completed))}
              loading={loadingServices}
              done={mode === "done"}
              selectedId={selectedId}
              onSelect={onSelectService}
              onContext={(e, id) => openMenu(e, "service", id)}
            />
          ) : (
            <TaskCards
              tasks={tasks.filter((t) => (mode === "done" ? t.completed : !t.completed))}
              loading={loadingTasks}
              done={mode === "done"}
              selectedId={selectedId}
              onSelect={onSelectTask}
              onContext={(e, id) => openMenu(e, "task", id)}
            />
          )
        ) : !selectedId ? (
          <div className="p-8 text-center text-xs cd-text-faint">{isService ? "진행용역에서 용역을" : "진행 Task에서 Task를"} 먼저 선택하세요.</div>
        ) : reports.length === 0 ? (
          <div className="p-8 text-center text-xs cd-text-faint">보고 이력이 없습니다.</div>
        ) : (
          reports.map((r, i) => {
            const active = r.reportId === reportId;
            const seq = reports.length - i;
            return (
              <button
                key={r.reportId}
                type="button"
                onClick={() => onOpenReport(r.reportId)}
                className={cn(
                  "text-left rounded-2xl border p-3 transition-colors",
                  active ? "cd-tint-primary border-current cd-text-primary" : "cd-border-c cd-row-hover"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold cd-text">
                    업무보고
                    <span className="text-[11px] font-normal cd-text-faint"> ({r.meetingLabel || "보고"} {seq}회차)</span>
                  </p>
                  <span className="shrink-0 text-[10px] font-semibold cd-text-faint rounded-full px-2 py-0.5 border cd-border-c">
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <Kv label="보고기간" value={`${r.periodStart} ~ ${r.periodEnd}`} />
                  <Kv label="회의일" value={r.reportDate ?? "—"} />
                </div>
              </button>
            );
          })
        )}
      </div>

      {menu && (
        <div
          className="fixed z-[80] rounded-xl border cd-border-c cd-card-bg shadow-xl py-1 min-w-[180px]"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-xs cd-error-text hover:bg-[color:var(--cd-error-soft)] inline-flex items-center gap-2"
            onClick={() => {
              const ok = menu.kind === "task"
                ? confirm("이 Task와 관련 업무보고를 모두 삭제합니다. 계속할까요?")
                : confirm("이 용역에 작성한 업무보고를 모두 삭제합니다.\n(계약·수행인력·공정표 원본은 보존됩니다.) 계속할까요?");
              if (ok) (menu.kind === "task" ? onDeleteTask : onDeleteService)(menu.id);
              setMenu(null);
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {menu.kind === "task" ? "Task 삭제" : "이 용역의 업무보고 삭제"}
          </button>
        </div>
      )}
    </section>
  );
}

function ServiceCards({
  services,
  loading,
  done,
  selectedId,
  onSelect,
  onContext,
}: {
  services: MyServiceRow[];
  loading: boolean;
  done: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onContext: (e: React.MouseEvent, id: string) => void;
}) {
  if (loading) return <div className="p-8 text-center text-xs cd-text-faint">불러오는 중…</div>;
  if (services.length === 0)
    return (
      <div className="p-8 text-center text-xs cd-text-faint">
        {done ? "완료된 용역이 없습니다." : <>수행 중인 용역이 없습니다.<br />(로그인 계정이 직원과 연결돼 있어야 표시됩니다.)</>}
      </div>
    );
  return (
    <>
      {services.map((s) => {
        const active = s.contractId === selectedId;
        return (
          <button
            key={s.contractId}
            type="button"
            onClick={() => onSelect(s.contractId)}
            onContextMenu={(e) => onContext(e, s.contractId)}
            title="우클릭으로 삭제"
            className={cn(
              "text-left rounded-2xl border p-3 transition-colors",
              active ? "cd-tint-primary border-current cd-text-primary" : "cd-border-c cd-row-hover"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold cd-text truncate">{s.contractTitle}</p>
                <p className="text-[11px] cd-text-faint truncate">{s.counterpartyName}</p>
              </div>
              <LastReport date={s.lastReportDate} seq={s.lastReportSeq} />
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <Kv label="계약일" value={s.contractDate ?? "—"} />
              <Kv label="공정단계" value={stageLabel(s.lastStage, s.stageIndex, s.stageTotal)} />
              <Kv label="경과기간" value={elapsedLabel(s.contractDate ?? s.startedAt)} />
              <Kv label="진행률" value={s.lastPct != null ? `${Math.round(s.lastPct)}%` : "—"} />
              <span className="col-span-2"><Kv label="수행인력" value={workerLabel(s.workerNames)} /></span>
            </div>
          </button>
        );
      })}
    </>
  );
}

function TaskCards({
  tasks,
  loading,
  done,
  selectedId,
  onSelect,
  onContext,
}: {
  tasks: MyTaskRow[];
  loading: boolean;
  done: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onContext: (e: React.MouseEvent, id: string) => void;
}) {
  if (loading) return <div className="p-8 text-center text-xs cd-text-faint">불러오는 중…</div>;
  if (tasks.length === 0)
    return (
      <div className="p-8 text-center text-xs cd-text-faint">
        {done ? "완료된 Task가 없습니다." : <>진행 중인 Task가 없습니다.<br />[새 업무추진계획]에서 Task를 등록하세요.</>}
      </div>
    );
  return (
    <>
      {tasks.map((t) => {
        const active = t.taskId === selectedId;
        return (
          <button
            key={t.taskId}
            type="button"
            onClick={() => onSelect(t.taskId)}
            onContextMenu={(e) => onContext(e, t.taskId)}
            title="우클릭으로 삭제"
            className={cn(
              "text-left rounded-2xl border p-3 transition-colors",
              active ? "cd-tint-primary border-current cd-text-primary" : "cd-border-c cd-row-hover"
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold cd-text truncate">{t.taskName}</p>
                <p className="text-[11px] cd-text-faint truncate">{t.categoryName ?? "업무분류 미지정"}</p>
              </div>
              <LastReport date={t.lastReportDate} seq={t.lastReportSeq} />
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              <Kv label="착수일자" value={t.startedAt ?? "—"} />
              <Kv label="업무단계" value={stageLabel(t.lastStage, t.stageIndex, t.stageTotal)} />
              <Kv label="경과기간" value={elapsedLabel(t.startedAt)} />
              <Kv label="진행률" value={t.lastPct != null ? `${Math.round(t.lastPct)}%` : "—"} />
              <span className="col-span-2"><Kv label="수행인력" value={workerLabel(t.workerNames)} /></span>
            </div>
          </button>
        );
      })}
    </>
  );
}

function stageLabel(stage: string | null, idx: number | null, total: number | null): string {
  if (!stage) return "—";
  return idx && total ? `${stage} ${idx}/${total}` : stage;
}

// 실무자 성명: 2명까지 표기, 초과 시 "외 N명"(부서장/관리자는 집계에서 이미 제외됨).
function workerLabel(names: string[]): string {
  if (!names || names.length === 0) return "—";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} 외 ${names.length - 2}명`;
}

function LastReport({ date, seq }: { date: string | null; seq: number | null }) {
  if (!date) return null;
  return (
    <span className="shrink-0 text-right leading-tight">
      <span className="block text-[10px] font-mono cd-text-faint">{date}</span>
      {seq ? <span className="block text-[10px] font-semibold cd-text-primary">{seq}회차</span> : null}
    </span>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span className="cd-text-faint shrink-0">{label}</span>
      <span className="cd-text-muted truncate">{value}</span>
    </span>
  );
}
