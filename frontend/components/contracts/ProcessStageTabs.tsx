"use client";

import { useEffect, useState } from "react";
import { Plus, Save, Trash2, Wand2 } from "lucide-react";
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

export default function ProcessStageTabs({
  contractId,
  serviceType,
}: {
  contractId: string;
  serviceType: string;
}) {
  const [stages, setStages] = useState<StageDraft[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!contractId) return;
    fetch(`/api/contracts/${contractId}/process-stages`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const loaded: StageDraft[] = (d.stages ?? []).map(
          (s: Omit<StageDraft, "key" | "plannedDate" | "actualDate"> & { plannedDate: string | null; actualDate: string | null }) => ({
            key: nextKey(),
            stageId: s.stageId,
            stageCode: s.stageCode,
            stageName: s.stageName,
            status: s.status,
            plannedDate: s.plannedDate ?? "",
            actualDate: s.actualDate ?? "",
            progressPct: s.progressPct ?? 0,
            note: s.note ?? "",
          })
        );
        setStages(loaded);
        setActiveKey(loaded[0]?.key ?? null);
      })
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
    const built = templates.map((t) => ({
      key: nextKey(),
      stageCode: t.stageCode,
      stageName: t.stageName,
      status: "pending" as StageStatus,
      plannedDate: "",
      actualDate: "",
      progressPct: 0,
      note: "",
    }));
    setStages(built);
    setActiveKey(built[0]?.key ?? null);
  };

  const update = (key: string, patch: Partial<StageDraft>) =>
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const addStage = () => {
    const s: StageDraft = { key: nextKey(), stageCode: null, stageName: "새 단계", status: "pending", plannedDate: "", actualDate: "", progressPct: 0, note: "" };
    setStages((prev) => [...prev, s]);
    setActiveKey(s.key);
  };
  const removeStage = (key: string) =>
    setStages((prev) => {
      const next = prev.filter((s) => s.key !== key);
      if (activeKey === key) setActiveKey(next[0]?.key ?? null);
      return next;
    });

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

  const active = stages.find((s) => s.key === activeKey) ?? null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <h3 className="font-bold cd-text">용역 공정표 <span className="text-[11px] font-normal cd-text-faint">{stages.length}단계</span></h3>
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

      {/* 단계 탭바 */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {stages.map((s, i) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setActiveKey(s.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs border",
              s.key === activeKey ? "cd-fill-primary text-white border-transparent" : "cd-border-c cd-text-muted cd-row-hover"
            )}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{
                background: STATUS_DOT[s.status],
                border: s.status === "pending" ? "1.5px solid currentColor" : "none",
              }}
            />
            <span className="font-semibold">{i + 1}</span>
            <span className="truncate max-w-[88px]">{s.stageName || "—"}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={addStage}
          className="inline-flex items-center justify-center rounded-lg w-8 h-8 border cd-border-c cd-text-muted cd-row-hover"
          aria-label="단계 추가"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* 활성 단계 폼 */}
      {!active ? (
        <p className="p-6 text-center text-sm cd-text-faint rounded-xl border cd-border-c">
          공정 단계가 없습니다. [표준 공정 적용] 또는 우측 + 로 단계를 추가하세요.
        </p>
      ) : (
        <div className="rounded-2xl border cd-border-c p-4 grid gap-3">
          <Field label="단계명">
            <input className="cd-input text-sm w-full" value={active.stageName} onChange={(e) => update(active.key, { stageName: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="상태">
              <select
                className="cd-select text-sm w-full"
                value={active.status}
                onChange={(e) => {
                  const status = e.target.value as StageStatus;
                  const patch: Partial<StageDraft> = { status };
                  // 예정 → 0%, 완료 → 100% 로 진행율 자동 동기화 (진행은 사용자 입력값 유지)
                  if (status === "pending") patch.progressPct = 0;
                  else if (status === "done") patch.progressPct = 100;
                  update(active.key, patch);
                }}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label="진행율">
              <div className="flex flex-col gap-1 pt-1.5">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={10}
                  className="w-full cursor-pointer"
                  style={{ accentColor: "#8aa9ff" }}
                  value={active.progressPct}
                  onChange={(e) => update(active.key, { progressPct: Number(e.target.value) })}
                />
                <div className="flex items-center justify-between text-[10px] cd-text-faint">
                  <span>0%</span>
                  <span className="text-xs font-bold cd-text-primary">{active.progressPct}%</span>
                  <span>100%</span>
                </div>
              </div>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="예정일">
              <AutoDateInput className="cd-input text-sm w-full" value={active.plannedDate} onChange={(v) => update(active.key, { plannedDate: v })} />
            </Field>
            <Field label="완료일">
              <AutoDateInput className="cd-input text-sm w-full" value={active.actualDate} onChange={(v) => update(active.key, { actualDate: v })} />
            </Field>
          </div>
          <Field label="활동 메모">
            <input className="cd-input text-sm w-full" placeholder="예: 대기·수질 현장 실측" value={active.note} onChange={(e) => update(active.key, { note: e.target.value })} />
          </Field>
          <div className="flex justify-end">
            <button type="button" onClick={() => removeStage(active.key)} className="cd-btn cd-btn-ghost rounded-lg px-3 py-1.5 text-xs cd-error-text inline-flex items-center gap-1">
              <Trash2 className="w-3.5 h-3.5" /> 이 단계 삭제
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold cd-text-faint">{label}</span>
      {children}
    </label>
  );
}
