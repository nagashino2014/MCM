"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Plus, Save, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PresetRow } from "@/lib/contracts/process-stage-presets";
import type { ContractStageRow } from "@/lib/contracts/process-stages";

interface StageDraft {
  key: string;
  stageCode: string | null;
  stageName: string;
  progressUnitPct: number;
  // 기존 계약 공정의 진행 상태(이름/단위만 바꿔 저장할 때 보존). 프리셋/신규 단계는 기본값.
  status: ContractStageRow["status"];
  progressPct: number;
  plannedDate: string | null;
  actualDate: string | null;
}

let seq = 0;
const nextKey = () => `pstg-${seq++}`;

export default function ProcessStageSettingModal({
  contractId,
  stagesUrl,
  serviceType,
  theme,
  onClose,
  onSaved,
}: {
  contractId: string;
  /** 공정표 API 베이스(GET/PUT). 미지정 시 계약 기준. (Task 는 /api/work-tasks/${id}/process-stages) */
  stagesUrl?: string;
  serviceType: string | null;
  theme: "light" | "dark";
  onClose: () => void;
  onSaved: () => void;
}) {
  const apiUrl = stagesUrl ?? `/api/contracts/${contractId}/process-stages`;
  const [mounted, setMounted] = useState(false);
  const [presets, setPresets] = useState<PresetRow[]>([]);
  const [presetId, setPresetId] = useState("");
  const [stages, setStages] = useState<StageDraft[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    fetch("/api/process-stage-presets", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const list: PresetRow[] = d.presets ?? [];
        setPresets(list);
        // 용역분류와 매칭되는 프리셋을 기본 선택값으로.
        const match = list.find((p) => p.serviceType && serviceType && p.serviceType === serviceType);
        if (match) setPresetId(match.presetId);
      })
      .catch(() => setPresets([]));

    fetch(apiUrl, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const loaded: StageDraft[] = (d.stages ?? []).map((s: ContractStageRow) => ({
          key: nextKey(),
          stageCode: s.stageCode,
          stageName: s.stageName,
          progressUnitPct: s.progressUnitPct ?? 10,
          status: s.status,
          progressPct: s.progressPct ?? 0,
          plannedDate: s.plannedDate,
          actualDate: s.actualDate,
        }));
        setStages(loaded);
        setActiveKey(loaded[0]?.key ?? null);
      })
      .catch(() => setStages([]));
  }, [contractId, serviceType]);

  const loadPreset = (id: string) => {
    setPresetId(id);
    const preset = presets.find((p) => p.presetId === id);
    if (!preset) return;
    const loaded: StageDraft[] = preset.items.map((it) => ({
      key: nextKey(),
      stageCode: it.stageCode,
      stageName: it.stageName,
      progressUnitPct: it.progressUnitPct ?? 10,
      status: "pending" as ContractStageRow["status"],
      progressPct: 0,
      plannedDate: null,
      actualDate: null,
    }));
    setStages(loaded);
    setActiveKey(loaded[0]?.key ?? null);
  };

  const update = (key: string, patch: Partial<StageDraft>) =>
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const addStage = () => {
    const s: StageDraft = {
      key: nextKey(), stageCode: null, stageName: "새 단계", progressUnitPct: 10,
      status: "pending", progressPct: 0, plannedDate: null, actualDate: null,
    };
    setStages((prev) => [...prev, s]);
    setActiveKey(s.key);
  };
  const removeStage = (key: string) =>
    setStages((prev) => {
      const next = prev.filter((s) => s.key !== key);
      if (activeKey === key) setActiveKey(next[0]?.key ?? null);
      return next;
    });

  const active = stages.find((s) => s.key === activeKey) ?? null;

  const saveAsPreset = async () => {
    const name = window.prompt("새 프리셋 이름을 입력하세요.", "");
    if (!name?.trim()) return;
    setMsg(null);
    const res = await fetch("/api/process-stage-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presetName: name.trim(),
        serviceType: serviceType || null,
        items: stages.filter((s) => s.stageName.trim()).map((s, i) => ({
          stageOrder: i + 1,
          stageCode: s.stageCode,
          stageName: s.stageName.trim(),
          progressUnitPct: s.progressUnitPct,
        })),
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setPresets(d.presets ?? presets);
      if (d.presetId) setPresetId(d.presetId);
      setMsg("프리셋으로 저장했습니다.");
    } else {
      setMsg(d?.error ?? "프리셋 저장 실패");
    }
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(apiUrl, {
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
              progressPct: s.progressPct,
              progressUnitPct: s.progressUnitPct,
              plannedDate: s.plannedDate,
              actualDate: s.actualDate,
            })),
        }),
      });
      if (!res.ok) throw new Error("공정표 저장에 실패했습니다.");
      onSaved();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="cdash-vars cd-fields-white fixed inset-0 z-[95] flex items-center justify-center p-4" data-theme={theme}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative cd-solid-bg border cd-border-c rounded-3xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b cd-border-c">
          <h2 className="text-lg font-bold cd-text">공정 단계 설정</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg cd-text-faint hover:cd-text" aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col gap-4">
          {/* 공정단계 추가/삭제 */}
          <div className="rounded-2xl border cd-border-c p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="font-bold cd-text text-sm">공정단계 추가/삭제</h3>
              <div className="flex items-center gap-2">
                <select className="cd-select text-xs" value={presetId} onChange={(e) => loadPreset(e.target.value)}>
                  <option value="">프리셋 선택…</option>
                  {presets.map((p) => (
                    <option key={p.presetId} value={p.presetId}>{p.presetName}</option>
                  ))}
                </select>
                <button type="button" onClick={saveAsPreset} className="cd-btn cd-btn-ghost rounded-lg px-2.5 py-1.5 text-xs cd-text-muted border cd-border-c">
                  프리셋으로 저장
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {stages.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setActiveKey(s.key)}
                  className={cn(
                    "group relative inline-flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs border text-left",
                    s.key === activeKey ? "cd-tint-primary border-current cd-text-primary" : "cd-border-c cd-row-hover"
                  )}
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "rgba(93,135,255,0.55)" }} />
                  <span className="truncate flex-1 cd-text">{s.stageName || "—"}</span>
                  <span
                    role="button"
                    tabIndex={-1}
                    onClick={(e) => { e.stopPropagation(); removeStage(s.key); }}
                    className="opacity-0 group-hover:opacity-100 shrink-0 cd-text-faint hover:cd-error-text"
                    aria-label="단계 삭제"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={addStage}
                className="inline-flex items-center justify-center gap-1 rounded-xl px-3 py-2.5 text-xs border cd-border-c cd-text-muted cd-row-hover"
              >
                <Plus className="w-3.5 h-3.5" /> 추가
              </button>
            </div>
            {active && (
              <input
                className="cd-input text-sm w-full mt-3"
                placeholder="단계명"
                value={active.stageName}
                onChange={(e) => update(active.key, { stageName: e.target.value })}
              />
            )}
          </div>

          {/* 진행율 단위 */}
          <div className="rounded-2xl border cd-border-c p-4">
            <h3 className="font-bold cd-text text-sm mb-3">진행율 단위</h3>
            {!active ? (
              <p className="text-xs cd-text-faint">위에서 단계를 선택하면 진행율 단위를 설정합니다.</p>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs cd-text-faint">선택 단계</span>
                <span className="text-sm font-semibold cd-text">{active.stageName || "—"}</span>
                <span className="ml-auto text-xs cd-text-faint">기본 10%</span>
                <ArrowRight className="w-4 h-4 cd-text-faint" />
                <label className="flex items-center gap-1.5">
                  <span className="text-xs cd-text-faint">변경값</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className="cd-input text-sm w-20 text-center"
                    value={active.progressUnitPct}
                    onChange={(e) => update(active.key, { progressUnitPct: Math.min(100, Math.max(1, Number(e.target.value) || 1)) })}
                  />
                  <span className="text-xs cd-text-faint">%</span>
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t cd-border-c">
          <span className="text-xs cd-text-faint">{msg}</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="cd-btn rounded-xl px-4 py-2 text-sm border cd-border-c cd-text-muted">취소</button>
            <button type="button" disabled={saving} onClick={save} className="rounded-xl px-4 py-2 text-sm text-white cd-fill-primary inline-flex items-center gap-1.5 disabled:opacity-50">
              <Save className="w-4 h-4" /> {saving ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
