"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Database, FileSignature, RefreshCw, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import "@/components/cdash/cdash.css";

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
  const { theme, toggleTheme } = useCdashTheme();
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
    <div
      className="cdash cd-fields-white flex flex-col gap-5 p-4 md:p-5 rounded-3xl min-h-full"
      data-theme={theme}
    >
      <CdPageHeader
        icon={<Trash2 className="w-5 h-5" />}
        eyebrow="시스템"
        title="휴지통"
        subtitle="삭제된 사업장 및 계약 데이터를 확인합니다. 영구 삭제는 관리자만 가능합니다."
        actions={
          <>
            <button type="button" onClick={load} className="cd-btn cd-btn-ghost cd-btn-sm">
              <RefreshCw className={"w-3.5 h-3.5 " + (loading ? "animate-spin" : "")} />
              새로고침
            </button>
          </>
        }
      />

      <section className="cd-card p-4">
        <div className="flex gap-2 mb-4">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.type}
                type="button"
                onClick={() => setType(tab.type)}
                className="cd-chip"
                data-active={type === tab.type}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {error && <div className="text-sm font-bold cd-error-text mb-3">조회 실패: {error}</div>}
        {loading && <div className="text-sm cd-text-faint py-10 text-center">불러오는 중...</div>}
        {!loading && items.length === 0 && !error && (
          <div className="text-sm cd-text-faint py-10 text-center">휴지통 항목이 없습니다.</div>
        )}
        {!loading && items.length > 0 && (
          <div className="overflow-hidden rounded-2xl border cd-border-c">
            <table className="cd-table">
              <thead>
                <tr>
                  <th>항목</th>
                  <th>삭제 사유</th>
                  <th>삭제자</th>
                  <th>삭제일</th>
                  <th className="!text-right">작업</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.trashId}>
                    <td>
                      <p className="font-bold cd-text">{item.itemTitle || item.itemId}</p>
                      <p className="text-[11px] font-mono cd-text-faint">{item.itemId}</p>
                    </td>
                    <td className="cd-text-muted">{item.reason ?? "-"}</td>
                    <td className="cd-text-muted">{item.deletedByName ?? item.deletedByEmail ?? "-"}</td>
                    <td className="cd-text-muted font-mono text-xs">{item.deletedAt.slice(0, 10)}</td>
                    <td className="text-right">
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() => purge(item)}
                          className="cd-btn cd-btn-danger cd-btn-sm"
                        >
                          영구 삭제
                        </button>
                      ) : (
                        <span className="text-xs cd-text-faint">관리자 전용</span>
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
