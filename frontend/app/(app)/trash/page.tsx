"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Database, FileSignature, RefreshCw, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

type TrashType = "facility" | "contract";

interface TrashItem {
  trashId: string;
  itemType: TrashType;
  itemId: string;
  itemTitle: string;
  reason: string | null;
  deletedAt: string;
  deletedByName: string | null;
  deletedByEmail: string | null;
}

const TABS: Array<{ type: TrashType; label: string; icon: typeof Database }> = [
  { type: "facility", label: "사업장 DB", icon: Database },
  { type: "contract", label: "계약관리 DB", icon: FileSignature },
];

export default function TrashPage() {
  const toast = useToast();
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? "viewer";
  const isAdmin = role === "admin";
  const [type, setType] = useState<TrashType>("facility");
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/trash?type=${type}`, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      const json = (await res.json()) as { items?: TrashItem[] };
      setItems(json.items ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    load();
  }, [load]);

  const purge = async (item: TrashItem) => {
    if (!isAdmin) return;
    if (!window.confirm(`'${item.itemTitle || item.itemId}' 항목을 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    try {
      const res = await fetch(`/api/trash/${encodeURIComponent(item.trashId)}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      toast.show("영구 삭제되었습니다.", "success");
      load();
    } catch (err) {
      toast.show("영구 삭제 실패: " + (err as Error).message, "error");
    }
  };

  return (
    <div className="flex flex-col gap-6 p-2">
      <section className="glass-panel rounded-3xl p-8 reveal">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-stone-800 mb-2 flex items-center gap-3">
              <Trash2 className="w-7 h-7 text-primary" />
              휴지통
            </h1>
            <p className="text-stone-600 text-sm">
              삭제된 사업장 및 계약 데이터를 확인합니다. 영구 삭제는 관리자만 가능합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={load}
            className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700 flex items-center gap-1"
          >
            <RefreshCw className={"w-3.5 h-3.5 " + (loading ? "animate-spin" : "")} />
            새로고침
          </button>
        </div>
      </section>

      <section className="glass-card rounded-2xl p-4 reveal delay-1">
        <div className="flex gap-2 mb-4">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.type}
                type="button"
                onClick={() => setType(tab.type)}
                className={
                  "rounded-xl px-4 py-2 text-sm font-bold flex items-center gap-2 " +
                  (type === tab.type ? "bg-primary text-white" : "bg-white/70 text-stone-600 hover:bg-white")
                }
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {error && <div className="text-sm font-bold text-red-600 mb-3">조회 실패: {error}</div>}
        {loading && <div className="text-sm text-stone-400 py-10 text-center">불러오는 중...</div>}
        {!loading && items.length === 0 && !error && (
          <div className="text-sm text-stone-400 py-10 text-center">휴지통 항목이 없습니다.</div>
        )}
        {!loading && items.length > 0 && (
          <div className="overflow-hidden rounded-2xl border border-stone-200/80 bg-white/70">
            <table className="w-full text-sm">
              <thead className="bg-stone-100/80 text-xs text-stone-500">
                <tr>
                  <th className="text-left p-3">항목</th>
                  <th className="text-left p-3">삭제 사유</th>
                  <th className="text-left p-3">삭제자</th>
                  <th className="text-left p-3">삭제일</th>
                  <th className="text-right p-3">작업</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.trashId} className="border-t border-stone-100">
                    <td className="p-3">
                      <p className="font-bold text-stone-800">{item.itemTitle || item.itemId}</p>
                      <p className="text-[11px] font-mono text-stone-400">{item.itemId}</p>
                    </td>
                    <td className="p-3 text-stone-600">{item.reason ?? "-"}</td>
                    <td className="p-3 text-stone-600">{item.deletedByName ?? item.deletedByEmail ?? "-"}</td>
                    <td className="p-3 text-stone-500 font-mono text-xs">{item.deletedAt.slice(0, 10)}</td>
                    <td className="p-3 text-right">
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() => purge(item)}
                          className="rounded-lg px-3 py-1.5 text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200"
                        >
                          영구 삭제
                        </button>
                      ) : (
                        <span className="text-xs text-stone-400">관리자 전용</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
