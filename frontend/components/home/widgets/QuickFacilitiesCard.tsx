"use client";

import { useState } from "react";
import { Building2, ExternalLink, Check } from "lucide-react";
import { HomeCard } from "../HomeCard";
import { useHomeWidget } from "../useHomeWidget";

interface FacilityItem {
  facilityId: string;
  companyName: string;
  siteAddress: string | null;
  createdAt: string;
}

/** H4 — 모바일 간이 등록(mobile-quick) 사업장 정리. 정보 완성 딥링크 + 승격(완성) 버튼. */
export function QuickFacilitiesCard({ role }: { role?: string }) {
  const w = useHomeWidget<{ items: FacilityItem[]; total: number }>(
    "/api/facilities?source=mobile-quick&limit=8&sort=recent"
  );
  const canPromote = role === "admin" || role === "editor";
  const [promoting, setPromoting] = useState<string | null>(null);

  if (w.status === "forbidden") return null;
  const items = w.status === "ok" ? w.data.items : [];
  const total = w.status === "ok" ? w.data.total : 0;

  const promote = async (facilityId: string) => {
    setPromoting(facilityId);
    try {
      const res = await fetch(`/api/facilities/${facilityId}/promote`, { method: "POST" });
      if (res.ok) w.reload();
      else {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "완성 처리에 실패했습니다.");
      }
    } finally {
      setPromoting(null);
    }
  };

  return (
    <HomeCard
      icon={<Building2 className="w-4 h-4" />}
      title="임시 등록 사업장 완성"
      count={total}
      accent="#49BEFF"
      href="/facilities?source=mobile-quick"
      loading={w.status === "loading"}
      error={w.status === "error" ? w.message : undefined}
      empty={w.status === "ok" && items.length === 0}
      emptyText="정리할 임시 등록 사업장이 없습니다."
    >
      <ul className="flex flex-col gap-1.5">
        {items.slice(0, 6).map((f) => (
          <li
            key={f.facilityId}
            className="flex items-center gap-2 rounded-lg border cd-border-c px-3 py-2"
          >
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] cd-text truncate">{f.companyName}</span>
              {f.siteAddress && (
                <span className="block text-[11px] cd-text-faint truncate">{f.siteAddress}</span>
              )}
            </span>
            <a
              href={`/facilities?focus=${f.facilityId}`}
              className="inline-flex items-center gap-1 text-[11px] font-semibold shrink-0 rounded px-2 py-1 cd-text-muted hover:bg-[color:var(--cd-surface)]"
              title="사업장 상세로 이동해 정보 완성"
            >
              <ExternalLink className="w-3 h-3" />
              정보 완성
            </a>
            {canPromote && (
              <button
                type="button"
                onClick={() => promote(f.facilityId)}
                disabled={promoting === f.facilityId}
                className="cd-btn cd-btn-soft text-[11px] px-2 py-1 shrink-0 disabled:opacity-50"
                title="정식 사업장으로 승격(mobile-quick → manual)"
              >
                <Check className="w-3 h-3" />
                완성
              </button>
            )}
          </li>
        ))}
      </ul>
    </HomeCard>
  );
}
