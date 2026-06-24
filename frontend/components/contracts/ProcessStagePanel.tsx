"use client";

import { useEffect, useState } from "react";
import { GitCommitHorizontal, Plus, Save, Wand2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AutoDateInput } from "@/components/ui/AutoDateInput";

type StageStatus = "pending" | "in_progress" | "done";

interface StageDraft {
  key: string;
  stageId?: string;
  stageCode: string | null;
  stageName: string;
  status: StageStatus;
  plannedDate: string;
  actualDate: string;
  progressPct: number;
  note: string;
}

const STATUS_OPTIONS: { value: StageStatus; label: string }[] = [
  { value: "pending", label: "예정" },
  { value: "in_progress", label: "진행" },
  { value: "done", label: "완료" },
];
const STATUS_DOT: Record<StageStatus, string> = {
  done: "#1D9E75",
  in_progress: "#EF9F27",
  pending: "transparent",
};

let seq = 0;
const nextKey = () => `stg-${seq++}`;

export default function ProcessStagePanel({
  contractId,
  serviceType,
}: {
  contractId: string;
  serviceType: string;
}) {
  const [stages, setStages] = useState<StageDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!contractId) return;
    fetch(`/api/contracts/${contractId}/process-stages`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) =>
        setStages(
          (d.stages ?? []).map((s: Omit<StageDraft, "key" | "plannedDate" | "actualDate"> & { plannedDate: string | null; actualDate: string | null }) => ({
            key: nextKey(),
            stageId: s.stageId,
            stageCode: s.stageCode,
            stageName: s.stageName,
            status: s.status,
            plannedDate: s.plannedDate ?? "",
            actualDate: s.actualDate ?? "",
            progressPct: s.progressPct ?? 0,
            note: s.note ?? "",
          }))
        )
      )
      .catch(() => setStages([]));
  }, [contractId]);

  const applyTemplate = async () => {
    setMsg(null);
    const res = await fetch(`/api/process-stage-templates?serviceType=${encodeURIComponent(serviceType)}`, { cache: "no-store" });
    const d = await res.json();
    const templates: { stageCode: string; stageName: string }[] = d.stages ?? [];
    if (templates.length === 0) {
      setMsg("이 용역분류의 표준 공정이 없습니다.");
      return;
    }
    setStages(
      templates.map((t) => ({
        key: nextKey(),
        stageCode: t.stageCode,
        stageName: t.stageName,
        status: "pending" as StageStatus,
        plannedDate: "",
        actualDate: "",
        progressPct: 0,
        note: "",
      }))
    );
  };

  const update = (key: string, patch: Partial<StageDraft>) =>
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const addStage = () =>
    setStages((prev) => [
      ...prev,
      { key: nextKey(), stageCode: null, stageName: "", status: "pending", plannedDate: "", actualDate: "", progressPct: 0, note: "" },
    ]);
  const removeStage = (key: string) => setStages((prev) => prev.filter((s) => s.key !== key));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/contracts/${contractId}/process-stages`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stages: stages
            .filter((s) => s.stageName.trim())
            .map((s, i) => ({
              stageOrder: i + 1,
              stageCode: s.stageCode,
              stageName: s.stageName.trim(),
              status: s.status,
              plannedDate: s.plannedDate || null,
              actualDate: s.actualDate || null,
              progressPct: Number(s.progressPct) || 0,
              note: s.note || null,
            })),
        }),
      });
      if (!res.ok) throw new Error("공정표 저장에 실패했습니다.");
      setMsg("저장되었습니다.");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border cd-border-c cd-surface-bg p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-bold cd-text flex items-center gap-2">
          <GitCommitHorizontal className="w-4 h-4 cd-text-primary" /> 용역 공정표
          <span className="text-[11px] font-normal cd-text-faint">{stages.length}단계</span>
        </h3>
        <div className="flex items-center gap-2">
          {msg && <span className="text-[11px] cd-text-faint">{msg}</span>}
          <button type="button" onClick={applyTemplate} className="cd-btn cd-btn-ghost rounded-lg px-3 py-1.5 text-xs cd-text-muted inline-flex items-center gap-1">
            <Wand2 className="w-3.5 h-3.5" /> 표준 공정 적용
          </button>
          <button type="button" disabled={saving} onClick={save} className="rounded-lg px-3 py-1.5 text-xs text-white cd-fill-primary inline-flex items-center gap-1 disabled:opacity-50">
            <Save className="w-3.5 h-3.5" /> {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* 공정 진행 인포그래픽 */}
      {stages.length > 0 && (
        <div className="flex flex-wrap items-start gap-x-1.5 gap-y-2 mb-4 px-1">
          {stages.map((s) => (
            <div key={`info-${s.key}`} className="flex flex-col items-center gap-1 w-[58px]">
              <span
                className="w-3 h-3 rounded-full"
                style={{
                  background: STATUS_DOT[s.status],
                  border: s.status === "pending" ? "1.5px solid var(--cd-border)" : `2px solid ${s.status === "in_progress" ? "#854F0B" : "#0F6E56"}`,
                }}
              />
              <span className="text-[10px] cd-text-faint text-center leading-tight truncate w-full">{s.stageName || "—"}</span>
              {s.status === "in_progress" && <span className="text-[9px] cd-text-primary font-bold">{Math.round(s.progressPct)}%</span>}
            </div>
          ))}
        </div>
      )}

      {/* 단계 편집 리스트 */}
      <div className="grid gap-2">
        {stages.length === 0 ? (
          <p className="p-5 text-center text-sm cd-text-faint rounded-xl border cd-border-c">
            공정 단계가 없습니다. [표준 공정 적용]으로 시작하거나 [단계 추가]로 직접 구성하세요.
          </p>
        ) : (
          stages.map((s, index) => (
            <div key={s.key} className="rounded-xl border cd-border-c p-2.5 flex flex-wrap items-center gap-2">
              <span className="w-5 h-5 shrink-0 rounded cd-soft-primary text-[10px] font-bold flex items-center justify-center">{index + 1}</span>
              <input
                className="cd-input text-xs flex-1 min-w-[120px] font-semibold"
                placeholder="단계명"
                value={s.stageName}
                onChange={(e) => update(s.key, { stageName: e.target.value })}
              />
              <select className="cd-select text-xs shrink-0 w-16" value={s.status} onChange={(e) => update(s.key, { status: e.target.value as StageStatus })}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {s.status === "in_progress" && (
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="cd-input text-xs shrink-0 w-16"
                  placeholder="%"
                  value={s.progressPct}
                  onChange={(e) => update(s.key, { progressPct: Number(e.target.value) })}
                />
              )}
              <AutoDateInput className="cd-input text-xs shrink-0 w-28" placeholder="예정일" value={s.plannedDate} onChange={(v) => update(s.key, { plannedDate: v })} />
              <AutoDateInput className="cd-input text-xs shrink-0 w-28" placeholder="완료일" value={s.actualDate} onChange={(v) => update(s.key, { actualDate: v })} />
              <input
                className="cd-input text-xs flex-1 min-w-[120px]"
                placeholder="활동 메모 (예: 대기·수질 현장 실측)"
                value={s.note}
                onChange={(e) => update(s.key, { note: e.target.value })}
              />
              <button type="button" className="shrink-0 p-1.5 rounded-lg cd-text-faint hover:cd-error-text" title="단계 삭제" onClick={() => removeStage(s.key)}>
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="mt-2">
        <button type="button" onClick={addStage} className="cd-btn cd-btn-ghost rounded-lg px-3 py-1.5 text-xs cd-text-muted inline-flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" /> 단계 추가
        </button>
      </div>
    </div>
  );
}
