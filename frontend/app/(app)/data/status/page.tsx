"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Database } from "lucide-react";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import "@/components/cdash/cdash.css";
import { KpiPanel } from "@/components/dashboard/KpiPanel";
import { RecentResultsTable } from "@/components/dashboard/RecentResultsTable";
import { CollectionOptionsCard } from "@/components/dashboard/CollectionOptionsCard";
import { ConceptSummaryCards } from "@/components/dashboard/ConceptSummaryCards";
import { RegionMap } from "@/components/dashboard/RegionMap";
import { AlertBanner } from "@/components/dashboard/AlertBanner";
import { OperationsPanel } from "@/components/dashboard/OperationsPanel";
import {
  ProgressDrawer,
  type ProgressEvent,
} from "@/components/dashboard/ProgressDrawer";
import { DEFAULT_COLLECTION_CONFIG, withDefaultsApplied } from "@/lib/ieps/defaults";
import type { CollectionConfig } from "@/lib/ieps/types";
import type { ParseCategoryId } from "@/components/dashboard/CollectionOptionsCard";

const PARSE_CATEGORY_LABEL: Record<ParseCategoryId, string> = {
  integratedFirst: "통합허가",
  integratedChange: "변경허가",
  annualReport: "연간보고서",
};

export default function StatusPage() {
  return (
    <ToastProvider>
      <StatusPageInner />
    </ToastProvider>
  );
}

