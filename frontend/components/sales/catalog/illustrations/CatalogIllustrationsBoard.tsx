"use client";

// 일러스트 라이브러리 — 보유 스톡 인포그래픽 일러스트(Adobe Stock 등)를 회사소개서 모듈로 올리고 고치고 뺀다. docs/company-catalog-blueprint.md §4-5·§11
// 더하기: 관리자 PC 매처(scripts/catalog_assets export)가 만든 묶음 폴더를 통째로, 또는 SVG 한 장. 빼기: 쓰는 쪽이 있으면 보관(라이브러리에서만 숨김).
// 스튜디오에서는 인포그래픽을 골라 [일러스트로 그리기] 또는 [일러스트 넣기]로 쓴다.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FolderUp, Image as ImageIcon, PenTool, RefreshCw, Shapes } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdHelp } from "@/components/cdash/CdHelp";
import { useCdToast } from "@/components/cdash/CdToast";
import { INFO_TYPES, INFO_TYPE_META, type InfoType } from "@/lib/catalog/render/infographic/types";
import type { IllustrationInfo } from "@/lib/catalog/illustration-types";
import { catalogFetch } from "../catalogFetch";
import { IllustrationDetailDrawer } from "./IllustrationDetailDrawer";
import { IllustrationImportModal } from "./IllustrationImportModal";
import "@/components/cdash/cdash.css";

export const thumbUrl = (id: string, updatedAt?: string) => `/api/catalog/illustrations/${encodeURIComponent(id)}/file?f=thumb${updatedAt ? `&v=${encodeURIComponent(updatedAt)}` : ""}`;
export const svgUrl = (id: string) => `/api/catalog/illustrations/${encodeURIComponent(id)}/file?f=svg`;

export function licenseLine(info: IllustrationInfo): string {
  const l = info.license;
  return [l.provider, l.stockId ? `#${l.stockId}` : "", l.license].filter(Boolean).join(" · ") || "출처 미기록";
}

