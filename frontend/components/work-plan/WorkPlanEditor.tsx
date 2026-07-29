"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ClipboardList, FileSignature, Plus, Save, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import ContractPickerModal from "@/components/work-plan/ContractPickerModal";
import IssuePanel from "@/components/work-plan/IssuePanel";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import type { OrganizationSnapshot } from "@/lib/admin/organization";
import type { WorkPlanReportDetail, WorkPlanTemplateRow } from "@/lib/work-plan/reports";
import "@/components/cdash/cdash.css";

type SubjectKind = "contract" | "free";

interface RowDraft {
  key: string;
  itemId?: string;
  subjectKind: SubjectKind;
  contractId: string;
  contractTitle: string;
  category: string;
  subjectLabel: string;
  statusText: string;
  progressText: string;
  planText: string;
  managerEmployeeId: string;
  primaryEmployeeId: string;
  secondaryEmployeeId: string;
  remarks: string;
}

interface WorkPlanEditorProps {
  mode: "new" | "edit";
  initialReport?: WorkPlanReportDetail | null;
  templates: WorkPlanTemplateRow[];
  organization: OrganizationSnapshot;
}

let keySeq = 0;
const nextKey = () => `row-${keySeq++}`;

function emptyRow(): RowDraft {
  return {
    key: nextKey(),
    subjectKind: "contract",
    contractId: "",
    contractTitle: "",
    category: "",
    subjectLabel: "",
    statusText: "",
    progressText: "",
    planText: "",
    managerEmployeeId: "",
    primaryEmployeeId: "",
    secondaryEmployeeId: "",
    remarks: "",
  };
}

function thisWeekRange(): { start: string; end: string } {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day - 1));
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(monday), end: fmt(friday) };
}

