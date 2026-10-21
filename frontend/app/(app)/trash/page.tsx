"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Database, FileSignature, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { hasPerm, permsOf } from "@/lib/auth/perms";
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
  // 영구 삭제 = trash.purge(관리자 템플릿). 목록·복원은 trash.view/restore 로 API 가 판정한다.
  const isAdmin = hasPerm(permsOf(session?.user), "trash.purge");
  // 복원 = trash.restore(부서장·영업관리·관리자). 원래 목록으로 되돌린다(F-11).
  const canRestore = hasPerm(permsOf(session?.user), "trash.restore");
  const [busyId, setBusyId] = useState<string | null>(null);
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

  const restore = async (item: TrashItem) => {
    if (!canRestore) return;
    const where = item.itemType === "contract" ? "계약관리" : "사업장 DB";
    if (!window.confirm(`'${item.itemTitle || item.itemId}' 항목을 복원할까요? ${where} 목록에 다시 나타납니다.`)) return;
    setBusyId(item.trashId);
    try {
      const res = await fetch(`/api/trash/${encodeURIComponent(item.trashId)}/restore`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      toast.show("복원되었습니다.", "success");
      load();
    } catch (err) {
      toast.show("복원 실패: " + (err as Error).message, "error");
    } finally {
      setBusyId(null);
    }
  };

  const purge = async (item: TrashItem) => {
    if (!isAdmin) return;
    if (!window.confirm(`'${item.itemTitle || item.itemId}' 항목을 영구 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    setBusyId(item.trashId);
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
    } finally {
      setBusyId(null);
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
        helpTopic="trash.page"
        subtitle="영구 삭제는 관리자만 가능합니다."
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
                      <div className="inline-flex items-center justify-end gap-2">
                        {canRestore && (
                          <button
                            type="button"
                            onClick={() => restore(item)}
                            disabled={busyId === item.trashId}
                            className="cd-btn cd-btn-ghost cd-btn-sm"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            복원
                          </button>
                        )}
                        {isAdmin ? (
                          <button
                            type="button"
                            onClick={() => purge(item)}
                            disabled={busyId === item.trashId}
                            className="cd-btn cd-btn-danger cd-btn-sm"
                          >
                            영구 삭제
                          </button>
                        ) : (
                          !canRestore && <span className="text-xs cd-text-faint">관리자 전용</span>
                        )}
                      </div>
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
