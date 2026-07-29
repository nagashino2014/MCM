"use client";

import { useEffect, useMemo, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { cn } from "@/lib/utils";
import ReportEditor, { type ReportSubject } from "@/components/work-plan/ReportEditor";
import type { ExecReportCard } from "@/lib/work-plan/workspace";
import "@/components/cdash/cdash.css";

const SERVICE_ROLES = ["관리자", "실무(정)", "실무(부)", "실무(품질검토)"];
const TASK_ROLES = ["관리자", "실무자1", "실무자2", "실무자3", "실무자4"];

function cardSubject(c: ExecReportCard): ReportSubject {
  return c.subjectKind === "task"
    ? { kind: "task", id: c.subjectId, serviceType: c.serviceType, stagesUrl: `/api/work-tasks/${c.subjectId}/process-stages`, participantsUrl: `/api/work-tasks/${c.subjectId}/participants`, staffingRoleOptions: TASK_ROLES }
    : { kind: "contract", id: c.subjectId, serviceType: c.serviceType, stagesUrl: `/api/contracts/${c.subjectId}/process-stages`, participantsUrl: `/api/contracts/${c.subjectId}/participants`, staffingRoleOptions: SERVICE_ROLES };
}

function workerLabel(names: string[]): string {
  if (!names?.length) return "—";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} 외 ${names.length - 2}명`;
}

type ExecTab = "service" | "task" | "service-re" | "task-re";
const TABS: { value: ExecTab; label: string }[] = [
  { value: "service", label: "용역" },
  { value: "task", label: "Task" },
  { value: "service-re", label: "용역(재보고)" },
  { value: "task-re", label: "Task(재보고)" },
];

interface ReviewContext {
  isAdmin: boolean;
  deptId: string | null;
  deptName: string | null;
  departments?: { deptId: string; deptName: string }[];
}

export default function ExecWorkspace() {
  const { theme } = useCdashTheme();
  const [ctx, setCtx] = useState<ReviewContext | null>(null);
  const [deptId, setDeptId] = useState("");
  const [tab, setTab] = useState<ExecTab>("service");
  const [merged, setMerged] = useState<ExecReportCard[]>([]);
  const [reReported, setReReported] = useState<ExecReportCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<ReportSubject | null>(null);

  const deptTags: { deptId: string; deptName: string }[] = useMemo(() => {
    if (ctx?.isAdmin) return ctx.departments ?? [];
    if (ctx?.deptId) return [{ deptId: ctx.deptId, deptName: ctx.deptName ?? "내 부서" }];
    return [];
  }, [ctx]);

  useEffect(() => {
    fetch("/api/work-plan/review-context", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: ReviewContext) => {
        setCtx(d);
        if (!d.isAdmin) setDeptId(d.deptId ?? "");
        else if (d.departments?.length) setDeptId(d.departments[0].deptId);
      })
      .catch(() => setCtx({ isAdmin: false, deptId: null, deptName: null }));
  }, []);

  const loadCards = (dept: string) => {
    if (!dept) { setMerged([]); setReReported([]); return; }
    setLoading(true);
    Promise.all([
      fetch(`/api/work-plan/exec-cards?filter=merged&dept=${encodeURIComponent(dept)}`, { cache: "no-store" }).then((r) => r.json()).then((d) => d.cards ?? []).catch(() => []),
      fetch(`/api/work-plan/exec-cards?filter=re_reported&dept=${encodeURIComponent(dept)}`, { cache: "no-store" }).then((r) => r.json()).then((d) => d.cards ?? []).catch(() => []),
    ]).then(([m, rr]) => { setMerged(m); setReReported(rr); }).finally(() => setLoading(false));
  };

  useEffect(() => {
    setSelectedReportId(null); setSelectedSubject(null);
    loadCards(deptId);
  }, [deptId]);

  const select = (c: ExecReportCard) => { setSelectedReportId(c.reportId); setSelectedSubject(cardSubject(c)); };
  const onSaved = () => { loadCards(deptId); };

  const isRe = tab === "service-re" || tab === "task-re";
  const wantTask = tab === "task" || tab === "task-re";
  const cards = (isRe ? reReported : merged).filter((c) => (wantTask ? c.subjectKind === "task" : c.subjectKind === "contract"));

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<ShieldCheck className="w-5 h-5" />}
        eyebrow="Work · Executive"
        title="임원 검토·지시"
        subtitle="부서 통합 보고를 용역·Task별로 검토하고, 보완 요구·진행 촉구·추가보고 지시를 하달합니다."
      />

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[900px_1fr] gap-5">
        <section className="cd-card rounded-3xl p-3 cd-reveal delay-1 flex flex-col min-h-0">
          {/* 부서 태그 */}
          <div className="flex flex-wrap gap-1.5 px-1 mb-3">
            {deptTags.map((d) => (
              <button
                key={d.deptId}
                type="button"
                onClick={() => setDeptId(d.deptId)}
                className={cn(
                  "rounded-xl px-3 py-1.5 text-xs font-semibold border",
                  d.deptId === deptId ? "cd-fill-primary text-white border-transparent" : "cd-border-c cd-text-muted cd-row-hover"
                )}
              >
                {d.deptName}
              </button>
            ))}
          </div>

          {/* 탭 */}
          <div className="inline-flex self-start rounded-xl border cd-border-c overflow-hidden text-xs font-semibold mb-3 ml-1">
            {TABS.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setTab(t.value)}
                className={cn("px-3 py-1.5 border-l first:border-l-0 cd-border-c", tab === t.value ? "cd-fill-primary text-white" : "cd-text-muted")}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide flex flex-col gap-2 px-1 pb-1">
            {loading ? (
              <div className="p-8 text-center text-xs cd-text-faint">불러오는 중…</div>
            ) : cards.length === 0 ? (
              <div className="p-8 text-center text-xs cd-text-faint">
                {isRe ? "재보고된 건이 없습니다." : "통합 완료된 보고가 없습니다. (부서장 감독 → Merging 대상에서 통합 보고 생성)"}
              </div>
            ) : (
              cards.map((c) => {
                const active = c.reportId === selectedReportId;
                return (
                  <button
                    key={c.reportId}
                    type="button"
                    onClick={() => select(c)}
                    className={cn("text-left rounded-2xl border p-3 transition-colors", active ? "cd-tint-primary border-current cd-text-primary" : "cd-border-c cd-row-hover")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold cd-text truncate">{c.subjectLabel}</p>
                        <p className="text-[11px] cd-text-faint truncate">{c.subtitle}</p>
                        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                          <Kv label={c.subjectKind === "task" ? "착수일자" : "계약일"} value={c.subjectDate ?? "—"} />
                          <Kv label="공정단계" value={c.progressStage ?? "—"} />
                          <Kv label="진행률" value={c.progressPct != null ? `${Math.round(c.progressPct)}%` : "—"} />
                          <Kv label="수행인력" value={workerLabel(c.workerNames)} />
                        </div>
                      </div>
                      {/* 추진내역(요약) */}
                      <div className="w-[38%] shrink-0 rounded-xl border cd-border-c p-2">
                        <p className="text-[10px] font-semibold cd-text-faint mb-1">추진내역(요약)</p>
                        <p className="text-[11px] cd-text-muted leading-relaxed line-clamp-5">{c.summaryText || "—"}</p>
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className="text-[10px] cd-text-faint">{c.meetingLabel || "보고"} {c.meetingSeq ?? 1}회차</span>
                      {c.execStatus === "directed" && <span className="text-[10px] px-1.5 py-0.5 rounded cd-tint-primary cd-text-primary font-semibold">지시 하달됨</span>}
                      {c.execStatus === "re_reported" && <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: "var(--cd-success-soft)", color: "var(--cd-success)" }}>재보고</span>}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        {selectedSubject && selectedReportId ? (
          <ReportEditor
            key={`${selectedSubject.kind}:${selectedSubject.id}:${selectedReportId}`}
            subject={selectedSubject}
            reportId={selectedReportId}
            reporter={null}
            onSaved={onSaved}
            theme={theme}
            exec
          />
        ) : (
          <section className="cd-card rounded-3xl p-10 flex items-center justify-center text-center cd-reveal delay-2">
            <p className="text-sm cd-text-faint">{deptTags.length === 0 ? "조회 가능한 부서가 없습니다." : "좌측에서 용역·Task를 선택하면 검토·지시 화면이 표시됩니다."}</p>
          </section>
        )}
      </div>
    </div>
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
