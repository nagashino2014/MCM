"use client";

// RAG & 영업 발굴 — 계획서 §3.1 메뉴 구성(개요·브리핑·영업 발굴·신규 사업장·관심 설정).
// 공식 정보원 운영 설정은 API & 스크래핑(/sales/intel)으로 옮겼다.

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { hasAnyPerm, hasPerm, permsOf } from "@/lib/auth/perms";
import { BookOpenText } from "lucide-react";
import { CdPageHeader, CdTabs, useCdashTheme } from "@/components/cdash";
import { IntelOverviewPanel } from "./IntelOverviewPanel";
import { BriefingPanel } from "./BriefingPanel";
import { ProjectIntelligencePanel } from "./ProjectIntelligencePanel";
import { FacilityCandidatesPanel } from "./FacilityCandidatesPanel";
import { ScheduledBriefingPanel } from "./ScheduledBriefingPanel";
import type { BriefingCapabilities } from "./intel-shared";
import "@/components/cdash/cdash.css";
import "./intelligence.css";

const TABS = [
  { key: "overview", label: "개요", panelId: "intel-overview" },
  { key: "briefing", label: "브리핑", panelId: "intel-briefing" },
  { key: "discovery", label: "영업 발굴", panelId: "intel-discovery" },
  { key: "candidates", label: "신규 사업장", panelId: "intel-candidates" },
  { key: "settings", label: "관심 설정", panelId: "intel-settings" },
] as const;
export type IntelTab = typeof TABS[number]["key"];

/** 이전 탭 주소(메일·메신저 링크에 남은 값)를 새 탭으로 옮긴다. */
const LEGACY_TABS: Record<string, IntelTab> = { manual: "briefing", scheduled: "briefing", projects: "discovery", sources: "overview" };

function resolveTab(requested: string | null, params: URLSearchParams): IntelTab | null {
  if (requested && TABS.some((item) => item.key === requested)) return requested as IntelTab;
  if (requested && LEGACY_TABS[requested]) return LEGACY_TABS[requested];
  if (params.has("runId") || params.has("briefingId")) return "briefing";
  if (params.has("projectId")) return "discovery";
  return null;
}

export function SalesIntelligenceBoard() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const permissions = permsOf(session?.user);
  const canEdit = hasPerm(permissions, "sales.edit");
  const canViewSales = hasPerm(permissions, "sales.view");
  const [capabilities, setCapabilities] = useState<BriefingCapabilities | null>(null);
  useEffect(() => {
    void fetch("/api/sales/rag/status", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (data?.capabilities) setCapabilities(data.capabilities); })
      .catch(() => {});
  }, []);
  const canViewBriefing = capabilities?.canView ?? hasAnyPerm(permissions, ["sales.view", "intel.briefing.view"]);
  const canCreateBriefing = capabilities?.canCreate ?? hasAnyPerm(permissions, ["sales.edit", "intel.briefing.create"]);
  const tabs = TABS.filter((item) => (item.key === "briefing" || item.key === "settings" ? canViewBriefing : canViewSales));

  // 이동 대상은 상태로 먼저 반영하고 주소는 뒤따라 갱신한다(새로고침·링크 공유 때 같은 화면).
  const [nav, setNav] = useState<{ tab: IntelTab | null; extra: Record<string, string> }>(() => ({
    tab: resolveTab(params.get("tab"), params),
    extra: Object.fromEntries(params.entries()),
  }));
  const activeTab = tabs.find((item) => item.key === nav.tab)?.key ?? tabs[0]?.key;
  const arg = (key: string) => nav.extra[key] ?? null;
  const askView = arg("view") === "ask" || arg("tab") === "manual" || arg("briefingId") != null;

  const navigate = useCallback((next: IntelTab, extra: Record<string, string> = {}) => {
    setNav({ tab: next, extra });
    const query = new URLSearchParams({ tab: next, ...extra });
    router.replace(`${pathname}?${query.toString()}`, { scroll: false });
  }, [pathname, router]);

  const { theme } = useCdashTheme();
  return (
    <div className="cdash cd-fields-white intel-ui p-2 min-w-0" data-theme={theme}>
      <CdPageHeader
        icon={<BookOpenText className="w-5 h-5" />}
        eyebrow="SALES & MARKETING"
        title="RAG & 영업 발굴"
        helpTopic="sales.intelligence"
        tabs={activeTab ? <CdTabs items={tabs} active={activeTab} onChange={(key) => navigate(key)} /> : undefined}
      />
      <div id={`intel-${activeTab ?? "none"}`} role="tabpanel" aria-label={TABS.find((item) => item.key === activeTab)?.label}>
        {!activeTab && <p className="intel-prose cd-text-muted">열람 권한이 없습니다.</p>}
        {activeTab === "overview" && <IntelOverviewPanel onNavigate={navigate} />}
        {activeTab === "briefing" && (
          <BriefingPanel
            initialView={askView ? "ask" : "published"}
            initialRunId={arg("runId")}
            canViewSales={canViewSales}
            onOpenProject={(projectId) => navigate("discovery", { projectId })}
          />
        )}
        {activeTab === "discovery" && (
          <ProjectIntelligencePanel canEdit={canEdit} initialProjectId={arg("projectId")} initialReview={arg("review")} />
        )}
        {activeTab === "candidates" && (
          <FacilityCandidatesPanel canEdit={canEdit} onOpenProject={(projectId) => navigate("discovery", { projectId })} />
        )}
        {activeTab === "settings" && (
          <ScheduledBriefingPanel canEdit={canCreateBriefing} onOpenRun={(runId) => navigate("briefing", { runId })} />
        )}
      </div>
    </div>
  );
}
