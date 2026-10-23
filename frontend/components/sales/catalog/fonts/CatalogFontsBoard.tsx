"use client";

// 서체 라이브러리 — 회사소개서에 쓸 서체를 올리고(분석·라이선스 확인) 견본을 보고, 제목·본문·숫자 세트를 만든다. docs/company-catalog-blueprint.md §5·§11
// 서체는 지우지 않고 비활성화한다(지난 PDF 를 같은 서체로 다시 만들 수 있게). 세트 적용은 스튜디오 서체 탭.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PenTool, Plus, RefreshCw, Type, Upload } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdHelp } from "@/components/cdash/CdHelp";
import { useCdToast } from "@/components/cdash/CdToast";
import { EMBED_LABEL, FONT_CLASS_LABEL, LICENSE_TYPES, type CatalogFont, type CatalogFontSet, type FontClass, type FontUsage, type WeightMap } from "@/lib/catalog/font-types";
import { catalogFetch } from "../catalogFetch";
import { FontDetailDrawer } from "./FontDetailDrawer";
import { FontSetEditor } from "./FontSetEditor";
import { FontUploadModal } from "./FontUploadModal";
import "@/components/cdash/cdash.css";

type SetRow = CatalogFontSet & { available: boolean; issues: string[]; warnings: string[] };

interface FontsResponse {
  fonts: CatalogFont[];
  sets: SetRow[];
  presets: Array<{ id: string; label: string; desc: string; roles: { display: string; body: string; figure: string }; available: boolean; note: string | null }>;
  usage: FontUsage;
}

