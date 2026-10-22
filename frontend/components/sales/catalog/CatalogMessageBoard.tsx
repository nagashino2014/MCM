"use client";

// 대표이사 인사말 — 본문·사진·서명을 언제든 고치고 판(버전)을 기록한다(사용자 요구 10-22).
// [임시 저장]은 편집 중 내용만 남기고, [확정]하면 새 판으로 기록된다. 회사소개서는 최신 확정판을 쓴다.
// 데이터: lib/catalog/contents.ts(catalog_contents·catalog_content_versions)

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageUp, MessageSquareQuote, RefreshCw, Save, Stamp } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdHelp } from "@/components/cdash/CdHelp";
import type { CeoMessage, ContentState as AnyContentState } from "@/lib/catalog/content-types";
import { catalogFetch } from "./catalogFetch";
import { ContentVersions } from "./ContentVersions";

type ContentState = AnyContentState<"ceo_message">;
import "@/components/cdash/cdash.css";

const API = "/api/catalog/contents/ceo_message";

export function CatalogMessageBoard() {
  const { theme } = useCdashTheme();
  const [state, setState] = useState<ContentState | null>(null);
  const [draft, setDraft] = useState<CeoMessage | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = (s: ContentState) => {
    setState(s);
    setDraft(s.draft);
  };

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      apply(await catalogFetch<ContentState>(API));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const dirty = useMemo(() => !!state && !!draft && JSON.stringify(state.draft) !== JSON.stringify(draft), [state, draft]);

  const saveDraft = async () => {
    if (!draft) return;
    setBusy(true);
    setNotice(null);
    try {
      apply(await catalogFetch<ContentState>(API, { method: "PUT", body: JSON.stringify({ data: draft }) }));
      setNotice("임시 저장했습니다. 소개서에는 확정해야 반영됩니다.");
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    if (!draft) return;
    if (!confirm("지금 내용을 확정해 새 판으로 기록할까요? 이후 만드는 회사소개서에 이 판이 쓰입니다.")) return;
    setBusy(true);
    setNotice(null);
    try {
      const next = await catalogFetch<ContentState>(API, { method: "POST", body: JSON.stringify({ action: "publish", data: draft, note }) });
      apply(next);
      setNote("");
      setNotice(`${next.publishedVersion}판으로 확정했습니다.`);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const restore = async (version: number) => {
    if (dirty && !confirm("저장하지 않은 편집 내용이 있습니다. 버리고 이 판을 불러올까요?")) return;
    setBusy(true);
    setNotice(null);
    try {
      apply(await catalogFetch<ContentState>(API, { method: "POST", body: JSON.stringify({ action: "restore", version }) }));
      setNotice(`${version}판을 불러왔습니다. 고친 뒤 확정하면 새 판으로 기록됩니다.`);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const uploadPhoto = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("kind", "photo");
      fd.append("file", file);
      const data = await catalogFetch<{ asset: { assetId: string } }>("/api/catalog/assets", { method: "POST", body: fd });
      setDraft((d) => (d ? { ...d, photoAssetId: data.asset.assetId } : d));
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const set = (patch: Partial<CeoMessage>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const paragraphs = (draft?.body ?? "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<MessageSquareQuote className="w-5 h-5" />}
        eyebrow="회사소개서"
        breadcrumbs={[{ label: "회사소개서", href: "/sales/catalog" }, { label: "대표이사 인사말" }]}
        title="대표이사 인사말"
        helpTopic="catalog.message"
        meta={
          state && (
            <span className="text-xs cd-text-muted">
              {state.publishedVersion ? `확정 ${state.publishedVersion}판` : "확정판 없음"}
              {state.draftDiffers && " · 확정 전 임시 저장본 있음"}
              {dirty && " · 저장하지 않은 편집"}
            </span>
          )
        }
        actions={
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={reload} disabled={loading || busy}>
            <RefreshCw className="w-3.5 h-3.5" /> 새로 고침
          </button>
        }
      />

      {error && <div className="cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm mb-3">{error}</div>}
      {notice && <div className="cd-card px-4 py-2 text-sm cd-text-muted mb-3" role="status">{notice}</div>}

      {loading || !draft ? (
        <div className="cd-card p-6 text-sm cd-text-faint text-center">불러오는 중…</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3">
          <section className="cd-card p-4">
            <div className="flex gap-4 flex-wrap">
              <div className="shrink-0 flex flex-col items-center gap-2" style={{ width: 132 }}>
                {draft.photoAssetId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/catalog/assets/${encodeURIComponent(draft.photoAssetId)}`} alt="대표이사 사진" className="w-32 h-44 object-cover rounded border cd-border-c" />
                ) : (
                  <div className="w-32 h-44 rounded border cd-border-c flex items-center justify-center text-xs cd-text-faint">사진 없음</div>
                )}
                <label className={`cd-btn cd-btn-soft cd-btn-sm cd-action cursor-pointer ${uploading ? "opacity-50 pointer-events-none" : ""}`} title="PNG·JPG·WebP, 10MB 이하. 3:4 세로 사진이 잘 맞습니다.">
                  <ImageUp className="w-3.5 h-3.5" /> {uploading ? "올리는 중" : draft.photoAssetId ? "사진 바꾸기" : "사진 올리기"}
                  <input
                    type="file"
                    className="hidden"
                    accept=".png,.jpg,.jpeg,.webp"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadPhoto(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                {draft.photoAssetId && (
                  <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => set({ photoAssetId: null })}>사진 빼기</button>
                )}
              </div>
              <div className="grid gap-3 flex-1 min-w-[260px] text-sm">
                <label className="grid gap-1">
                  <span className="text-xs cd-text-muted">제목</span>
                  <input className="cd-input" value={draft.title} placeholder="인사말" onChange={(e) => set({ title: e.target.value })} />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1">
                    <span className="text-xs cd-text-muted">서명 직함</span>
                    <input className="cd-input" value={draft.signTitle} placeholder="대표이사" onChange={(e) => set({ signTitle: e.target.value })} />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs cd-text-muted">서명 이름</span>
                    <input className="cd-input" value={draft.signName} onChange={(e) => set({ signName: e.target.value })} />
                  </label>
                </div>
              </div>
            </div>
            <label className="grid gap-1 mt-4 text-sm">
              <span className="text-xs cd-text-muted flex items-center gap-1">
                본문 — 빈 줄로 문단을 나눕니다 <span className="cd-text-faint">({draft.body.length.toLocaleString("ko-KR")}자 · {paragraphs.length}문단)</span>
              </span>
              <textarea className="cd-input" rows={16} value={draft.body} onChange={(e) => set({ body: e.target.value })} />
            </label>
            <div className="flex items-center gap-2 flex-wrap mt-3">
              <input className="cd-input flex-1 min-w-[200px]" value={note} placeholder="확정 메모(선택, 예: 2026 하반기판)" onChange={(e) => setNote(e.target.value)} aria-label="확정 메모" />
              <button type="button" className="cd-btn cd-btn-soft" disabled={busy || uploading || !dirty} onClick={saveDraft}>
                <Save className="w-3.5 h-3.5" /> 임시 저장
              </button>
              <button type="button" className="cd-btn cd-btn-primary" disabled={busy || uploading || !draft.body.trim()} onClick={publish}>
                <Stamp className="w-3.5 h-3.5" /> 확정
              </button>
            </div>
            <p className="text-[11px] cd-text-faint mt-2">확정하면 새 판으로 기록되고, 이후 만드는 회사소개서에 그 판이 쓰입니다. 이미 발행한 소개서는 바뀌지 않습니다.</p>
          </section>

          <div className="grid gap-3 content-start">
            <section className="cd-card p-4">
              <h3 className="cd-text font-semibold text-base mb-2">미리보기</h3>
              <div className="rounded-lg border cd-border-c p-4" style={{ background: "var(--cd-card)" }}>
                <p className="cd-text font-bold text-lg mb-3">{draft.title || "인사말"}</p>
                {paragraphs.length === 0 ? (
                  <p className="text-sm cd-text-faint">본문을 입력하면 여기에 문단으로 보입니다.</p>
                ) : (
                  paragraphs.map((p, i) => (
                    <p key={i} className="text-sm cd-text mb-2 whitespace-pre-line" style={{ wordBreak: "keep-all" }}>
                      {p}
                    </p>
                  ))
                )}
                <p className="text-sm cd-text text-right mt-4">
                  {draft.signTitle} <b>{draft.signName}</b>
                </p>
              </div>
            </section>
            <ContentVersions versions={state?.versions ?? []} busy={busy} helpTopic="catalog.message-versions" onRestore={restore} />
          </div>
        </div>
      )}
    </div>
  );
}
