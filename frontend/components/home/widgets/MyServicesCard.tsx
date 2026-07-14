"use client";

import { Workflow } from "lucide-react";
import { HomeCard, HomeRow } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";
import { resolveServiceTypeStyle } from "@/lib/ieps/contract-tree-style";

interface Service {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  serviceType: string | null;
  contractStatus: string;
  lastStage: string | null;
  lastPct: number | null;
  stageIndex: number | null;
  stageTotal: number | null;
  completed: boolean;
}

/** 내 참여 용역 진행 현황 — 참여 계약의 현재 공정 단계·진행률 태그. 관리자 등 미참여 계정은 빈 상태. */
export function MyServicesCard() {
  const w = useHomeWidget<{ services: Service[] }>("/api/home/my-services");
  if (w.status === "forbidden") return null;

  // 진행 중(미완료) 용역만. 완료·해지는 홈 요약에서 제외.
  const services =
    w.status === "ok"
      ? w.data.services.filter((s) => !s.completed && s.contractStatus !== "terminated")
      : [];

  return (
    <HomeCard
      icon={<Workflow className="w-4 h-4" />}
      title="내 참여 용역 진행"
      count={services.length}
      accent="#539BFF"
      href="/staffing"
      loading={w.status === "loading"}
      error={w.status === "error" ? w.message : undefined}
      empty={w.status === "ok" && services.length === 0}
      emptyText="참여 중인 용역이 없습니다."
    >
      <ul className="flex flex-col gap-1.5">
        {services.slice(0, 6).map((s) => {
          const style = resolveServiceTypeStyle(s.serviceType);
          const hasStage = !!s.lastStage;
          const stageText = hasStage
            ? s.stageIndex != null && s.stageTotal != null
              ? `${s.lastStage} ${s.stageIndex}/${s.stageTotal}`
              : s.lastStage
            : "착수 전";
          return (
            <li key={s.contractId}>
              <HomeRow href="/staffing">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: style.parentColor }}
                />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] cd-text truncate">{s.contractTitle}</span>
                  <span className="block text-[11px] cd-text-faint truncate">{s.counterpartyName}</span>
                </span>
                <span
                  className="text-[10px] rounded-full px-2 py-0.5 shrink-0"
                  style={{ background: style.childColor, color: "#1f2937" }}
                >
                  {stageText}
                </span>
                {s.lastPct != null && (
                  <span className="text-[11px] font-mono cd-text-faint shrink-0 w-9 text-right tabular-nums">
                    {Math.round(s.lastPct)}%
                  </span>
                )}
              </HomeRow>
            </li>
          );
        })}
      </ul>
    </HomeCard>
  );
}
