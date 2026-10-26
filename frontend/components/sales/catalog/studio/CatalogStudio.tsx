"use client";

// 회사소개서 스튜디오(P5) — 쪽을 캔버스에서 직접 고친다. docs/company-catalog-blueprint.md §8
//   왼쪽: 쪽 썸네일(순서·숨김) · 가운데: A4 캔버스(안내선·검사 표식) · 오른쪽: 내용·디자인·서체·데이터
//   위: 실행 취소·다시 실행·버전·미리보기·PDF 받기. 고친 것은 자동 저장되고(편집층), 데이터를 새로 읽어도 유지된다.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Eye, Grid3x3, Hash, History, Loader2, PenTool, Redo2, RefreshCw, Sparkles, Undo2 } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdTabs } from "@/components/cdash/CdTabs";
import { CdHelp } from "@/components/cdash/CdHelp";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { useCdToast } from "@/components/cdash/CdToast";
import { usableFontSet } from "@/lib/catalog/fonts";
import type { RenderOptions } from "@/lib/catalog/render/types";
import { EDITION_LABEL, NAMING_LABEL } from "@/lib/catalog/render/types";
import { spanWidth } from "@/lib/catalog/studio/design-system";
import { pageState } from "@/lib/catalog/studio/doc";
import {
  addElement,
  hideNode,
  listItemOp,
  patchNodeStyle,
  resetNode,
  setImage,
  setInfo,
  setNodeContent,
  setNodeType,
  setVariant,
  unhideNode,
  type InfoOverride,
  type PageEdits,
} from "@/lib/catalog/studio/edits";
import { makeBindChip } from "@/lib/catalog/studio/binds";
import { appendCaret, placeChip } from "@/lib/catalog/studio/inline";
import { findNode, newUserId, type CNode } from "@/lib/catalog/studio/nodes";
import { renderNode } from "@/lib/catalog/studio/render-tree";
import { capabilities, resolveSelection } from "@/lib/catalog/studio/select";
import type { StudioImageAsset } from "@/lib/catalog/studio/store";
import { renderToStaticMarkup } from "react-dom/server";
import { catalogFetch } from "../catalogFetch";
import { metricBriefs } from "@/lib/catalog/ai/patch";
import { AiEditModal } from "./AiEditModal";
import { proposeShrink, type ClientProposal } from "./aiClient";
import { AssetPicker } from "./AssetPicker";
import { BindPicker } from "./BindPicker";
import { CHECK_LABEL, runFullCheck, type CheckItem, type FullCheckResult } from "./checks";
import { frameDocument, loadStudioKit, type StudioKit } from "./kit";
import { PanelContent } from "./PanelContent";
import { PanelData } from "./PanelData";
import { PanelDesign } from "./PanelDesign";
import { PanelFonts } from "./PanelFonts";
import { StudioCanvas, type BindTarget, type CanvasHandle } from "./StudioCanvas";
import { StudioThumbs } from "./StudioThumbs";
import type { StudioOps } from "./types";
import { useStudio } from "./useStudio";
import "@/components/cdash/cdash.css";

type PanelTab = "content" | "design" | "fonts" | "data";

interface VersionRow {
  version: number;
  note: string;
  savedAt: string;
  savedByName: string;
  pages: number;
}

const fmtTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** 인포그래픽 덧씌우기 병합 — 값이 undefined 인 키는 지운다(내용 원래대로 등) */
function mergeOverride(existing: InfoOverride | undefined, patch: InfoOverride): InfoOverride {
  const out: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as InfoOverride;
}

function newAdded(kind: "text" | "shape" | "image", asset?: string): CNode {
  const base = { id: newUserId(), tag: "div" };
  const at = { position: "absolute", left: "48px", top: "120px" };
  if (kind === "text")
    return { ...base, className: "kc-x-text", style: { ...at, width: `${spanWidth(4).toFixed(2)}px` }, typeStep: "body", children: [{ id: newUserId(), tag: "#text", text: "새 글상자 — 눌러서 고칩니다" }] };
  if (kind === "shape") return { ...base, className: "kc-x-shape kc-x-shape--round", style: { ...at, width: `${spanWidth(3).toFixed(2)}px`, height: "80px" } };
  return { ...base, className: "kc-x-image", style: { ...at, width: `${spanWidth(4).toFixed(2)}px`, height: "160px" }, asset: { key: asset ?? "k/assets/hq-cover-wide.webp" } };
}

