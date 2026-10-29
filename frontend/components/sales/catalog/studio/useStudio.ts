"use client";

// 스튜디오 상태 — 불러오기·편집(실행 취소/다시 실행)·자동 저장·쪽 트리 계산.
// 편집 상태 = 문서 설정(theme) + 쪽 상태(순서·숨김·편집층). 데이터(렌더 데이터)는 열 때마다 서버에서 새로 읽는다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentTheme } from "@/lib/catalog/document-theme";
import type { CoverChoice } from "@/lib/catalog/render/components/pages-front";
import type { PagePlanItem } from "@/lib/catalog/render/components/plan";
import type { CatalogRenderData, ImageKey, RenderCtx, RenderOptions } from "@/lib/catalog/render/types";
import { usableFontSet, type FontSetDef } from "@/lib/catalog/fonts";
import { composePage, orderedPlan, variantsOf, type ComposedPage } from "@/lib/catalog/studio/compose";
import { pageState, upsertPage, withOrder, type StudioDoc, type StudioPageState } from "@/lib/catalog/studio/doc";
import type { PageEdits } from "@/lib/catalog/studio/edits";
import type { TreeEnv } from "@/lib/catalog/studio/render-tree";
import type { StudioImageAsset } from "@/lib/catalog/studio/store";
import { illustIdsIn, type IllustrationRender } from "@/lib/catalog/illustration-types";
import { illustrationRender, registerIllustrations } from "@/lib/catalog/render/infographic/illustration";
import { catalogFetch } from "../catalogFetch";

export interface StudioPayload {
  doc: StudioDoc;
  data: CatalogRenderData;
  cover: CoverChoice;
  prefs: Record<string, { type: string; variant: string | null }>;
  assets: StudioImageAsset[];
  opts: RenderOptions;
  /** 서체 라이브러리 세트(사용자 세트) */
  fontSets?: FontSetDef[];
  /** 문서가 쓰는 일러스트(313) — 정보 + 정리한 SVG */
  illustrations?: IllustrationRender[];
}

/** 아직 등록하지 않은 일러스트를 받아 등록한다(스튜디오가 그리기 전에) — 받은 것이 있으면 true */
export async function ensureIllustrations(ids: string[]): Promise<boolean> {
  const missing = ids.filter((id) => !illustrationRender(id));
  if (!missing.length) return false;
  const r = await catalogFetch<{ items: IllustrationRender[] }>(`/api/catalog/illustrations/render?ids=${missing.join(",")}`);
  registerIllustrations(r.items);
  return r.items.length > 0;
}

export interface DocState {
  theme: DocumentTheme;
  pages: StudioPageState[];
}

const AUTOSAVE_MS = 1200;
const HISTORY = 100;

export function previewUrl(key: ImageKey): string {
  if (key.startsWith("k/")) return `/catalog-kit/${key.slice(2)}`;
  return `/api/catalog/render/asset?key=${encodeURIComponent(key)}`;
}

/** 표지 사진 — 서버가 해상도까지 본 결과가 있으면 그것, 표지 디자인을 바꾸면 그 디자인의 기본 사진 */
function coverFor(theme: DocumentTheme, server: CoverChoice): CoverChoice {
  if (theme.cover === "center" || theme.coverPhoto === "none") return { cover: theme.cover, photo: null };
  if (server.cover === theme.cover) return server;
  return { cover: theme.cover, photo: theme.cover === "band" ? "k/assets/hq-cover-wide.webp" : "k/assets/hq-cover-tall.webp" };
}