export function CatalogIllustrationsBoard() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const [items, setItems] = useState<IllustrationInfo[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<InfoType | "">("");
  const [count, setCount] = useState<number | "">("");
  const [showArchived, setShowArchived] = useState(false);
  const [importMode, setImportMode] = useState<"folder" | "svg" | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems((await catalogFetch<{ items: IllustrationInfo[] }>("/api/catalog/illustrations?all=1")).items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const all = useMemo(() => items ?? [], [items]);
  const archived = all.filter((i) => i.status === "archived").length;
  const counts = useMemo(() => [...new Set(all.map((i) => i.count))].sort((a, b) => a - b), [all]);
  const shown = all.filter((i) => (showArchived || i.status === "active") && (!type || i.type === type || i.altTypes.includes(type)) && (count === "" || i.count === count));
  const detail = all.find((i) => i.assetId === detailId) ?? null;

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<Shapes className="w-5 h-5" />}
        eyebrow="회사소개서"
        breadcrumbs={[{ label: "회사소개서", href: "/sales/catalog" }, { label: "일러스트 라이브러리" }]}
        title="일러스트 라이브러리"
        titleSuffix={items ? `${all.length - archived}점` : undefined}
        helpTopic="catalog.illustrations"
        actions={
          <>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => void reload()} disabled={loading}>
              <RefreshCw className="w-3.5 h-3.5" /> 새로 고침
            </button>
            <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => setImportMode("svg")}>
              <ImageIcon className="w-3.5 h-3.5" /> SVG 한 장 올리기
            </button>
            <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" onClick={() => setImportMode("folder")}>
              <FolderUp className="w-3.5 h-3.5" /> 묶음 폴더 가져오기
            </button>
          </>
        }
      />

      {error && <div className="cd-error-bg cd-error-text rounded-lg px-4 py-3 text-sm mb-3">{error}</div>}

      <section className="cd-card p-4">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <h3 className="cd-text font-semibold text-base flex items-center gap-1">
            일러스트 <CdHelp topic="catalog.illustrations-use" />
          </h3>
          <label className="text-xs cd-text-muted flex items-center gap-1.5">
            유형
            <select className="cd-select" style={{ width: 130 }} value={type} onChange={(e) => setType(e.target.value as InfoType | "")}>
              <option value="">전체</option>
              {INFO_TYPES.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs cd-text-muted flex items-center gap-1.5">
            항목 수
            <select className="cd-select" style={{ width: 90 }} value={count} onChange={(e) => setCount(e.target.value ? Number(e.target.value) : "")}>
              <option value="">전체</option>
              {counts.map((n) => (
                <option key={n} value={n}>
                  {n}항목
                </option>
              ))}
            </select>
          </label>
          {archived ? (
            <label className="inline-flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> 보관한 것도 보기({archived})
            </label>
          ) : null}
          <Link href="/sales/catalog/studio" className="cd-btn cd-btn-ghost cd-btn-sm cd-action ml-auto">
            <PenTool className="w-3.5 h-3.5" /> 스튜디오
          </Link>
        </div>
        {loading && !items ? (
          <p className="text-sm cd-text-faint py-6 text-center">불러오는 중…</p>
        ) : shown.length === 0 ? (
          <p className="text-sm cd-text-faint py-6 text-center">
            {all.length ? "조건에 맞는 일러스트가 없습니다." : "아직 올린 일러스트가 없습니다. [묶음 폴더 가져오기]로 매처 export 폴더를 고르세요."}
          </p>
        ) : (
          <ul className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {shown.map((i) => (
              <li key={i.assetId}>
                <button
                  type="button"
                  className="cd-action w-full text-left rounded-lg border cd-border-c p-2 flex flex-col gap-1.5"
                  style={i.status === "archived" ? { opacity: 0.6 } : undefined}
                  onClick={() => setDetailId(i.assetId)}
                  aria-label={`${i.title} 자리·정보 보기`}
                >
                  <span className="block rounded border cd-border-c overflow-hidden" style={{ background: "#fff", aspectRatio: "4 / 3" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbUrl(i.assetId, i.updatedAt)}
                      alt=""
                      className="w-full h-full"
                      style={{ objectFit: "contain" }}
                      loading="lazy"
                      onError={(e) => {
                        // 미리보기 PNG 가 없으면(SVG 한 장으로 올린 것) SVG 를 그대로 보여 준다
                        const img = e.currentTarget;
                        if (!img.dataset.fallback) {
                          img.dataset.fallback = "1";
                          img.src = svgUrl(i.assetId);
                        }
                      }}
                    />
                  </span>
                  <span className="text-sm cd-text font-medium line-clamp-1">{i.title}</span>
                  <span className="flex flex-wrap gap-1 text-[11px]">
                    <span className="cd-pill cd-pill-info">{INFO_TYPE_META[i.type].label}</span>
                    <span className="cd-pill cd-pill-idle">{i.count}항목</span>
                    {i.quality ? <span className="cd-pill cd-pill-idle">품질 {i.quality}</span> : null}
                    {i.status === "archived" ? <span className="cd-pill cd-pill-warn">보관</span> : null}
                    {!i.slots.length ? <span className="cd-pill cd-pill-warn">글자 자리 없음</span> : null}
                  </span>
                  <span className="text-[11px] cd-text-muted line-clamp-1">{licenseLine(i)}</span>
                  {i.fits.length ? <span className="text-[11px] cd-text-faint line-clamp-1">추천 자리 {i.fits.slice(0, 3).map((f) => `${f.page} ${f.fit ?? ""}`.trim()).join(" · ")}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <IllustrationImportModal
        mode={importMode}
        onClose={() => setImportMode(null)}
        onDone={(msg) => {
          setImportMode(null);
          toast(msg, "success");
          void reload();
        }}
      />
      <IllustrationDetailDrawer
        info={detail}
        onClose={() => setDetailId(null)}
        onSaved={(msg) => {
          toast(msg, "success");
          void reload();
        }}
        onRemoved={(msg) => {
          setDetailId(null);
          toast(msg, "success");
          void reload();
        }}
      />
    </div>
  );
}