export function CatalogStudio({ docId = "master" }: { docId?: string }) {
  const { theme: uiTheme } = useCdashTheme();
  const { toast } = useCdToast();
  const studio = useStudio(docId);
  const [baseKit, setKit] = useState<StudioKit | null>(null);
  const [kitError, setKitError] = useState<string | null>(null);
  const [curKey, setCurKey] = useState<string>("c01");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<PanelTab>("content");
  const [zoomMode, setZoomMode] = useState<"fit" | number>("fit");
  const [showGuides, setShowGuides] = useState(false);
  const [checks, setChecks] = useState<CheckItem[]>([]);
  const [fullCheck, setFullCheck] = useState<FullCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [prevFontSet, setPrevFontSet] = useState<string | null>(null);
  const [assets, setAssets] = useState<StudioImageAsset[]>([]);
  const [picker, setPicker] = useState<((key: string) => void) | null>(null);
  const [bindTarget, setBindTargetState] = useState<BindTarget | null>(null);
  // 지표 넣기 창을 연 자리(닫은 뒤 초점을 돌려준다)
  const bindReturn = useRef<HTMLElement | null>(null);
  const setBindTarget = useCallback((t: BindTarget | null) => {
    if (t) bindReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setBindTargetState(t);
  }, []);
  const closeBind = useCallback(() => {
    const t = bindTarget;
    const back = bindReturn.current;
    setBindTargetState(null);
    // 글 고치던 중이면 그 글 끝으로 돌아가 이어서 고친다
    setTimeout(() => (t?.atCaret ? canvasHandle.current?.focusChip(t.blockId, "") : back?.isConnected && back.focus()), 60);
  }, [bindTarget]);
  const [modal, setModal] = useState<null | "versions" | "preview" | "pdf" | "ai">(null);
  const [aiInitial, setAiInitial] = useState<ClientProposal | null>(null);
  const [shrinking, setShrinking] = useState(false);
  const canvasHandle = useRef<CanvasHandle | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const [mainW, setMainW] = useState(800);
  const [layoutW, setLayoutW] = useState(1400);
  const layoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadStudioKit()
      .then(setKit)
      .catch((e: Error) => setKitError(e.message));
  }, []);
  useEffect(() => {
    if (studio.payload) setAssets(studio.payload.assets);
  }, [studio.payload]);
  // 지면 키트 + 서체 라이브러리 세트(업로드 서체) — 캔버스·썸네일·검사 틀이 모두 이 키트로 서체를 싣는다
  const fontSets = studio.payload?.fontSets;
  const kit = useMemo(() => (baseKit ? { ...baseKit, fontSets: fontSets ?? [] } : null), [baseKit, fontSets]);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (mainRef.current) setMainW(mainRef.current.clientWidth);
      if (layoutRef.current) setLayoutW(layoutRef.current.clientWidth);
    });
    if (mainRef.current) ro.observe(mainRef.current);
    if (layoutRef.current) ro.observe(layoutRef.current);
    return () => ro.disconnect();
  }, [kit, studio.payload]);

  const plan = studio.plan;
  const item = plan.find((p) => p.key === curKey) ?? plan[0];
  useEffect(() => {
    if (item && item.key !== curKey) setCurKey(item.key);
  }, [item, curKey]);
  const composed = item ? studio.composedOf(item) : null;
  const tree = composed?.tree ?? null;
  const sel = useMemo(() => (tree && selectedId ? resolveSelection(tree, selectedId) : null), [tree, selectedId]);
  const caps = useMemo(() => (sel && item ? capabilities(sel, item.maxLevel) : null), [sel, item]);
  useEffect(() => {
    if (selectedId && tree && !sel) setSelectedId(null);
  }, [selectedId, tree, sel]);

  const zoom = zoomMode === "fit" ? Math.max(0.3, Math.min(1.5, (mainW - 48) / 842)) : zoomMode;
  const visibleIndex = useMemo(() => {
    let n = 0;
    for (const p of plan) {
      if (!pageState(studio.state?.pages ?? [], p.key).hidden) n += 1;
      if (p.key === curKey) return n;
    }
    return 1;
  }, [plan, studio.state, curKey]);

  const openPage = useCallback((key: string) => {
    setCurKey(key);
    setSelectedId(null);
    setChecks([]);
  }, []);

  // ── 편집 조작 ──
  const itemKey = item?.key;
  const setPageEdits = studio.setPageEdits;
  const pe = useCallback((fn: (e: PageEdits) => PageEdits, merge?: string) => itemKey && setPageEdits(itemKey, fn, merge), [itemKey, setPageEdits]);
  const ops: StudioOps = useMemo(() => {
    const derived = tree as CNode;
    return {
      select: setSelectedId,
      commitText: (id, children) => pe((e) => setNodeContent(e, derived, id, children)),
      patchStyle: (id, patch) => pe((e) => patchNodeStyle(e, derived, id, patch)),
      setType: (id, step) => pe((e) => setNodeType(e, derived, id, step)),
      hide: (id) => {
        pe((e) => hideNode(e, derived, id));
        setSelectedId(null);
      },
      unhide: (id) => pe((e) => unhideNode(e, id)),
      reset: (id, parts) => pe((e) => resetNode(e, id, parts ?? "all")),
      setInfo: (id, patch, slot) => {
        pe((e) => setInfo(e, id, patch === null ? null : mergeOverride(e.nodes?.[id]?.info, patch)), patch && "content" in patch ? `info:${id}` : undefined);
        if (patch?.type && slot) void catalogFetch("/api/catalog/studio/prefs", { method: "POST", body: JSON.stringify({ slot, type: patch.type, variant: patch.variant ?? null }) }).catch(() => undefined);
      },
      setImage: (id, ref) => pe((e) => setImage(e, derived, id, ref), `image:${id}`),
      listOp: (itemId, op) => pe((e) => listItemOp(e, derived, itemId, op)),
      addElement: (kind, asset) => {
        const node = newAdded(kind, asset);
        pe((e) => addElement(e, node));
        setSelectedId(node.id);
      },
      setVariant: (k, v) => pe((e) => setVariant(e, k, v)),
      pickImage: (cb) => setPicker(() => cb),
      requestBind: (blockId) => {
        const n = findNode(derived, blockId);
        if (n) setBindTarget({ blockId, children: appendCaret(n.children ?? []), atCaret: false });
      },
      dropOrphans: () => pe((e) => (composed?.orphans ?? []).reduce((acc, id) => resetNode(acc, id), e)),
      setShape: (id, shape) =>
        pe((e) => ({ ...e, added: (e.added ?? []).map((a) => (a.id === id ? { ...a, className: `kc-x-shape kc-x-shape--${shape}` } : a)) })),
    };
  }, [tree, pe, composed, setBindTarget]);

  // ── 지표 넣기 — 표식 자리에 칩을 넣는다(실행 취소 한 단계) ──
  const insertBind = useCallback(
    (bind: string, opts: { digits?: number; unit?: boolean }) => {
      const target = bindTarget;
      setBindTargetState(null);
      if (!target || !studio.data) return;
      const chip = makeBindChip(bind, studio.data, opts);
      if (!chip) {
        toast("이 지표는 지금 넣을 수 없습니다.", "error");
        return;
      }
      ops.commitText(target.blockId, placeChip(target.children, chip));
      setSelectedId(target.blockId);
      const back = bindReturn.current;
      setTimeout(() => (target.atCaret ? canvasHandle.current?.focusChip(target.blockId, chip.id) : back?.isConnected && back.focus()), 60);
    },
    [bindTarget, studio.data, ops, toast]
  );

  // ── 단축키 ──
  const { undo, redo } = studio;
  const onKeyCommand = useCallback(
    (key: string, e: KeyboardEvent): boolean => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && key.toLowerCase() === "z") {
        if (e.shiftKey) redo();
        else undo();
        return true;
      }
      if (mod && key.toLowerCase() === "y") {
        redo();
        return true;
      }
      if (!selectedId) return false;
      if (mod && e.code === "KeyK" && caps?.editText) {
        const t = canvasHandle.current?.captureBind();
        if (t) setBindTarget(t);
        return true;
      }
      if (key === "Escape") {
        setSelectedId(null);
        return true;
      }
      if ((key === "Delete" || key === "Backspace") && caps?.hide) {
        ops.hide(selectedId);
        return true;
      }
      if (key.startsWith("Arrow") && caps?.move) {
        const step = e.shiftKey ? 16 : 4;
        if (key === "ArrowLeft") canvasHandle.current?.nudge(-1, 0);
        else if (key === "ArrowRight") canvasHandle.current?.nudge(1, 0);
        else if (key === "ArrowUp") canvasHandle.current?.nudge(0, -step);
        else canvasHandle.current?.nudge(0, step);
        return true;
      }
      return false;
    },
    [undo, redo, selectedId, caps, ops, setBindTarget]
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.closest("input, textarea, select, [contenteditable='true'], [role='dialog']") || t.isContentEditable)) return;
      // 화면 다른 곳(메뉴 등)에서 누른 방향키·Delete 는 캔버스 영역에 초점이 있을 때만
      const inStudio = t?.closest?.("[data-studio-area]");
      const mod = e.ctrlKey || e.metaKey;
      if (!inStudio && !mod) return;
      if (onKeyCommand(e.key, e)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKeyCommand]);

  // ── 전체 넘침 검사(서체 적용 뒤) ──
  const runCheck = useCallback(async () => {
    if (!kit || !studio.env) return;
    setChecking(true);
    try {
      const body = plan
        .filter((p) => !pageState(studio.state?.pages ?? [], p.key).hidden)
        .map((p) => {
          const t = studio.composedOf(p).tree;
          return renderToStaticMarkup(renderNode(t, studio.env!, { decorate: (n, props) => (n.id === t.id ? { ...props, "data-studio-key": p.key } : props) }) as ReactElement);
        })
        .join("");
      // 서체 라이브러리 세트면 빠진 글자(역할 서체에 없어 프리텐다드로 채워지는 글자)도 찾는다
      const roleFonts = usableFontSet(studio.fontSet, kit.fontSets).roleFonts;
      const res = await runFullCheck(frameDocument(kit, studio.fontSet, { body: `<div class="pk-book">${body}</div>`, script: "paginate" }), 60000, roleFonts);
      setFullCheck(res);
    } finally {
      setChecking(false);
    }
  }, [kit, studio, plan]);

  // ── AI(P6) — [AI로 줄이기]: 넘친 요소를 줄인 제안을 [AI로 수정]과 같은 검토 화면으로 ──
  const aiShrink = useCallback(
    async (nodeIds: string[]) => {
      if (!item || !tree || !studio.data) return;
      setShrinking(true);
      try {
        const p = await proposeShrink(item, tree, nodeIds, metricBriefs(studio.data.metrics), docId);
        setAiInitial(p);
        setModal("ai");
      } catch (e) {
        toast((e as Error).message, "error");
      } finally {
        setShrinking(false);
      }
    },
    [item, tree, studio.data, docId, toast]
  );
  const removeCustomArea = useCallback(
    async (areaId: string) => {
      if (!window.confirm("이 사업 분야 쪽을 뺍니다. 분야 정의는 남아 관리자가 되살릴 수 있습니다. 계속할까요?")) return;
      try {
        await studio.save();
        await catalogFetch(`/api/catalog/ai/area?areaId=${encodeURIComponent(areaId)}`, { method: "DELETE" });
        await studio.reload();
        toast("사업 분야 쪽을 뺐습니다.", "success");
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },
    [studio, toast]
  );

  const applyFont = (id: string) => {
    const cur = studio.state?.theme.fontSet ?? "pretendard";
    if (cur === id) return;
    setPrevFontSet(cur);
    studio.setTheme({ fontSet: id });
    setFullCheck(null);
  };
  // 서체를 바꾸면 새 서체로 다시 조판해 검사한다
  const fontSet = studio.state?.theme.fontSet;
  const fontCheckRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!fontSet || !kit) return;
    if (fontCheckRef.current === undefined) {
      fontCheckRef.current = fontSet;
      return;
    }
    if (fontCheckRef.current === fontSet) return;
    fontCheckRef.current = fontSet;
    const t = setTimeout(() => void runCheck(), 300);
    return () => clearTimeout(t);
  }, [fontSet, kit, runCheck]);

  const warnByKey = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [k, list] of Object.entries(fullCheck?.byKey ?? {})) out[k] = list.length;
    if (item) out[item.key] = Math.max(out[item.key] ?? 0, checks.filter((c) => c.severity !== "info").length);
    return out;
  }, [fullCheck, checks, item]);

  const saveLabel = {
    idle: "",
    pending: "고친 내용 저장 대기",
    saving: "저장 중…",
    saved: studio.savedAt ? `저장됨 ${fmtTime(studio.savedAt).slice(11)}` : "저장됨",
    error: "저장하지 못했습니다",
    conflict: "다른 곳에서 먼저 고쳤습니다",
  }[studio.saveState];

  const compact = layoutW < 1100;
  const columns = compact ? "minmax(120px, 140px) minmax(0, 1fr) minmax(270px, 300px)" : "minmax(150px, 186px) minmax(0, 1fr) minmax(300px, 340px)";

  if (studio.loadError || kitError) {
    return (
      <div className="cdash cd-fields-white p-2" data-theme={uiTheme}>
        <div className="cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm">{studio.loadError ?? kitError}</div>
      </div>
    );
  }

  return (
    <div className="cdash cd-fields-white p-2 flex flex-col" data-theme={uiTheme} style={{ minHeight: "calc(100vh - 80px)" }}>
      <CdPageHeader
        icon={<PenTool className="w-5 h-5" />}
        eyebrow="SALES & MARKETING"
        title="회사소개서 스튜디오"
        helpTopic="catalog.studio"
        meta={
          <span className="text-xs cd-text-faint" aria-live="polite">
            {studio.payload ? `${studio.payload.doc.title} · 버전 ${studio.version}` : "불러오는 중…"}
            {saveLabel ? ` · ${saveLabel}` : ""}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <Link href="/sales/catalog" className="cd-btn cd-btn-ghost cd-btn-sm cd-action">
              <ArrowLeft className="w-3.5 h-3.5" /> 회사소개서
            </Link>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={studio.undo} disabled={!studio.canUndo} aria-label="실행 취소(Ctrl+Z)">
              <Undo2 className="w-3.5 h-3.5" /> 실행 취소
            </button>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={studio.redo} disabled={!studio.canRedo} aria-label="다시 실행(Ctrl+Y)">
              <Redo2 className="w-3.5 h-3.5" /> 다시 실행
            </button>
            <button
              type="button"
              className="cd-btn cd-btn-soft cd-btn-sm"
              onClick={() => (setAiInitial(null), setModal("ai"))}
              disabled={!item || !kit || !studio.payload}
            >
              <Sparkles className="w-3.5 h-3.5" /> AI로 수정
            </button>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setModal("versions")}>
              <History className="w-3.5 h-3.5" /> 버전
            </button>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={async () => (await studio.save(), setModal("preview"))}>
              <Eye className="w-3.5 h-3.5" /> 미리보기
            </button>
            <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" onClick={async () => (await studio.save(), setModal("pdf"))}>
              <Download className="w-3.5 h-3.5" /> PDF 받기
            </button>
          </div>
        }
      />

      {studio.saveState === "conflict" || studio.saveState === "error" ? (
        <div className="cd-error-bg cd-error-text rounded-xl px-4 py-2 text-sm mb-2 flex items-center gap-2" role="alert">
          <span>{studio.saveError ?? saveLabel} — 고친 내용은 화면에 남아 있습니다.</span>
          {studio.saveState === "conflict" ? (
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm ml-auto" onClick={() => studio.reload()}>
              <RefreshCw className="w-3.5 h-3.5" /> 새로 불러오기
            </button>
          ) : (
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm ml-auto" onClick={() => void studio.save()}>
              다시 저장
            </button>
          )}
        </div>
      ) : null}
      {studio.view.naming === "real" ? (
        <div className="cd-card px-4 py-2 text-xs cd-text-muted mb-2">실명판 보기입니다. 여기서 고친 글은 마스킹판에도 그대로 나가니 사람 이름을 글로 적지 마세요.</div>
      ) : null}

      {!kit || !studio.payload || !item || !composed || !studio.env ? (
        <div className="cd-card p-6 text-sm cd-text-faint flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> 스튜디오를 여는 중…
        </div>
      ) : (
        <div ref={layoutRef} className="grid gap-2" style={{ gridTemplateColumns: columns, gridTemplateRows: "minmax(0, 1fr)", height: "calc(100vh - 170px)", minHeight: 520 }}>
          <aside className="cd-card p-2 overflow-y-auto" aria-label="쪽 썸네일">
            <StudioThumbs studio={studio} kit={kit} currentKey={item.key} onPick={openPage} warnByKey={warnByKey} compact={compact} />
          </aside>

          <section className="cd-card flex flex-col min-w-0 min-h-0" data-studio-area>
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b cd-border-c text-xs">
              <b className="cd-text text-sm">
                {String(visibleIndex).padStart(2, "0")} {item.label}
              </b>
              <span className="cd-pill cd-pill-idle">편집 L{item.maxLevel}</span>
              {item.flow ? <span className="cd-pill cd-pill-idle">자동 분쪽 — 전체 모양은 미리보기</span> : null}
              <button
                type="button"
                className="cd-btn cd-btn-ghost cd-btn-sm whitespace-nowrap"
                disabled={!caps?.editText}
                title="고치는 글의 커서 자리(또는 고른 글 끝)에 지표 칩을 넣습니다 — Ctrl+K"
                aria-keyshortcuts="Control+K"
                // 글 고치는 중 커서를 잃지 않게 초점을 옮기지 않는다
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const t = canvasHandle.current?.captureBind();
                  if (t) setBindTarget(t);
                }}
              >
                <Hash className="w-3.5 h-3.5" /> 지표 넣기
              </button>
              <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                <label className="flex items-center gap-1 cd-text-muted whitespace-nowrap">
                  판
                  <select
                    className="cd-select"
                    style={{ width: 118 }}
                    value={studio.view.edition}
                    onChange={(e) => void studio.changeView({ ...studio.view, edition: e.target.value as RenderOptions["edition"] })}
                  >
                    {(["print", "draft"] as const).map((v) => (
                      <option key={v} value={v}>
                        {EDITION_LABEL[v]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1 cd-text-muted whitespace-nowrap">
                  이름
                  <select className="cd-select" style={{ width: 96 }} value={studio.view.naming} onChange={(e) => void studio.changeView({ ...studio.view, naming: e.target.value as RenderOptions["naming"] })}>
                    {(["masked", "real"] as const).map((v) => (
                      <option key={v} value={v}>
                        {NAMING_LABEL[v]}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="cd-chip cd-chip-sm whitespace-nowrap"
                  data-active={showGuides ? "true" : undefined}
                  aria-pressed={showGuides}
                  onClick={() => setShowGuides((v) => !v)}
                >
                  <Grid3x3 className="w-3.5 h-3.5" /> 안내선
                </button>
                <select className="cd-select" style={{ width: 84 }} aria-label="확대" value={String(zoomMode)} onChange={(e) => setZoomMode(e.target.value === "fit" ? "fit" : Number(e.target.value))}>
                  <option value="fit">맞춤</option>
                  <option value="0.5">50%</option>
                  <option value="0.75">75%</option>
                  <option value="1">100%</option>
                  <option value="1.25">125%</option>
                </select>
              </span>
            </div>
            <div ref={mainRef} className="flex-1 min-h-0 overflow-auto" style={{ background: "var(--cd-bg)" }} tabIndex={0} aria-label="A4 캔버스 — 요소를 눌러 고릅니다. 방향키 옮기기, Delete 숨기기, Esc 선택 해제">
              <StudioCanvas
                kit={kit}
                fontSet={studio.fontSet}
                tree={composed.tree}
                env={studio.env}
                maxLevel={item.maxLevel}
                flow={item.flow}
                folio={visibleIndex}
                selectedId={selectedId}
                zoom={zoom}
                showGuides={showGuides}
                checks={checks}
                onSelect={setSelectedId}
                onCommitText={ops.commitText}
                onPatchStyle={ops.patchStyle}
                onKeyCommand={onKeyCommand}
                onRequestBind={setBindTarget}
                onChecks={setChecks}
                handleRef={canvasHandle}
              />
            </div>
            <div className="px-3 py-2 border-t cd-border-c text-xs flex flex-wrap items-center gap-1.5" aria-live="polite">
              <span className="cd-text-muted flex items-center gap-1">
                검사 <CdHelp topic="catalog.studio-checks" />
              </span>
              {checks.length === 0 ? (
                <span className="cd-pill cd-pill-success">이 쪽 문제 없음</span>
              ) : (
                checks.slice(0, 8).map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`cd-pill ${c.severity === "error" ? "cd-pill-error" : c.severity === "warn" ? "cd-pill-warn" : "cd-pill-idle"}`}
                    title={c.message}
                    onClick={() => c.nodeId && tree && setSelectedId(resolveSelection(tree, c.nodeId)?.id ?? null)}
                  >
                    {CHECK_LABEL[c.kind]} · {c.text ? `“${c.text.slice(0, 14)}”` : c.message.slice(0, 18)}
                  </button>
                ))
              )}
              {checks.some((c) => c.kind === "overflow" && c.nodeId) ? (
                <button
                  type="button"
                  className="cd-btn cd-btn-soft cd-btn-sm"
                  onClick={() => void aiShrink(checks.filter((c) => c.kind === "overflow" && c.nodeId).map((c) => c.nodeId!))}
                  disabled={shrinking}
                >
                  {shrinking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} AI로 줄이기
                </button>
              ) : null}
              <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm ml-auto" onClick={() => void runCheck()} disabled={checking}>
                {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} 전체 쪽 검사
              </button>
              {fullCheck && !checking ? <span className={fullCheck.total ? "cd-error-text" : "cd-text-muted"}>{fullCheck.error ?? `전체 넘침 ${fullCheck.total}건 · ${fullCheck.pages}쪽`}</span> : null}
            </div>
          </section>

          <aside className="cd-card flex flex-col min-h-0" aria-label="편집 패널">
            <div className="px-2 pt-1">
              <CdTabs<PanelTab>
                items={[
                  { key: "content", label: "내용", panelId: "st-panel" },
                  { key: "design", label: "디자인", panelId: "st-panel" },
                  { key: "fonts", label: "서체", panelId: "st-panel" },
                  { key: "data", label: "데이터", panelId: "st-panel" },
                ]}
                active={tab}
                onChange={setTab}
              />
            </div>
            <div id="st-panel" role="tabpanel" className="flex-1 min-h-0 overflow-y-auto p-3">
              {(() => {
                const props = { studio, kit, item, composed, sel, caps, ops, checks, assets, onAiShrink: (ids: string[]) => void aiShrink(ids), onRemoveCustomArea: (id: string) => void removeCustomArea(id) };
                if (tab === "content") return <PanelContent {...props} />;
                if (tab === "design") return <PanelDesign {...props} />;
                if (tab === "fonts")
                  return (
                    <PanelFonts
                      {...props}
                      onApply={applyFont}
                      previousSet={prevFontSet}
                      onRevert={() => prevFontSet && (studio.setTheme({ fontSet: prevFontSet }), setPrevFontSet(null))}
                      fullCheck={fullCheck}
                      checking={checking}
                      onRunCheck={() => void runCheck()}
                      onOpenPage={openPage}
                    />
                  );
                return <PanelData {...props} />;
              })()}
            </div>
          </aside>
        </div>
      )}

      <AssetPicker
        open={picker != null}
        assets={assets}
        onClose={() => setPicker(null)}
        onPick={(key) => {
          picker?.(key);
          setPicker(null);
        }}
        onUploaded={(a) => setAssets((list) => [a, ...list.filter((x) => x.key !== a.key)])}
      />
      <BindPicker open={bindTarget != null} data={studio.data} onClose={closeBind} onPick={insertBind} />
      {kit && item ? (
        <AiEditModal
          open={modal === "ai"}
          onClose={() => (setModal(null), setAiInitial(null))}
          studio={studio}
          kit={kit}
          item={item}
          sel={sel}
          docId={docId}
          initial={aiInitial}
          onOpenPage={openPage}
        />
      ) : null}
      <VersionsModal open={modal === "versions"} onClose={() => setModal(null)} docId={docId} studio={studio} toast={toast} />
      <CdModal open={modal === "preview"} onClose={() => setModal(null)} title="미리보기 — PDF 와 같은 조판" size="xl" maxHeightClass="max-h-[92vh]">
        {modal === "preview" ? (
          <div className="p-3 flex flex-col gap-2">
            <iframe
              title="회사소개서 미리보기"
              src={`/api/catalog/render/html?doc=${encodeURIComponent(docId)}&edition=${studio.view.edition}&naming=${studio.view.naming}`}
              style={{ width: "100%", height: "74vh", border: 0, background: "#8b9096" }}
            />
            <a className="text-xs cd-text-primary self-end" href={`/api/catalog/render/html?doc=${encodeURIComponent(docId)}&edition=${studio.view.edition}&naming=${studio.view.naming}`} target="_blank" rel="noreferrer">
              새 창으로 열기
            </a>
          </div>
        ) : null}
      </CdModal>
      <PdfModal open={modal === "pdf"} onClose={() => setModal(null)} view={studio.view} />
    </div>
  );
}