export default function WorkPlanEditor({
  mode,
  initialReport,
  templates,
  organization,
}: WorkPlanEditorProps) {
  const router = useRouter();
  const { theme } = useCdashTheme();
  const week = useMemo(() => thisWeekRange(), []);

  const [deptId, setDeptId] = useState(initialReport?.deptId ?? "");
  const [templateId, setTemplateId] = useState(
    initialReport?.templateId ?? templates[0]?.templateId ?? ""
  );
  const [reportKind, setReportKind] = useState(initialReport?.reportKind ?? "dept_consolidated");
  const [periodStart, setPeriodStart] = useState(initialReport?.periodStart ?? week.start);
  const [periodEnd, setPeriodEnd] = useState(initialReport?.periodEnd ?? week.end);
  const [reportDate, setReportDate] = useState(initialReport?.reportDate ?? week.end);
  const [title, setTitle] = useState(initialReport?.title ?? "");
  const [rows, setRows] = useState<RowDraft[]>(() =>
    initialReport?.items?.length
      ? initialReport.items.map((item) => {
          const kind: SubjectKind = item.subjectKind === "contract" ? "contract" : "free";
          return {
            key: nextKey(),
            itemId: item.itemId,
            subjectKind: kind,
            contractId: item.contractId ?? "",
            contractTitle: kind === "contract" ? item.subjectLabel ?? "" : "",
            category: item.category ?? "",
            subjectLabel: kind === "free" ? item.subjectLabel ?? "" : "",
            statusText: item.statusText ?? "",
            progressText: item.progressText ?? "",
            planText: item.planText ?? "",
            managerEmployeeId: item.managerEmployeeId ?? "",
            primaryEmployeeId: item.primaryEmployeeId ?? "",
            secondaryEmployeeId: item.secondaryEmployeeId ?? "",
            remarks: item.remarks ?? "",
          };
        })
      : [emptyRow()]
  );
  const [pickerRowKey, setPickerRowKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLocked = initialReport?.status === "submitted" || !!initialReport?.mergeLockedAt;

  const departments = useMemo(
    () => organization.departments.filter((d) => d.isActive).sort((a, b) => a.displayOrder - b.displayOrder),
    [organization.departments]
  );
  const deptName = departments.find((d) => d.deptId === deptId)?.deptName;
  const activeTemplate = templates.find((t) => t.templateId === templateId) ?? null;
  const unitType = activeTemplate?.unitType ?? "service";
  const showPlan = unitType !== "task";
  const showSecondary = unitType === "service";

  const employeeOptions = useMemo(() => {
    const active = organization.employees.filter((e) => e.status === "active");
    const scoped = deptId ? active.filter((e) => e.deptId === deptId) : active;
    return (scoped.length ? scoped : active).sort(
      (a, b) => (b.positionRankOrder ?? -1) - (a.positionRankOrder ?? -1) || a.name.localeCompare(b.name)
    );
  }, [organization.employees, deptId]);

  const updateRow = (key: string, patch: Partial<RowDraft>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => setRows((prev) => [...prev, emptyRow()]);
  const removeRow = (key: string) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));

  const save = async (status: "draft" | "submitted") => {
    setError(null);
    if (!deptId) {
      setError("수행 부서를 선택하세요.");
      return;
    }
    if (!periodStart || !periodEnd) {
      setError("보고 기간을 입력하세요.");
      return;
    }

    const kept = rows.filter((r) =>
      r.subjectKind === "contract"
        ? r.contractId
        : r.subjectLabel.trim() || r.progressText.trim() || r.category.trim()
    );
    const missingContract = rows.some((r) => r.subjectKind === "contract" && !r.contractId && (r.progressText.trim() || r.statusText.trim()));
    if (missingContract) {
      setError("용역 항목의 계약을 선택하세요.");
      return;
    }
    if (status === "submitted" && kept.length === 0) {
      setError("제출하려면 항목을 1건 이상 입력하세요.");
      return;
    }

    const items = kept.map((r, index) => ({
      itemId: r.itemId,
      displayOrder: (index + 1) * 10,
      subjectKind: r.subjectKind,
      contractId: r.subjectKind === "contract" ? r.contractId || null : null,
      subjectLabel: r.subjectKind === "contract" ? r.contractTitle || null : r.subjectLabel.trim() || null,
      category: r.subjectKind === "free" ? r.category.trim() || null : null,
      statusText: r.statusText.trim() || null,
      progressText: r.progressText.trim() || null,
      planText: r.planText.trim() || null,
      managerEmployeeId: r.managerEmployeeId || null,
      primaryEmployeeId: r.primaryEmployeeId || null,
      secondaryEmployeeId: r.secondaryEmployeeId || null,
      remarks: r.remarks.trim() || null,
    }));

    setSaving(true);
    try {
      const payload = {
        deptId,
        templateId: templateId || null,
        reportPeriod: "weekly",
        reportKind,
        periodStart,
        periodEnd,
        reportDate: reportDate || null,
        title: title.trim() || null,
        status,
        items,
      };
      const url = mode === "edit" && initialReport ? `/api/work-plan/${initialReport.reportId}` : "/api/work-plan";
      const res = await fetch(url, {
        method: mode === "edit" && initialReport ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "저장에 실패했습니다.");
      }
      const body = (await res.json()) as { reportId: string };
      router.push(`/work-plan/${body.reportId}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<ClipboardList className="w-5 h-5" />}
        eyebrow="Work · Reporting"
        title={mode === "new" ? "업무추진계획 작성" : "업무추진계획 편집"}
        subtitle="수행 부서를 선택하고 용역(계약) 또는 업무단위별 추진내역과 담당자를 입력합니다."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push("/work-plan")}
              className="cd-btn rounded-xl px-3 py-2 text-sm border cd-border-c cd-text-muted inline-flex items-center gap-1.5"
            >
              <ArrowLeft className="w-4 h-4" /> 목록
            </button>
          </div>
        }
      />

      {isLocked && (
        <div className="rounded-2xl border cd-border-c cd-tint-primary px-4 py-2.5 text-xs cd-text">
          제출 완료(잠금)된 보고서입니다. 잠금 상태 수정은 권한과 사유 입력이 필요합니다. (후속 단계)
        </div>
      )}

      <section className="cd-card rounded-3xl p-5 cd-reveal delay-1">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <Field label="수행 부서 *">
            <select className="cd-select text-sm w-full" value={deptId} onChange={(e) => setDeptId(e.target.value)}>
              <option value="">부서 선택</option>
              {departments.map((d) => (
                <option key={d.deptId} value={d.deptId}>{d.deptName}</option>
              ))}
            </select>
          </Field>
          <Field label="보고 양식">
            <select className="cd-select text-sm w-full" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((t) => (
                <option key={t.templateId} value={t.templateId}>{t.templateName}</option>
              ))}
            </select>
          </Field>
          <Field label="보고 종류">
            <select className="cd-select text-sm w-full" value={reportKind} onChange={(e) => setReportKind(e.target.value)}>
              <option value="dept_consolidated">부서 통합 보고</option>
              <option value="staff_input">1차 보고 (담당자)</option>
            </select>
          </Field>
          <Field label="보고 기간 * (월~금 자동, 연휴 등은 수동 조정)">
            <div className="flex items-center gap-1.5">
              <AutoDateInput className="cd-input text-sm flex-1" value={periodStart} onChange={setPeriodStart} />
              <span className="cd-text-faint text-xs">~</span>
              <AutoDateInput className="cd-input text-sm flex-1" value={periodEnd} onChange={setPeriodEnd} />
            </div>
          </Field>
          <Field label="보고 회의 일자">
            <AutoDateInput className="cd-input text-sm w-full" value={reportDate} onChange={setReportDate} />
          </Field>
          <Field label="제목 (선택)" className="md:col-span-2 xl:col-span-4">
            <input className="cd-input text-sm w-full" placeholder="미입력 시 부서·기간으로 자동 표시" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="cd-card rounded-3xl p-5 cd-reveal delay-2 flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold cd-text flex items-center gap-2">
            <ClipboardList className="w-4 h-4 cd-text-primary" />
            추진 항목
            <span className="text-[11px] font-normal cd-text-faint">{rows.length}건</span>
          </h2>
          <button type="button" className="cd-btn cd-btn-ghost rounded-lg px-3 py-1.5 text-xs cd-text-muted inline-flex items-center gap-1" onClick={addRow}>
            <Plus className="w-3.5 h-3.5" /> 항목 추가
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide grid gap-3">
          {rows.map((row, index) => (
            <div key={row.key} className="rounded-2xl border cd-border-c p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 shrink-0 rounded-lg cd-soft-primary text-[11px] font-bold flex items-center justify-center">{index + 1}</span>

                {/* 보고 단위 토글 */}
                <div className="inline-flex shrink-0 rounded-lg border cd-border-c overflow-hidden text-[11px] font-semibold">
                  <button
                    type="button"
                    className={cn("px-2.5 py-1.5", row.subjectKind === "contract" ? "cd-fill-primary text-white" : "cd-text-muted")}
                    onClick={() => updateRow(row.key, { subjectKind: "contract" })}
                  >
                    용역
                  </button>
                  <button
                    type="button"
                    className={cn("px-2.5 py-1.5", row.subjectKind === "free" ? "cd-fill-primary text-white" : "cd-text-muted")}
                    onClick={() => updateRow(row.key, { subjectKind: "free" })}
                  >
                    업무단위
                  </button>
                </div>

                {row.subjectKind === "contract" ? (
                  <button
                    type="button"
                    disabled={!deptId}
                    onClick={() => setPickerRowKey(row.key)}
                    className={cn(
                      "flex-1 min-w-0 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm text-left",
                      row.contractId ? "cd-border-c cd-text" : "cd-border-c cd-text-faint",
                      !deptId && "opacity-50 cursor-not-allowed"
                    )}
                    title={!deptId ? "수행 부서를 먼저 선택하세요" : "계약 선택"}
                  >
                    <FileSignature className="w-4 h-4 cd-text-primary shrink-0" />
                    <span className="truncate">{row.contractTitle || (deptId ? "계약 선택…" : "수행 부서 먼저 선택")}</span>
                  </button>
                ) : (
                  <input
                    className="cd-input text-sm flex-1 font-semibold"
                    placeholder="업무명 (예: 앱 개발, 부가세 신고)"
                    value={row.subjectLabel}
                    onChange={(e) => updateRow(row.key, { subjectLabel: e.target.value })}
                  />
                )}

                {row.subjectKind === "free" && (
                  <input
                    className="cd-input text-sm w-28 shrink-0"
                    placeholder="구분"
                    value={row.category}
                    onChange={(e) => updateRow(row.key, { category: e.target.value })}
                  />
                )}

                <button type="button" className="shrink-0 p-1.5 rounded-lg cd-text-faint hover:cd-error-text" title="항목 삭제" onClick={() => removeRow(row.key)}>
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Field label="진행상황">
                  <input className="cd-input text-sm w-full" placeholder="계약완료 / 자료수집 등" value={row.statusText} onChange={(e) => updateRow(row.key, { statusText: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="정 담당">
                    <EmployeeSelect value={row.primaryEmployeeId} options={employeeOptions} onChange={(v) => updateRow(row.key, { primaryEmployeeId: v })} />
                  </Field>
                  {showSecondary ? (
                    <Field label="부 담당">
                      <EmployeeSelect value={row.secondaryEmployeeId} options={employeeOptions} onChange={(v) => updateRow(row.key, { secondaryEmployeeId: v })} />
                    </Field>
                  ) : (
                    <Field label="관리자">
                      <EmployeeSelect value={row.managerEmployeeId} options={employeeOptions} onChange={(v) => updateRow(row.key, { managerEmployeeId: v })} />
                    </Field>
                  )}
                </div>
                <Field label="추진내역 (이번 기간)">
                  <textarea className="cd-input text-sm w-full min-h-[64px] resize-y" value={row.progressText} onChange={(e) => updateRow(row.key, { progressText: e.target.value })} />
                </Field>
                {showPlan && (
                  <Field label="추진계획 (다음 기간)">
                    <textarea className="cd-input text-sm w-full min-h-[64px] resize-y" value={row.planText} onChange={(e) => updateRow(row.key, { planText: e.target.value })} />
                  </Field>
                )}
                {showSecondary && (
                  <Field label="관리자">
                    <EmployeeSelect value={row.managerEmployeeId} options={employeeOptions} onChange={(v) => updateRow(row.key, { managerEmployeeId: v })} />
                  </Field>
                )}
                <Field label="비고">
                  <input className="cd-input text-sm w-full" value={row.remarks} onChange={(e) => updateRow(row.key, { remarks: e.target.value })} />
                </Field>
              </div>

              {row.subjectKind === "contract" && row.contractId && (
                <div className="mt-3 pt-3 border-t cd-border-c">
                  <IssuePanel contractId={row.contractId} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs cd-error-text">{error}</div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={saving} className="cd-btn rounded-xl px-4 py-2 text-sm border cd-border-c cd-text-muted inline-flex items-center gap-1.5 disabled:opacity-50" onClick={() => save("draft")}>
            <Save className="w-4 h-4" /> 임시 저장
          </button>
          <button type="button" disabled={saving} className="rounded-xl px-4 py-2 text-sm text-white cd-fill-primary inline-flex items-center gap-1.5 disabled:opacity-50" onClick={() => save("submitted")}>
            <Send className="w-4 h-4" /> {saving ? "저장 중..." : "제출"}
          </button>
        </div>
      </div>

      <ContractPickerModal
        deptId={deptId}
        deptName={deptName}
        open={pickerRowKey !== null}
        onClose={() => setPickerRowKey(null)}
        onSelect={(node) => {
          if (pickerRowKey) updateRow(pickerRowKey, { contractId: node.contractId, contractTitle: node.contractTitle });
        }}
      />
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-[11px] font-semibold cd-text-faint">{label}</span>
      {children}
    </label>
  );
}

function EmployeeSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: OrganizationSnapshot["employees"];
  onChange: (value: string) => void;
}) {
  return (
    <select className="cd-select text-sm w-full" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">미지정</option>
      {options.map((e) => (
        <option key={e.employeeId} value={e.employeeId}>
          {e.name}
          {e.positionName ? ` ${e.positionName}` : ""}
        </option>
      ))}
    </select>
  );
}
