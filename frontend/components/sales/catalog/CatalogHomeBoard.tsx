"use client";

// 회사소개서 — 발행본 목록·받기(P7, 전 직원) · 반영 대기·발행(P7, 관리·발행 담당) · PDF 만들기·미리보기(P4) · 지표 사전 값 ·
// 현행 카탈로그 대조 · 통합허가 최초허가 계약 단위 상세 · 관리 화면 바로가기.
// 소개서의 숫자는 모두 지표 사전(lib/catalog/metrics.ts)에서 나온다. docs/company-catalog-blueprint.md §6-1·§6-5·§11

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { BookOpenText, Building2, FileBadge, ListChecks, MessageSquareQuote, Network, PenTool, RefreshCw, Send, Shapes, Type, Users } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdHelp } from "@/components/cdash/CdHelp";
import { useClientPaging } from "@/components/ui/PaginationControls";
import { hasPerm, permsOf } from "@/lib/auth/perms";
import type { InitialPermitDetail, MetricValue } from "@/lib/catalog/metrics";
import { countBySource } from "@/lib/catalog/refresh/diff";
import type { CatalogEditionSummary } from "@/lib/catalog/render/editions";
import { catalogFetch } from "./catalogFetch";
import { CatalogCoverPicker } from "./CatalogCoverPicker";
import { CatalogEditionsPanel } from "./CatalogEditionsPanel";
import { CatalogPendingButton, CatalogPendingModal, usePending } from "./CatalogPending";
import { CatalogPublishModal } from "./CatalogPublishModal";
import { CatalogReferencePanel } from "./CatalogReferencePanel";
import { CatalogRenderPanel } from "./CatalogRenderPanel";
import "@/components/cdash/cdash.css";

interface MetricsResponse {
  asOf: string;
  metrics: MetricValue[];
  initialPermit: InitialPermitDetail;
  projectsByCategory: Array<{ category: string; count: number; completed: number }>;
}

const LINKS = [
  { href: "/sales/catalog/studio", title: "스튜디오", desc: "쪽을 캔버스에서 직접 고치기 — 글·사진·인포그래픽·서체·배치", icon: PenTool },
  { href: "/sales/catalog/fonts", title: "서체 라이브러리", desc: "서체 올리기·견본·라이선스, 제목·본문·숫자 세트 만들기", icon: Type },
  { href: "/sales/catalog/illustrations", title: "일러스트 라이브러리", desc: "보유 스톡 인포그래픽 일러스트 올리기·글자 자리·라이선스", icon: Shapes },
  { href: "/sales/catalog/projects", title: "실적 노출 관리", desc: "부록 실적의 대외 표기·노출·대표 실적·표시 범위", icon: ListChecks },
  { href: "/sales/catalog/people", title: "인물 노출 관리", desc: "임원진·기술인력·자문위원, 사진 게재 동의", icon: Users },
  { href: "/sales/catalog/assets", title: "고객사 로고", desc: "주요 고객사·협력 기관 로고와 순서", icon: Building2 },
  { href: "/sales/catalog/message", title: "대표이사 인사말", desc: "본문·사진·서명 편집, 확정 판 기록", icon: MessageSquareQuote },
  { href: "/sales/catalog/org", title: "조직도", desc: "MCM 조직에서 불러와 소개서용으로 편집", icon: Network },
];