function StatusPageInner() {
  const { data: session } = useSession();
  const { theme, toggleTheme } = useCdashTheme();
  const role = (session?.user as { role?: "admin" | "editor" | "viewer" } | undefined)?.role ?? "viewer";
  const canEdit = role === "admin" || role === "editor";
  const [refreshKey, setRefreshKey] = useState(0);
  const [savedConfigs, setSavedConfigs] = useState<{ id: number; name: string }[]>([]);
  // 가장 최근에 저장된 옵션을 페이지 진입 시 자동 복원하기 위한 initialConfig.
  // null = 아직 로드 중 / DEFAULT = 저장된 옵션 없음 / 그 외 = 저장된 옵션 (마지막 저장 또는 isDefault).
  const [initialConfig, setInitialConfig] = useState<CollectionConfig | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [events, setEvents] = useState<ProgressEvent[]>([]);
  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  // 진행 중 작업이 어떤 종류인지 — 같은 SSE 인프라를 공유하지만
  // 카드/드로어 라벨링과 동시 실행 차단을 위해 구분한다.
  // - "collect": 스크래핑 + PDF 다운로드만 수행하는 잡 (수집 시작 버튼)
  // - "parse:<category>": raw/ 아래 카테고리 PDF 만 파싱+적재 (3개 카테고리 버튼)
  type JobMode = "collect" | `parse:${ParseCategoryId}`;
  const [jobMode, setJobMode] = useState<JobMode | null>(null);
  const parsingCategory: ParseCategoryId | null =
    jobMode && jobMode.startsWith("parse:") && status === "running"
      ? (jobMode.slice("parse:".length) as ParseCategoryId)
      : null;
  const abortRef = useRef<AbortController | null>(null);
  const toast = useToast();

  // 저장된 옵션 목록 + 마지막 저장(또는 isDefault) 옵션을 함께 가져온다. 페이지 진입 시
  // 가장 최근/기본 옵션을 자동으로 적용해야 "옵션 저장" 의 영속성이 사용자 멘탈 모델과 맞는다.
  const reloadConfigs = useCallback(async (): Promise<CollectionConfig | null> => {
    try {
      const res = await fetch("/api/collection-configs", { cache: "no-store" });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        items: {
          id: number;
          name: string;
          config: CollectionConfig;
          isDefault: boolean;
          updatedAt: string;
        }[];
      };
      const items = json.items ?? [];
      setSavedConfigs(items.map((i) => ({ id: i.id, name: i.name })));
      if (items.length === 0) return null;
      // isDefault=1 우선, 없으면 updatedAt 기준 가장 최근 항목.
      const defaulted = items.find((i) => i.isDefault);
      const recent = [...items].sort((a, b) =>
        (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "")
      )[0];
      // 과거 저장본은 annualReportExtractionRange 가 없을 수 있어 디폴트로 보강.
      const picked = defaulted?.config ?? recent?.config ?? null;
      return picked ? withDefaultsApplied(picked) : null;
    } catch {
      // 조회 실패는 무시 (드롭다운만 비어있게 됨)
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const restored = await reloadConfigs();
      if (cancelled) return;
      // restored 가 null 이면 저장된 옵션이 없는 신규 사용자 → DEFAULT 사용.
      setInitialConfig(restored ?? DEFAULT_COLLECTION_CONFIG);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadConfigs]);

  const handleSaveConfig = useCallback(
    async (config: CollectionConfig, name: string) => {
      // 마지막 저장 옵션이 곧 다음 진입 시 자동 복원 대상이 되도록 isDefault=true 로 마킹.
      // 백엔드 POST 가 동일 트랜잭션에서 다른 행의 is_default 를 0 으로 일괄 클리어한다.
      const res = await fetch("/api/collection-configs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, config, isDefault: true }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error("HTTP " + res.status + " " + text.slice(0, 200));
      }
      // 저장 후 목록 재조회 (드롭다운 갱신용). 자동 복원 시 가장 최근/기본을 다시 가져온다.
      await reloadConfigs();
    },
    [reloadConfigs]
  );

  const handleLoadConfig = useCallback(async (id: number): Promise<CollectionConfig | null> => {
    const res = await fetch("/api/collection-configs/" + id, { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error("HTTP " + res.status + " " + text.slice(0, 200));
    }
    const json = (await res.json()) as { config: CollectionConfig };
    // 과거 저장본은 annualReportExtractionRange 가 없을 수 있어 디폴트로 보강.
    return json.config ? withDefaultsApplied(json.config) : null;
  }, []);

  // /api/collect/start, /api/parse/start 가 동일한 NDJSON-over-SSE 포맷을 사용하므로
  // 응답 처리 루프를 공유한다. completedToast 는 사용자에게 표시되는 완료 메시지에만 영향.
  const consumeSseStream = useCallback(
    async (
      url: string,
      requestBody: object,
      ac: AbortController,
      completedToast: string
    ) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: ac.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error("HTTP " + res.status + " " + text.slice(0, 200));
      }
      if (!res.body) throw new Error("응답 본문이 비어 있습니다.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const chunk of parts) {
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            try {
              const evt = JSON.parse(payload) as ProgressEvent | { event: string };
              setEvents((prev) => [...prev, evt as ProgressEvent]);
              if ((evt as { event: string }).event === "done") {
                setStatus("done");
                setRefreshKey((k) => k + 1);
                toast.show(completedToast);
              } else if ((evt as { event: string }).event === "error") {
                setStatus("error");
                setErrorMessage(
                  (evt as { message?: string }).message ?? "알 수 없는 오류"
                );
              } else if ((evt as { event: string }).event === "exit") {
                const code = (evt as { code?: number }).code;
                if (code != null && code !== 0) {
                  setStatus((s) => (s === "running" ? "error" : s));
                  setErrorMessage(
                    (prev) => prev ?? "프로세스가 코드 " + code + "로 종료되었습니다."
                  );
                }
              }
            } catch {
              // JSON 파싱 실패 라인은 무시
            }
          }
        }
      }

      setStatus((s) => (s === "running" ? "done" : s));
      setRefreshKey((k) => k + 1);
    },
    [toast]
  );

  const handleCollect = useCallback(async (config: CollectionConfig) => {
    setEvents([]);
    setStatus("running");
    setErrorMessage(undefined);
    setDrawerOpen(true);
    setJobMode("collect");

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      // 수집 범위 preset이 "all"이면 끝까지 — 빈 페이지를 만나면 CLI가 자연 종료한다.
      // 그 외(1m/3m/6m/1y/2y/custom)는 기존 기본값 5페이지 유지.
      const maxPages = config.collectionRange?.preset === "all" ? 9999 : 5;
      // /api/collect/start 는 항상 다운로드 단계까지만 수행. 파싱은 별도 카테고리 잡으로.
      await consumeSseStream(
        "/api/collect/start",
        { config, maxPages },
        ac,
        "PDF 다운로드 작업이 완료되었습니다."
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setStatus("idle");
      } else {
        setStatus("error");
        setErrorMessage((err as Error).message);
        toast.show("수집 실패: " + (err as Error).message, "error");
      }
    } finally {
      abortRef.current = null;
    }
  }, [toast, consumeSseStream]);

  const handleParseCategory = useCallback(
    async (config: CollectionConfig, category: ParseCategoryId) => {
      const label = PARSE_CATEGORY_LABEL[category];
      if (
        !confirm(
          `raw/ 아래 ${label} PDF 를 새 룰로 모두 파싱합니다.\n` +
            "사업장/허가 정보가 갱신되며 시간이 오래 걸릴 수 있습니다. 진행할까요?"
        )
      ) {
        return;
      }
      setEvents([]);
      setStatus("running");
      setErrorMessage(undefined);
      setDrawerOpen(true);
      setJobMode(`parse:${category}`);

      const ac = new AbortController();
      abortRef.current = ac;

      try {
        // 카드에서 사용자가 조정한 추출 범위/룰을 그대로 백엔드에 전달.
        await consumeSseStream(
          "/api/parse/start",
          { config, category },
          ac,
          `${label} 파싱 작업이 완료되었습니다.`
        );
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          setStatus("idle");
        } else {
          setStatus("error");
          setErrorMessage((err as Error).message);
          toast.show(`${label} 파싱 실패: ` + (err as Error).message, "error");
        }
      } finally {
        abortRef.current = null;
      }
    },
    [toast, consumeSseStream]
  );

  const handleCancel = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  }, []);

  return (
    <div className="cdash cd-fields-white flex flex-col gap-5 p-4 md:p-5 rounded-3xl min-h-full" data-theme={theme}>
      <CdPageHeader
        icon={<Database className="w-5 h-5" />}
        eyebrow="Data · Status"
        title="데이터 · 수집 현황"
        subtitle={
          <>
            IEPS 통합환경허가 게시판에서 통합/변경허가 검토결과서와 연간보고서 PDF 를 수집합니다.{" "}
            <b className="cd-text-primary">수집 시작</b>은 게시물 목록과 PDF 다운로드까지, 우측 옵션 카드의{" "}
            <b className="cd-text-primary">통합·변경·연간보고서 파싱</b> 버튼이 카테고리별 OCR 추출과 사업장 적재를 담당합니다.
          </>
        }
      />

      <AlertBanner canAck={canEdit} />

      <ConceptSummaryCards refreshKey={refreshKey} />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-6">
        <KpiPanel refreshKey={refreshKey} />
        <RecentResultsTable refreshKey={refreshKey} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RegionMap refreshKey={refreshKey} />

        <div className="flex flex-col gap-6">
          <OperationsPanel />

          <CollectionOptionsCard
            initialConfig={initialConfig ?? DEFAULT_COLLECTION_CONFIG}
            savedConfigs={savedConfigs}
            onCollect={handleCollect}
            onParseCategory={handleParseCategory}
            onSaveCurrent={handleSaveConfig}
            onLoadConfig={handleLoadConfig}
            isCollecting={status === "running" && jobMode === "collect"}
            parsingCategory={parsingCategory}
            canEdit={canEdit}
          />
        </div>
      </div>

      <ProgressDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        events={events}
        status={status}
        errorMessage={errorMessage}
        onCancel={handleCancel}
        jobKind={jobMode === "collect" ? "collect" : jobMode ? "parse" : undefined}
        jobTitle={(() => {
          if (jobMode === "collect") return "IEPS 수집 (PDF 다운로드)";
          if (jobMode && jobMode.startsWith("parse:")) {
            const cat = jobMode.slice("parse:".length) as ParseCategoryId;
            return `${PARSE_CATEGORY_LABEL[cat]} 파싱`;
          }
          return undefined;
        })()}
      />

      {/* 드로어가 닫혔지만 수집이 idle이 아닌 동안 — 진행 로그를 다시 열 수 있는 진입점 */}
      {!drawerOpen && status !== "idle" && (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="fixed bottom-6 right-6 z-40 rounded-2xl px-4 py-3 cd-fill-primary text-white text-xs font-bold shadow-lg flex items-center gap-2"
          title="진행 로그 다시 보기"
        >
          {status === "running" && (
            <span
              aria-hidden
              className="w-2 h-2 rounded-full cd-card-bg animate-pulse"
            />
          )}
          {(() => {
            // 잡 종류별로 동사를 다르게 표시 — 수집/통합허가 파싱/변경허가 파싱/연간보고서 파싱.
            let verb = "수집";
            if (jobMode && jobMode.startsWith("parse:")) {
              const cat = jobMode.slice("parse:".length) as ParseCategoryId;
              verb = `${PARSE_CATEGORY_LABEL[cat]} 파싱`;
            }
            if (status === "running") return `${verb} 진행 중 — 로그 보기`;
            if (status === "done") return `${verb} 완료 — 로그 보기`;
            return `${verb} 오류 — 로그 보기`;
          })()}
        </button>
      )}
    </div>
  );
}