export function CatalogFontsBoard() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const [data, setData] = useState<FontsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CatalogFontSet | "new" | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await catalogFetch<FontsResponse>("/api/catalog/fonts"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const fonts = useMemo(() => data?.fonts ?? [], [data]);
  const shown = fonts.filter((f) => showInactive || f.isActive);
  const inactiveCount = fonts.filter((f) => !f.isActive).length;
  const usage = data?.usage ?? null;
  const setNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of data?.presets ?? []) out[p.id] = p.label;
    for (const x of data?.sets ?? []) out[x.setId] = x.name;
    return out;
  }, [data]);
  const fontName = (id: string) => fonts.find((f) => f.fontId === id)?.displayName ?? id;
  const detail = fonts.find((f) => f.fontId === detailId) ?? null;

  const patchFont = async (patch: { displayName?: string; classification?: FontClass; isActive?: boolean }) => {
    if (!detail) return false;
    setBusy(true);
    try {
      await catalogFetch(`/api/catalog/fonts/${encodeURIComponent(detail.fontId)}`, { method: "PATCH", body: JSON.stringify(patch) });
      await reload();
      toast(patch.isActive === false ? "비활성화했습니다." : patch.isActive ? "다시 쓰도록 켰습니다." : "저장했습니다.", "success");
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveSet = async (input: { setId: string | null; name: string; displayFontId: string; bodyFontId: string; figureFontId: string; weightMap: WeightMap }) => {
    setBusy(true);
    try {
      await catalogFetch("/api/catalog/fonts/sets", { method: "POST", body: JSON.stringify(input) });
      await reload();
      toast(`세트 '${input.name}'를 저장했습니다. 스튜디오 서체 탭에서 적용합니다.`, "success");
      return true;
    } catch (e) {
      toast((e as Error).message, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const removeSet = async (set: SetRow) => {
    if (!window.confirm(`세트 '${set.name}'를 지울까요? 이 세트로 만든 지난 PDF 는 그대로 남습니다.`)) return;
    setBusy(true);
    try {
      await catalogFetch(`/api/catalog/fonts/sets?id=${encodeURIComponent(set.setId)}`, { method: "DELETE" });
      await reload();
      toast("세트를 지웠습니다.", "success");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const usedBy = (f: CatalogFont) => {
    const sets = usage?.setsByFont[f.fontId] ?? [];
    const docs = new Set(sets.flatMap((id) => (usage?.documentsBySet[id] ?? []).map((d) => d.docId)));
    return { sets: sets.length, docs: docs.size, pdfs: usage?.editionsByFont[f.fontId] ?? 0 };
  };

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<Type className="w-5 h-5" />}
        eyebrow="회사소개서"
        breadcrumbs={[{ label: "회사소개서", href: "/sales/catalog" }, { label: "서체 라이브러리" }]}
        title="서체 라이브러리"
        titleSuffix={data ? `${fonts.filter((f) => f.isActive).length}종` : undefined}
        helpTopic="catalog.fonts"
        actions={
          <>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={reload} disabled={loading || busy}>
              <RefreshCw className="w-3.5 h-3.5" /> 새로 고침
            </button>
            <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" onClick={() => setUploadOpen(true)} disabled={busy}>
              <Upload className="w-3.5 h-3.5" /> 서체 올리기
            </button>
          </>
        }
      />

      {error && <div className="cd-error-bg cd-error-text rounded-lg px-4 py-3 text-sm mb-3">{error}</div>}

      <section className="cd-card p-4 mb-3">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <h3 className="cd-text font-semibold text-base flex items-center gap-1">
            서체 <CdHelp topic="catalog.fonts-verdict" />
          </h3>
          {inactiveCount ? (
            <label className="inline-flex items-center gap-1.5 text-xs ml-auto">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> 비활성 서체도 보기({inactiveCount})
            </label>
          ) : null}
        </div>
        {loading && !data ? (
          <p className="text-sm cd-text-faint py-6 text-center">불러오는 중…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="cd-table">
              <thead>
                <tr>
                  <th>서체</th>
                  <th>굵기</th>
                  <th>용도</th>
                  <th className="text-right">한글 완성형</th>
                  <th>포함 허용</th>
                  <th>라이선스</th>
                  <th>쓰는 곳</th>
                  <th style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {shown.map((f) => {
                  const u = usedBy(f);
                  return (
                    <tr key={f.fontId} style={f.isActive ? undefined : { opacity: 0.6 }}>
                      <td className="cd-text">
                        <span className="inline-flex items-center gap-1.5 flex-wrap">
                          {f.displayName}
                          <span className="cd-pill cd-pill-idle">{f.source === "bundled" ? "기본" : "업로드"}</span>
                          {!f.isActive ? <span className="cd-pill cd-pill-idle">비활성</span> : null}
                        </span>
                        <span className="block text-[11px] cd-text-faint">
                          {f.family} · {FONT_CLASS_LABEL[f.classification]}
                        </span>
                      </td>
                      <td className="tabular-nums text-xs">{f.files.filter((x) => x.style === "normal").map((x) => x.weight).join(" · ")}</td>
                      <td>
                        {f.bodyCapable ? <span className="cd-pill cd-pill-success">본문 가능</span> : <span className="cd-pill cd-pill-warn">제목 전용</span>}
                        {f.reasons.length ? <span className="block text-[11px] cd-text-faint mt-0.5">{f.reasons.join(" · ")}</span> : null}
                      </td>
                      <td className="text-right tabular-nums">
                        {((f.coverage.hangul2350 / 2350) * 100).toFixed(f.coverage.hangul2350 === 2350 ? 0 : 1)}%
                        <span className="block text-[11px] cd-text-faint">{f.coverage.hangul2350.toLocaleString()}자</span>
                      </td>
                      <td>
                        <span className={`cd-pill ${f.embed === "print" ? "cd-pill-warn" : "cd-pill-idle"}`}>{EMBED_LABEL[f.embed]}</span>
                      </td>
                      <td className="text-xs">{f.license ? LICENSE_TYPES.find((t) => t.id === f.license?.type)?.label ?? f.license.type : "—"}</td>
                      <td className="text-xs tabular-nums">
                        세트 {u.sets} · 문서 {u.docs}
                        {u.pdfs ? ` · PDF ${u.pdfs}` : ""}
                      </td>
                      <td className="whitespace-nowrap">
                        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setDetailId(f.fontId)} aria-label={`${f.displayName} 견본·분석 보기`}>
                          견본
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && !fonts.some((f) => f.source === "upload") ? (
          <p className="text-xs cd-text-faint mt-3">아직 올린 서체가 없습니다. [서체 올리기]로 TTF·OTF·WOFF2 파일을 올리면 분석해서 이 목록에 더합니다.</p>
        ) : null}
      </section>

      <section className="cd-card p-4">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <h3 className="cd-text font-semibold text-base flex items-center gap-1">
            서체 세트 <CdHelp topic="catalog.fonts-sets" />
          </h3>
          <span className="text-xs cd-text-muted">적용은 스튜디오 서체 탭에서</span>
          <span className="ml-auto inline-flex gap-1.5">
            <Link href="/sales/catalog/studio" className="cd-btn cd-btn-ghost cd-btn-sm cd-action">
              <PenTool className="w-3.5 h-3.5" /> 스튜디오
            </Link>
            <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => setEditing("new")} disabled={busy || !data}>
              <Plus className="w-3.5 h-3.5" /> 새 세트
            </button>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="cd-table">
            <thead>
              <tr>
                <th>세트</th>
                <th>제목</th>
                <th>본문</th>
                <th>숫자</th>
                <th>상태</th>
                <th>쓰는 문서</th>
                <th style={{ width: 130 }} />
              </tr>
            </thead>
            <tbody>
              {(data?.presets ?? []).map((p) => (
                <tr key={p.id}>
                  <td className="cd-text">
                    {p.label} <span className="cd-pill cd-pill-idle">기본 세트</span>
                  </td>
                  <td className="text-xs">{p.roles.display}</td>
                  <td className="text-xs">{p.roles.body}</td>
                  <td className="text-xs">{p.roles.figure}</td>
                  <td className="text-xs">{p.available ? "쓸 수 있음" : <span className="cd-text-muted">{p.note}</span>}</td>
                  <td className="text-xs">{(usage?.documentsBySet[p.id] ?? []).map((d) => d.title).join(", ") || "—"}</td>
                  <td />
                </tr>
              ))}
              {(data?.sets ?? []).map((x) => (
                <tr key={x.setId}>
                  <td className="cd-text">{x.name}</td>
                  <td className="text-xs">{fontName(x.displayFontId)}</td>
                  <td className="text-xs">{fontName(x.bodyFontId)}</td>
                  <td className="text-xs">{fontName(x.figureFontId)}</td>
                  <td className="text-xs" style={{ minWidth: 200 }}>
                    {x.available ? "쓸 수 있음" : <span className="cd-error-text">고를 수 없음 — {x.issues.join(" ")}</span>}
                    {x.available && x.warnings.length ? <span className="block text-[11px] cd-text-muted">{x.warnings.join(" ")}</span> : null}
                  </td>
                  <td className="text-xs">{(usage?.documentsBySet[x.setId] ?? []).map((d) => d.title).join(", ") || "—"}</td>
                  <td className="whitespace-nowrap">
                    <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setEditing(x)} disabled={busy}>
                      고치기
                    </button>
                    <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => void removeSet(x)} disabled={busy || Boolean(usage?.documentsBySet[x.setId]?.length)} aria-label={`${x.name} 세트 지우기`}>
                      지우기
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <FontUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onDone={(msg) => {
          setUploadOpen(false);
          toast(msg, "success");
          void reload();
        }}
      />
      <FontDetailDrawer font={detail} usage={usage} setNames={setNames} busy={busy} onClose={() => setDetailId(null)} onPatch={patchFont} />
      <FontSetEditor open={editing != null} initial={editing === "new" ? null : editing} fonts={fonts} busy={busy} onClose={() => setEditing(null)} onSave={saveSet} />
    </div>
  );
}
