"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { HomeCard, HomeRow } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";
import { AlertDrawer, type AlertItem } from "@/components/dashboard/AlertDrawer";

const SEVERITY_COLOR: Record<string, string> = {
  info: "#5D87FF",
  warn: "#FFAE1F",
  error: "#FA896B",
};

/** H5 — 운영 알림 요약(미확인 N건 + 최근 3건). 전체보기 시 AlertDrawer. */
export function AlertsCard({ role }: { role?: string }) {
  const w = useHomeWidget<{ alerts: AlertItem[]; total: number }>("/api/alerts?status=open&limit=3");
  const canAck = role === "admin" || role === "editor";
  const [open, setOpen] = useState(false);

  // 알림 목록 자체는 전 role 접근 가능(요약 표시엔 게이팅 없음).
  const alerts = w.status === "ok" ? w.data.alerts : [];
  const total = w.status === "ok" ? w.data.total : 0;

  return (
    <>
      <HomeCard
        icon={<Bell className="w-4 h-4" />}
        title="운영 알림"
        count={total}
        accent="#FFAE1F"
        loading={w.status === "loading"}
        error={w.status === "error" ? w.message : undefined}
        empty={w.status === "ok" && alerts.length === 0}
        emptyText="미확인 알림이 없습니다."
        headerActions={
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold cd-text-muted hover:cd-text"
          >
            전체보기
          </button>
        }
      >
        <ul className="flex flex-col gap-1.5">
          {alerts.slice(0, 3).map((a) => (
            <li key={a.id}>
              <HomeRow onClick={() => setOpen(true)}>
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: SEVERITY_COLOR[a.severity] ?? "#5D87FF" }}
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] cd-text truncate">{a.title}</span>
                  {a.body && <span className="block text-[11px] cd-text-faint truncate">{a.body}</span>}
                </span>
              </HomeRow>
            </li>
          ))}
        </ul>
      </HomeCard>
      <AlertDrawer open={open} onClose={() => setOpen(false)} canAck={canAck} onChanged={w.reload} />
    </>
  );
}
