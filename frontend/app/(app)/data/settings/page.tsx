"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Settings as SettingsIcon, Star, Trash2, RefreshCw, Plus } from "lucide-react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { CollectionOptionsCard } from "@/components/dashboard/CollectionOptionsCard";
import { DEFAULT_COLLECTION_CONFIG } from "@/lib/ieps/defaults";
import type { CollectionConfig } from "@/lib/ieps/types";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  return (
    <ToastProvider>
      <SettingsPageInner />
    </ToastProvider>
  );
}

interface ConfigItem {
  id: number;
  name: string;
  config: CollectionConfig;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

function SettingsPageInner() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: "admin" | "editor" | "viewer" } | undefined)?.role ?? "viewer";
  const canEdit = role === "admin" || role === "editor";
  const [items, setItems] = useState<ConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [editingConfig, setEditingConfig] = useState<CollectionConfig>(DEFAULT_COLLECTION_CONFIG);
  const [editingName, setEditingName] = useState("");
  const toast = useToast();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/collection-configs", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const json = (await res.json()) as { items: ConfigItem[] };
      setItems(json.items || []);
    } catch (err) {
      toast.show("목록 조회 실패: " + (err as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    reload();
  }, [reload]);

  const handleNew = () => {
    setEditingId("new");
    setEditingConfig(DEFAULT_COLLECTION_CONFIG);
    setEditingName("");
  };

  const handleEdit = (item: ConfigItem) => {
    setEditingId(item.id);
    setEditingConfig(item.config ?? DEFAULT_COLLECTION_CONFIG);
    setEditingName(item.name);
  };

  const handleClose = () => {
    setEditingId(null);
  };

  const handleSaveCurrent = useCallback(
    async (config: CollectionConfig, name: string) => {
      if (editingId === "new") {
        const res = await fetch("/api/collection-configs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: name || editingName || "새 옵션", config }),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
      } else if (typeof editingId === "number") {
        const res = await fetch("/api/collection-configs/" + editingId, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: name || editingName, config }),
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
      }
      reload();
    },
    [editingId, editingName, reload]
  );

  const handleSetDefault = async (id: number, current: boolean) => {
    try {
      const res = await fetch("/api/collection-configs/" + id, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isDefault: !current }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      toast.show(!current ? "기본 옵션으로 설정했습니다." : "기본 해제되었습니다.");
      reload();
    } catch (err) {
      toast.show("실패: " + (err as Error).message, "error");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("이 옵션을 삭제할까요?")) return;
    try {
      const res = await fetch("/api/collection-configs/" + id, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      toast.show("삭제되었습니다.");
      if (editingId === id) setEditingId(null);
      reload();
    } catch (err) {
      toast.show("삭제 실패: " + (err as Error).message, "error");
    }
  };

  // CollectionOptionsCard onCollect를 비활성화하기 위해 noop를 넘긴다.
  const noopCollect = () => {
    toast.show("설정 페이지에서는 즉시 수집을 사용할 수 없습니다. 수집 현황 페이지로 이동하세요.");
  };

  return (
    <div className="flex flex-col gap-6 p-2">
      <section className="glass-panel p-8 rounded-3xl relative overflow-hidden reveal">
        <div className="relative z-10 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-stone-800 mb-2 flex items-center gap-3">
              <SettingsIcon className="w-7 h-7 text-primary" />
              데이터 · 설정
            </h1>
            <p className="text-stone-600 text-base max-w-3xl">
              자주 사용하는 수집 옵션을 저장하고, 기본 옵션을 지정합니다. 저장된 옵션은
              <span className="text-primary font-bold"> /data/status </span>의 옵션 카드 상단 드롭다운에서 즉시 불러올 수 있습니다.
            </p>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={reload}
              className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700 flex items-center gap-1"
            >
              <RefreshCw className={"w-3 h-3 " + (loading ? "animate-spin" : "")} />
              새로고침
            </button>
            <button
              type="button"
              onClick={handleNew}
              disabled={!canEdit}
              title={!canEdit ? "조회자 권한은 옵션을 추가할 수 없습니다." : undefined}
              className="rounded-xl px-3 py-2 text-xs font-bold text-white bg-primary hover:bg-primary/90 shadow-sm flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-3.5 h-3.5" />
              새 옵션
            </button>
          </div>
        </div>
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-gradient-to-l from-primary/10 to-transparent pointer-events-none" />
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6">
        <section className="glass-panel rounded-3xl p-6 reveal delay-1">
          <h3 className="font-bold text-stone-700 mb-3">저장된 옵션 ({items.length})</h3>
          {loading && (
            <div className="text-stone-400 text-sm text-center py-10">로딩 중…</div>
          )}
          {!loading && items.length === 0 && (
            <div className="text-stone-400 text-sm text-center py-10">
              아직 저장된 옵션이 없습니다. 우측에서 새 옵션을 정의해 저장하세요.
            </div>
          )}
          <div className="flex flex-col gap-2">
            {items.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "p-3 rounded-xl border transition-colors flex items-center gap-3",
                  editingId === item.id
                    ? "bg-primary/10 border-primary/30"
                    : "bg-white/40 hover:bg-white/70 border-white/50"
                )}
              >
                <button
                  type="button"
                  onClick={() => handleEdit(item)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="text-sm font-bold text-stone-800 truncate flex items-center gap-2">
                    {item.name}
                    {item.isDefault && (
                      <span className="status-pill status-pill--running">기본</span>
                    )}
                  </div>
                  <div className="text-[11px] text-stone-500 truncate">
                    수정 {item.updatedAt?.slice(0, 16).replace("T", " ")} · 룰 {item.config?.extractionRules?.length ?? 0}개
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleSetDefault(item.id, item.isDefault)}
                  disabled={!canEdit}
                  className={cn(
                    "p-2 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                    item.isDefault ? "text-primary" : "text-stone-400 hover:text-primary"
                  )}
                  title={
                    !canEdit
                      ? "조회자 권한은 변경할 수 없습니다."
                      : item.isDefault
                      ? "기본 해제"
                      : "기본으로 설정"
                  }
                >
                  <Star className={"w-4 h-4 " + (item.isDefault ? "fill-current" : "")} />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(item.id)}
                  disabled={!canEdit}
                  className="p-2 rounded-lg text-stone-400 hover:text-red-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title={!canEdit ? "조회자 권한은 삭제할 수 없습니다." : "삭제"}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="reveal delay-2">
          {editingId === null ? (
            <div className="glass-card rounded-3xl p-10 text-center text-sm text-stone-500">
              좌측 목록에서 옵션을 선택하거나 “새 옵션”을 누르세요.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="glass-card rounded-2xl p-4 flex items-center gap-3">
                <label className="text-[11px] font-bold text-stone-500 uppercase tracking-wide whitespace-nowrap">
                  옵션 이름
                </label>
                <input
                  className="input-field flex-1"
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  placeholder="예: 분기별 통합허가 수집"
                />
                <button
                  type="button"
                  onClick={handleClose}
                  className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700"
                >
                  닫기
                </button>
              </div>
              <CollectionOptionsCard
                key={typeof editingId === "number" ? editingId : "new"}
                initialConfig={editingConfig}
                savedConfigs={[]}
                onCollect={noopCollect}
                onSaveCurrent={handleSaveCurrent}
                onLoadConfig={async () => null}
                canEdit={canEdit}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