function VersionsModal({
  open,
  onClose,
  docId,
  studio,
  toast,
}: {
  open: boolean;
  onClose: () => void;
  docId: string;
  studio: ReturnType<typeof useStudio>;
  toast: ReturnType<typeof useCdToast>["toast"];
}) {
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      setRows((await catalogFetch<{ versions: VersionRow[] }>(`/api/catalog/studio/versions?doc=${encodeURIComponent(docId)}`)).versions);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [docId]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  const snapshot = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!(await studio.save())) throw new Error("먼저 저장하지 못해 버전을 남기지 않았습니다.");
      const res = await catalogFetch<{ version: number; rev: string }>(`/api/catalog/studio/versions?doc=${encodeURIComponent(docId)}`, { method: "POST", body: JSON.stringify({ note }) });
      studio.adoptRev(res.rev, res.version);
      setNote("");
      toast(`버전 ${res.version}을 저장했습니다.`, "success");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const restore = async (v: number) => {
    setBusy(true);
    setError(null);
    try {
      const snap = await catalogFetch<{ theme: NonNullable<typeof studio.state>["theme"]; pages: NonNullable<typeof studio.state>["pages"] }>(`/api/catalog/studio/versions/${v}?doc=${encodeURIComponent(docId)}`);
      studio.replaceState({ theme: snap.theme, pages: snap.pages });
      toast(`버전 ${v}으로 되돌렸습니다. 실행 취소로 되돌릴 수 있습니다.`, "success");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <CdModal open={open} onClose={onClose} title="버전" size="lg">
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-end gap-2">
          <label className="flex-1 text-xs cd-text-muted flex flex-col gap-1">
            메모(선택)
            <input className="cd-input" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="예: 대표이사 검토 반영" />
          </label>
          <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" onClick={snapshot} disabled={busy}>
            버전 저장
          </button>
        </div>
        {error ? <p className="cd-error-text text-sm">{error}</p> : null}
        {rows == null ? (
          <p className="text-sm cd-text-faint">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm cd-text-faint">저장한 버전이 없습니다. 고친 내용은 자동 저장되고, 버전은 되돌아갈 지점을 남길 때 저장합니다.</p>
        ) : (
          <table className="cd-table">
            <thead>
              <tr>
                <th>판</th>
                <th>저장 시각</th>
                <th>저장한 사람</th>
                <th>메모</th>
                <th className="text-right">고친 쪽</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.version}>
                  <td className="tabular-nums">{r.version}</td>
                  <td className="tabular-nums whitespace-nowrap">{fmtTime(r.savedAt)}</td>
                  <td>{r.savedByName || "—"}</td>
                  <td className="cd-text-muted">{r.note || "—"}</td>
                  <td className="text-right tabular-nums">{r.pages}</td>
                  <td className="text-right">
                    <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => restore(r.version)} disabled={busy}>
                      이 버전으로 되돌리기
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </CdModal>
  );
}