export function CatalogHomeBoard() {
  const { theme } = useCdashTheme();
  const { data: session } = useSession();
  const perms = permsOf(session?.user);
  const canManage = hasPerm(perms, "catalog.manage");
  const canPublish = hasPerm(perms, "catalog.publish");
  const steward = canManage || canPublish;
  const canEditProfile = hasPerm(perms, "org.edit");

  const [data, setData] = useState<MetricsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permitFilter, setPermitFilter] = useState<"completed" | "ongoing" | "all">("completed");
  const [editions, setEditions] = useState<CatalogEditionSummary[]>([]);
  const [modal, setModal] = useState<"pending" | "publish" | null>(null);
  const [publishFrom, setPublishFrom] = useState<CatalogEditionSummary | null>(null);
  const [renderTick, setRenderTick] = useState(0);
  const pending = usePending(steward);
  const pendingCount = pending.data ? pending.data.items.length : null;
  const reloadPending = pending.reload;

  const reloadEditions = useCallback(async () => {
    try {
      setEditions((await catalogFetch<{ editions: CatalogEditionSummary[] }>("/api/catalog/editions")).editions);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [metrics] = await Promise.all([catalogFetch<MetricsResponse>("/api/catalog/metrics"), reloadEditions(), reloadPending()]);
      setData(metrics);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [reloadEditions, reloadPending]);

  const openPublish = (from: CatalogEditionSummary | null) => {
    setPublishFrom(from);
    setModal("publish");
  };

  useEffect(() => {
    reload();
  }, [reload]);

  const permitRows = useMemo(() => {
    const rows = data?.initialPermit.rows ?? [];
    return permitFilter === "all" ? rows : rows.filter((r) => (permitFilter === "completed" ? r.completed : !r.completed));
  }, [data, permitFilter]);
  const { pageRows, pager, resetPage } = useClientPaging(permitRows, "catalog-initial-permit-page-size", loading);
  const cohortLabel = (id: string | null) => data?.initialPermit.byCohort.find((c) => c.id === id)?.label ?? "업종 미판정";

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<BookOpenText className="w-5 h-5" />}
        eyebrow="SALES & MARKETING"
        title="회사소개서"
        helpTopic="catalog.home"
        meta={data ? <span className="text-xs cd-text-faint">기준일 {data.asOf}</span> : undefined}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {steward && <CatalogPendingButton count={pendingCount} onClick={() => setModal("pending")} />}
            {canPublish && (
              <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" onClick={() => openPublish(null)}>
                <Send className="w-3.5 h-3.5" /> 발행
              </button>
            )}
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={reload} disabled={loading}>
              <RefreshCw className="w-3.5 h-3.5" /> 새로 고침
            </button>
          </div>
        }
      />

      {error && <div className="cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm mb-3">{error}</div>}

      {canManage && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-3">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="cd-card p-4 flex items-start gap-3 hover:border-[color:var(--cd-primary)]">
              <l.icon className="w-5 h-5 cd-text-primary shrink-0 mt-0.5" />
              <span className="min-w-0">
                <span className="block cd-text font-semibold text-sm">{l.title}</span>
                <span className="block cd-text-faint text-xs mt-0.5">{l.desc}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      {steward && pendingCount != null && pendingCount > 0 && (
        <div className="cd-card px-4 py-2.5 mb-3" role="status">
          {/* .cd-card 는 세로 flex 라 가로 줄은 안쪽 div 로 */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="cd-text font-semibold">발행본 이후 바뀐 것 {pendingCount}건</span>
            <span className="text-xs cd-text-muted">
              {countBySource(pending.data?.items ?? [])
                .map((c) => `${c.label} ${c.count}`)
                .join(" · ")}
            </span>
            <span className="text-xs cd-text-faint">초안(스튜디오·PDF 만들기)에는 이미 들어 있습니다 — 검토 후 발행하면 발행본에 반영됩니다.</span>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm ml-auto" onClick={() => setModal("pending")}>
              차이 보기
            </button>
          </div>
        </div>
      )}

      <CatalogEditionsPanel
        editions={editions}
        loading={loading}
        steward={steward}
        onChanged={(id, distributions) => setEditions((list) => list.map((e) => (e.editionId === id ? { ...e, distributions } : e)))}
      />

      {canManage && <CatalogRenderPanel key={renderTick} canPublish={canPublish} onPublish={(e) => openPublish(e)} />}

      {canManage && <CatalogCoverPicker />}

      <section className="cd-card p-4 mb-3">
        <h3 className="cd-text font-semibold text-base flex items-center gap-1 mb-3">
          지표 사전 <CdHelp topic="catalog.metrics" />
        </h3>
        {loading && !data ? (
          <p className="text-sm cd-text-faint">불러오는 중…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="cd-table">
              <thead>
                <tr>
                  <th>지표</th>
                  <th className="text-right">값</th>
                  <th>정의(쪽에 표기되는 각주)</th>
                </tr>
              </thead>
              <tbody>
                {(data?.metrics ?? []).map((m) => (
                  <tr key={m.id}>
                    <td className="cd-text font-semibold whitespace-nowrap">
                      {m.label}
                      <span className="block text-[11px] font-normal cd-text-faint font-mono">{m.id}</span>
                    </td>
                    <td className="text-right tabular-nums whitespace-nowrap">
                      {m.value == null ? (
                        <span className="cd-text-faint text-xs">{m.missing ?? "—"}</span>
                      ) : (
                        <>
                          <span className="cd-text font-bold">{m.value.toLocaleString("ko-KR")}</span>
                          <span className="cd-text-faint text-xs ml-0.5">{m.unit}</span>
                        </>
                      )}
                    </td>
                    <td className="cd-text-muted text-xs">{m.footnote}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <p className="text-xs cd-text-faint mt-2">
            분류별 누적 계약:{" "}
            {data.projectsByCategory.map((c) => `${c.category} ${c.count.toLocaleString("ko-KR")}건(완료 ${c.completed.toLocaleString("ko-KR")})`).join(" · ")}
          </p>
        )}
      </section>

      {canManage && data && <CatalogReferencePanel metrics={data.metrics} initialPermit={data.initialPermit} />}

      {canManage && (
        <section className="cd-card p-4">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <h3 className="cd-text font-semibold text-base flex items-center gap-1">
              <FileBadge className="w-4 h-4 cd-text-primary" /> 통합환경허가 최초허가 — 계약별 집계 <CdHelp topic="catalog.initial-permit" />
            </h3>
            {data && (
              <span className="text-xs cd-text-muted">
                완료 사업장 <b className="cd-text tabular-nums">{data.initialPermit.sites}</b> · 완료 계약 {data.initialPermit.completedContracts}건 · 수행 중{" "}
                {data.initialPermit.ongoingContracts}건
                {data.initialPermit.excludedContracts > 0 && ` · 집계 제외 ${data.initialPermit.excludedContracts}건`}
                {data.initialPermit.completedWithoutPermitNo > 0 && ` · 사업장 수·결정번호 없이 1개소로 센 완료 계약 ${data.initialPermit.completedWithoutPermitNo}건`}
              </span>
            )}
            <select
              className="cd-select ml-auto"
              style={{ width: "auto" }}
              value={permitFilter}
              onChange={(e) => {
                setPermitFilter(e.target.value as typeof permitFilter);
                resetPage();
              }}
              aria-label="최초허가 계약 거르기"
            >
              <option value="completed">완료</option>
              <option value="ongoing">수행 중</option>
              <option value="all">전체</option>
            </select>
          </div>
          {data && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {data.initialPermit.byCohort.map((c) => (
                <span key={c.id} className="cd-pill cd-pill-idle tabular-nums">
                  {c.label} {c.sites}
                </span>
              ))}
            </div>
          )}
          {permitRows.length === 0 ? (
            <p className="text-sm cd-text-faint py-4 text-center">{loading ? "불러오는 중…" : "해당하는 계약이 없습니다."}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="cd-table">
                  <thead>
                    <tr>
                      <th>수주 연도</th>
                      <th>사업장</th>
                      <th>업종</th>
                      <th>업종군</th>
                      <th>허가일</th>
                      <th>결정번호</th>
                      <th>상태</th>
                      <th className="text-right">사업장 수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => (
                      <tr key={r.contractId}>
                        <td className="tabular-nums">{r.year || "—"}</td>
                        <td className="cd-text">
                          {r.source === "manual" ? (
                            <>
                              {r.party || r.contractTitle}
                              <span className="cd-pill cd-pill-idle ml-1">계약 없음</span>
                            </>
                          ) : (
                            <Link href={`/contracts?contract=${encodeURIComponent(r.contractId)}${r.year ? `&year=${r.year}` : ""}`} className="hover:underline">
                              {r.party || r.contractTitle}
                            </Link>
                          )}
                          {r.subtype && r.subtype !== "최초허가" && <span className="ml-1 text-[11px] cd-text-faint">({r.subtype})</span>}
                        </td>
                        <td className="cd-text-muted whitespace-nowrap">{r.industry || "—"}</td>
                        <td className="cd-text-muted whitespace-nowrap">{cohortLabel(r.cohortId)}</td>
                        <td className="tabular-nums whitespace-nowrap">{r.permitIssuedAt || (r.completedAt ? <span className="cd-text-faint">계산서 {r.completedAt}</span> : "—")}</td>
                        <td className="tabular-nums">{r.permitNo || "—"}</td>
                        <td>
                          <span className={`cd-pill ${r.completed ? "cd-pill-success" : "cd-pill-idle"}`}>{r.completed ? "완료" : "수행 중"}</span>
                        </td>
                        <td className="text-right tabular-nums whitespace-nowrap">
                          {r.completed && r.siteCountSet && r.sites === 0 ? (
                            <span className="text-[11px] cd-text-faint">집계 제외</span>
                          ) : (
                            <>
                              {r.sites || "—"}
                              {r.siteCountSet && <span className="ml-1 text-[11px] cd-text-faint">지정</span>}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3">{pager}</div>
            </>
          )}
          {canEditProfile && (
            <p className="text-xs cd-text-faint mt-3">
              연혁·인증·특허는 <Link href="/admin/company-profile" className="cd-text-primary">회사 프로필 관리</Link>에서 고칩니다.
            </p>
          )}
        </section>
      )}

      {steward && (
        <CatalogPendingModal
          open={modal === "pending"}
          onClose={() => setModal(null)}
          pending={pending}
          canPublish={canPublish}
          onPublish={() => openPublish(null)}
        />
      )}
      {canPublish && (
        <CatalogPublishModal
          open={modal === "publish"}
          onClose={() => setModal(null)}
          pendingCount={pendingCount}
          fromEdition={publishFrom}
          onPublished={() => {
            void reloadEditions();
            void reloadPending();
            setRenderTick((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