export function useStudio(docId: string) {
  const [view, setView] = useState<RenderOptions>({ edition: "print", naming: "masked" });
  const [payload, setPayload] = useState<StudioPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<DocState | null>(null);
  const [rev, setRev] = useState("");
  const [version, setVersion] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "pending" | "saving" | "saved" | "error" | "conflict">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const past = useRef<DocState[]>([]);
  const future = useRef<DocState[]>([]);
  const [histTick, setHistTick] = useState(0);
  const dirty = useRef(false);
  const stateRef = useRef<DocState | null>(null);
  stateRef.current = state;
  const revRef = useRef(rev);
  revRef.current = rev;

  const load = useCallback(
    async (v: RenderOptions) => {
      setLoadError(null);
      try {
        const q = new URLSearchParams({ doc: docId, edition: v.edition, naming: v.naming });
        const p = await catalogFetch<StudioPayload>(`/api/catalog/studio?${q}`);
        registerIllustrations(p.illustrations ?? []);
        setPayload(p);
        setState({ theme: p.doc.theme, pages: p.doc.pages });
        setRev(p.doc.rev);
        setVersion(p.doc.version);
        past.current = [];
        future.current = [];
        dirty.current = false;
        setHistTick((t) => t + 1);
        setSaveState("idle");
        setSaveError(null);
      } catch (e) {
        setLoadError((e as Error).message);
      }
    },
    [docId]
  );

  useEffect(() => {
    load(view);
    // 보기 바꾸기는 changeView 가 저장 후 다시 부른다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // ── 쪽 계획·트리 ──
  const theme = state?.theme ?? payload?.doc.theme;
  const fontSet = usableFontSet(theme?.fontSet, payload?.fontSets).id;
  const ctx: RenderCtx | null = useMemo(
    () =>
      payload && theme
        ? { url: previewUrl, opts: payload.opts, docLabel: payload.data.docLabel, fontSet, concept: theme.concept, template: theme.template, motif: theme.motif }
        : null,
    [payload, theme, fontSet]
  );
  const data: CatalogRenderData | null = useMemo(() => (payload && theme ? { ...payload.data, theme } : null), [payload, theme]);
  const cover = useMemo(() => (payload && theme ? coverFor(theme, payload.cover) : null), [payload, theme]);
  const pages = state?.pages;
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  // 쪽 계획은 쪽 변형·순서가 바뀔 때만 다시 만든다(글·배치 편집 때는 그대로 → 편집한 쪽만 다시 변환)
  const variantSig = useMemo(() => JSON.stringify(variantsOf(pages ?? [])), [pages]);
  const orderSig = useMemo(() => JSON.stringify((pages ?? []).map((p) => [p.key, p.order])), [pages]);
  const plan: PagePlanItem[] = useMemo(
    () => (ctx && data && cover && pagesRef.current ? orderedPlan(ctx, data, cover, pagesRef.current) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx, data, cover, variantSig, orderSig]
  );
  // 일러스트 SVG 는 그릴 때 등록표에서 꺼낸다 — 새로 받으면 env 를 바꿔 캔버스·썸네일을 다시 그린다
  const [illustTick, setIllustTick] = useState(0);
  const illustSig = useMemo(() => illustIdsIn(state?.pages ?? []).join(","), [state]);
  useEffect(() => {
    if (!illustSig) return;
    let alive = true;
    ensureIllustrations(illustSig.split(","))
      .then((got) => alive && got && setIllustTick((t) => t + 1))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [illustSig]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const env: TreeEnv | null = useMemo(() => (data ? { url: previewUrl, data } : null), [data, illustTick]);

  // 쪽 트리 캐시 — 같은 쪽 요소·같은 편집층이면 다시 만들지 않는다
  const cache = useRef(new Map<string, { element: unknown; edits: PageEdits | undefined; hidden: boolean; composed: ComposedPage }>());
  const composedOf = useCallback(
    (item: PagePlanItem): ComposedPage => {
      const st = pages ? pageState(pages, item.key) : null;
      const hit = cache.current.get(item.key);
      if (hit && hit.element === item.element && hit.edits === st?.edits && hit.hidden === (st?.hidden ?? false)) return hit.composed;
      const composed = composePage(item, st, { metrics: data?.metrics });
      cache.current.set(item.key, { element: item.element, edits: st?.edits, hidden: st?.hidden ?? false, composed });
      return composed;
    },
    [pages, data]
  );

  // ── 편집(실행 취소 가능) ──
  // 같은 조작이 잇달아 오면(입력칸 타자·밀대 끌기) 실행 취소 한 단계로 묶는다
  const lastMerge = useRef<{ key: string; at: number } | null>(null);
  const apply = useCallback((fn: (s: DocState) => DocState, mergeKey?: string) => {
    const cur = stateRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next === cur) return;
    const now = Date.now();
    const merge = mergeKey && lastMerge.current?.key === mergeKey && now - lastMerge.current.at < 1500;
    lastMerge.current = mergeKey ? { key: mergeKey, at: now } : null;
    if (!merge) past.current = [...past.current.slice(-HISTORY + 1), cur];
    future.current = [];
    dirty.current = true;
    // 바로 이어서 저장(save)을 부르는 조작(AI 바꿈 채택 → 버전 저장)이 새 상태를 읽도록 렌더 전에 맞춰 둔다
    stateRef.current = next;
    setState(next);
    setSaveState("pending");
    setHistTick((t) => t + 1);
  }, []);

  const undo = useCallback(() => {
    const cur = stateRef.current;
    const prev = past.current[past.current.length - 1];
    if (!cur || !prev) return;
    past.current = past.current.slice(0, -1);
    future.current = [cur, ...future.current];
    dirty.current = true;
    setState(prev);
    setSaveState("pending");
    setHistTick((t) => t + 1);
  }, []);

  const redo = useCallback(() => {
    const cur = stateRef.current;
    const nxt = future.current[0];
    if (!cur || !nxt) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, cur];
    dirty.current = true;
    setState(nxt);
    setSaveState("pending");
    setHistTick((t) => t + 1);
  }, []);

  const setPageEdits = useCallback(
    (key: string, fn: (edits: PageEdits) => PageEdits, mergeKey?: string) =>
      apply((s) => {
        const st = pageState(s.pages, key);
        const edits = fn(st.edits);
        return edits === st.edits ? s : { ...s, pages: upsertPage(s.pages, { ...st, edits }) };
      }, mergeKey),
    [apply]
  );

  const setTheme = useCallback((patch: Partial<DocumentTheme>) => apply((s) => ({ ...s, theme: { ...s.theme, ...patch } })), [apply]);

  const setPageHidden = useCallback(
    (key: string, hidden: boolean) =>
      apply((s) => {
        const st = pageState(s.pages, key);
        return { ...s, pages: upsertPage(s.pages, { ...st, hidden }) };
      }),
    [apply]
  );

  const reorder = useCallback((keys: string[]) => apply((s) => ({ ...s, pages: withOrder(s.pages, keys) })), [apply]);

  const replaceState = useCallback((next: DocState) => apply(() => next), [apply]);

  // ── 자동 저장 ──
  const meta = useMemo(() => Object.fromEntries(plan.map((p) => [p.key, { type: p.type, section: p.section }])), [plan]);
  const metaRef = useRef(meta);
  metaRef.current = meta;

  const save = useCallback(async (): Promise<boolean> => {
    const s = stateRef.current;
    if (!s || !dirty.current) return true;
    dirty.current = false;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/catalog/studio?doc=${encodeURIComponent(docId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rev: revRef.current, pages: s.pages, meta: metaRef.current, theme: s.theme }),
      });
      const body = (await res.json().catch(() => ({}))) as { rev?: string; error?: string; conflict?: boolean };
      if (res.status === 409) {
        setSaveState("conflict");
        setSaveError(body.error ?? "다른 곳에서 먼저 고쳤습니다.");
        return false;
      }
      if (!res.ok) throw new Error(body.error ?? `저장하지 못했습니다(HTTP ${res.status}).`);
      if (body.rev) setRev(body.rev);
      setSavedAt(new Date().toISOString());
      setSaveError(null);
      // 저장하는 동안 또 고쳤으면 다음 저장을 기다린다
      setSaveState(dirty.current ? "pending" : "saved");
      return true;
    } catch (e) {
      dirty.current = true;
      setSaveState("error");
      setSaveError((e as Error).message);
      return false;
    }
  }, [docId]);

  useEffect(() => {
    if (saveState !== "pending") return;
    const t = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [saveState, state, save]);

  // 저장 전에 떠나려 하면 묻는다
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, []);

  /** 보기(판·이름) 바꾸기 — 저장한 뒤 데이터를 새로 읽는다 */
  const changeView = useCallback(
    async (v: RenderOptions) => {
      await save();
      setView(v);
      await load(v);
    },
    [save, load]
  );

  /** 버전 저장처럼 서버가 문서 시각을 바꾼 뒤 그 값을 받아 둔다(다음 자동 저장이 충돌로 막히지 않게) */
  const adoptRev = useCallback((r: string, v?: number) => {
    setRev(r);
    if (v != null) setVersion(v);
  }, []);

  return {
    adoptRev,
    version,
    view,
    changeView,
    reload: () => load(view),
    payload,
    loadError,
    state,
    ctx,
    data,
    cover,
    env,
    plan,
    fontSet,
    composedOf,
    apply,
    setPageEdits,
    setTheme,
    setPageHidden,
    reorder,
    replaceState,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    histTick,
    save,
    saveState,
    saveError,
    savedAt,
  };
}

export type Studio = ReturnType<typeof useStudio>;