interface EditionSummary {
  editionId: string;
  pages: number;
  warnings: Array<{ kind: string; message: string; page: number }>;
  notices: string[];
  sizeBytes: number;
  totalMs: number;
  fileName: string;
}

function PdfModal({ open, onClose, view }: { open: boolean; onClose: () => void; view: RenderOptions }) {
  const [opts, setOpts] = useState<RenderOptions>(view);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EditionSummary | null>(null);
  useEffect(() => {
    if (open) {
      setOpts(view);
      setResult(null);
      setError(null);
    }
  }, [open, view]);
  const make = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult((await catalogFetch<{ edition: EditionSummary }>("/api/catalog/render/pdf", { method: "POST", body: JSON.stringify(opts) })).edition);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const overflow = result?.warnings.filter((w) => w.kind === "overflow").length ?? 0;
  return (
    <CdModal open={open} onClose={onClose} title="편집본 PDF 받기" size="md">
      <div className="p-4 flex flex-col gap-3 text-sm">
        <p className="text-xs cd-text-muted">지금 저장된 편집본(쪽 순서·숨김·편집)을 지금 데이터로 PDF(A4 가로)로 만듭니다. 30초 안팎 걸립니다.</p>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-1">
            판
            <select className="cd-select" style={{ width: 130 }} value={opts.edition} onChange={(e) => setOpts({ ...opts, edition: e.target.value as RenderOptions["edition"] })}>
              <option value="print">{EDITION_LABEL.print}</option>
              <option value="draft">{EDITION_LABEL.draft}</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            이름
            <select className="cd-select" style={{ width: 110 }} value={opts.naming} onChange={(e) => setOpts({ ...opts, naming: e.target.value as RenderOptions["naming"] })}>
              <option value="masked">{NAMING_LABEL.masked}</option>
              <option value="real">{NAMING_LABEL.real}</option>
            </select>
          </label>
        </div>
        <button type="button" className="cd-btn cd-btn-primary self-start" onClick={make} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} {busy ? "만드는 중…" : "PDF 만들기"}
        </button>
        {error ? <p className="cd-error-text">{error}</p> : null}
        {result ? (
          <div className="rounded-lg border cd-border-c p-3 flex flex-col gap-1.5">
            <span className="cd-text">
              {result.pages}쪽 · {(result.sizeBytes / 1024 / 1024).toFixed(1)}MB · {(result.totalMs / 1000).toFixed(1)}초 ·{" "}
              <b className={overflow ? "cd-error-text" : ""}>넘침 {overflow}건</b>
            </span>
            {result.warnings.slice(0, 6).map((w, i) => (
              <span key={i} className="text-xs cd-text-muted">
                {w.page}쪽 · {w.message}
              </span>
            ))}
            {result.notices.slice(0, 4).map((t, i) => (
              <span key={`n${i}`} className="text-xs cd-text-faint">
                {t}
              </span>
            ))}
            <a className="cd-btn cd-btn-soft cd-btn-sm cd-action self-start" href={`/api/catalog/editions/${result.editionId}/pdf`}>
              <Download className="w-3.5 h-3.5" /> {result.fileName} 받기
            </a>
          </div>
        ) : null}
      </div>
    </CdModal>
  );
}
