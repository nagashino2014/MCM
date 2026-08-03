"use client";

// 자산 관리(/assets, asset.manage) — 예약 가능 자산(법인차량·회의실 등) 마스터 편집.
// 차량은 출장신청서 asset_select 선택지의 원본이 되고, 회의실 등은 이용 현황 화면에서
// 직접 예약된다. 예약 이력이 있는 자산은 삭제 대신 비활성화된다.
// 설계: docs/groupware-ux-overhaul-blueprint.md §7 (일정/캘린더 — 회의실 예약).

import { useCallback, useEffect, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { ASSET_KIND_LABELS, type AssetKind, type ReservableAsset } from "@/lib/assets/types";
import "@/components/cdash/cdash.css";

const KINDS: AssetKind[] = ["vehicle", "room", "etc"];

interface DraftAsset {
  kind: AssetKind;
  name: string;
  description: string;
  sortOrder: number;
  active: boolean;
}

const emptyDraft = (): DraftAsset => ({ kind: "vehicle", name: "", description: "", sortOrder: 0, active: true });

export function AssetBoard() {
  const { theme } = useCdashTheme();
  const [assets, setAssets] = useState<ReservableAsset[]>([]);
  const [drafts, setDrafts] = useState<Record<string, DraftAsset>>({});
  const [creating, setCreating] = useState<DraftAsset>(emptyDraft());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // assetId | "new"
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/assets", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "자산 목록을 불러오지 못했습니다.");
      const list: ReservableAsset[] = data.assets ?? [];
      setAssets(list);
      setDrafts(
        Object.fromEntries(
          list.map((a) => [
            a.assetId,
            { kind: a.kind, name: a.name, description: a.description ?? "", sortOrder: a.sortOrder, active: a.active },
          ])
        )
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const setDraft = (assetId: string, patch: Partial<DraftAsset>) =>
    setDrafts((prev) => ({ ...prev, [assetId]: { ...prev[assetId], ...patch } }));

  const isDirty = (a: ReservableAsset): boolean => {
    const d = drafts[a.assetId];
    if (!d) return false;
    return (
      d.kind !== a.kind ||
      d.name !== a.name ||
      d.description !== (a.description ?? "") ||
      d.sortOrder !== a.sortOrder ||
      d.active !== a.active
    );
  };

  const saveRow = async (assetId: string) => {
    const d = drafts[assetId];
    if (!d) return;
    setBusy(assetId);
    try {
      const res = await fetch(`/api/assets/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: d.kind,
          name: d.name,
          description: d.description || null,
          sortOrder: d.sortOrder,
          active: d.active,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "저장 실패");
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const removeRow = async (a: ReservableAsset) => {
    if (!confirm(`'${a.name}' 자산을 삭제할까요? 예약 이력이 있으면 비활성화로 전환됩니다.`)) return;
    setBusy(a.assetId);
    try {
      const res = await fetch(`/api/assets/${a.assetId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "삭제 실패");
      if (data.deactivated) alert("예약 이력이 있어 비활성화로 전환했습니다.");
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (!creating.name.trim()) {
      alert("자산 이름을 입력하세요.");
      return;
    }
    setBusy("new");
    try {
      const res = await fetch("/api/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: creating.kind,
          name: creating.name,
          description: creating.description || null,
          sortOrder: creating.sortOrder,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "등록 실패");
      setCreating(emptyDraft());
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const kindSelect = (value: AssetKind, onChange: (k: AssetKind) => void) => (
    <select className="cd-select" style={{ width: 110 }} value={value} onChange={(e) => onChange(e.target.value as AssetKind)}>
      {KINDS.map((k) => (
        <option key={k} value={k}>
          {ASSET_KIND_LABELS[k]}
        </option>
      ))}
    </select>
  );

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        title="자산 관리"
        meta={`${assets.length}개 자산 · 사용 ${assets.filter((a) => a.active).length}`}
      />
      {error && <p className="text-sm cd-error-text">{error}</p>}

      {loading ? (
        <p className="text-sm cd-text-faint">불러오는 중입니다.</p>
      ) : (
        <div className="cd-card p-5 gap-3 overflow-y-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left cd-text-faint text-[11px]">
                  <th className="py-1.5 pr-2 font-semibold">종류</th>
                  <th className="py-1.5 pr-2 font-semibold">이름</th>
                  <th className="py-1.5 pr-2 font-semibold">설명</th>
                  <th className="py-1.5 pr-2 font-semibold">순서</th>
                  <th className="py-1.5 pr-2 font-semibold">사용</th>
                  <th className="py-1.5 font-semibold">동작</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const d = drafts[a.assetId];
                  if (!d) return null;
                  return (
                    <tr key={a.assetId} className="border-t cd-border-c">
                      <td className="py-1 pr-2">{kindSelect(d.kind, (k) => setDraft(a.assetId, { kind: k }))}</td>
                      <td className="py-1 pr-2">
                        <input
                          className="cd-input"
                          style={{ width: 160 }}
                          value={d.name}
                          placeholder="니로 / K8 / 회의실"
                          onChange={(e) => setDraft(a.assetId, { name: e.target.value })}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          className="cd-input w-full min-w-[160px]"
                          value={d.description}
                          onChange={(e) => setDraft(a.assetId, { description: e.target.value })}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        <input
                          className="cd-input text-right"
                          style={{ width: 64 }}
                          inputMode="numeric"
                          value={d.sortOrder}
                          onChange={(e) => setDraft(a.assetId, { sortOrder: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                        />
                      </td>
                      <td className="py-1 pr-2 text-center">
                        <input type="checkbox" checked={d.active} onChange={(e) => setDraft(a.assetId, { active: e.target.checked })} />
                      </td>
                      <td className="py-1">
                        <span className="flex items-center gap-1.5">
                          <button
                            type="button"
                            className="cd-btn rounded-lg border cd-border-c px-2 py-1 text-[11px] flex items-center gap-1 disabled:opacity-40"
                            disabled={!isDirty(a) || busy === a.assetId}
                            onClick={() => saveRow(a.assetId)}
                          >
                            <Save className="w-3 h-3" /> 저장
                          </button>
                          <button
                            type="button"
                            className="cd-text-faint hover:cd-error-text disabled:opacity-40"
                            title="삭제"
                            disabled={busy === a.assetId}
                            onClick={() => removeRow(a)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {assets.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-[12.5px] cd-text-faint">
                      등록된 자산이 없습니다.
                    </td>
                  </tr>
                )}
                {/* 신규 등록 행 */}
                <tr className="border-t cd-border-c">
                  <td className="py-2 pr-2">{kindSelect(creating.kind, (k) => setCreating((p) => ({ ...p, kind: k })))}</td>
                  <td className="py-2 pr-2">
                    <input
                      className="cd-input"
                      style={{ width: 160 }}
                      value={creating.name}
                      placeholder="새 자산 이름"
                      onChange={(e) => setCreating((p) => ({ ...p, name: e.target.value }))}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      className="cd-input w-full min-w-[160px]"
                      value={creating.description}
                      onChange={(e) => setCreating((p) => ({ ...p, description: e.target.value }))}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      className="cd-input text-right"
                      style={{ width: 64 }}
                      inputMode="numeric"
                      value={creating.sortOrder}
                      onChange={(e) => setCreating((p) => ({ ...p, sortOrder: Number(e.target.value.replace(/\D/g, "")) || 0 }))}
                    />
                  </td>
                  <td className="py-2 pr-2 text-center cd-text-faint text-[11px]">—</td>
                  <td className="py-2">
                    <button
                      type="button"
                      className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-[11px] font-semibold flex items-center gap-1 disabled:opacity-50"
                      disabled={busy === "new"}
                      onClick={create}
                    >
                      <Plus className="w-3 h-3" /> 등록
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[10.5px] cd-text-faint">
            법인차량은 출장신청서의 이용차량 선택지로 나타나고, 회의실·기타 자산은 이용 현황 화면에서 직접 예약합니다.
            비활성 자산은 선택지·예약에서 숨겨지며, 예약 이력이 있는 자산은 삭제 대신 비활성화됩니다.
          </p>
        </div>
      )}
    </div>
  );
}
