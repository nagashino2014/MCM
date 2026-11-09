"use client";

// 스튜디오 A4 캔버스 — 쪽 하나를 iframe 안에 그대로(PDF 와 같은 CSS) 그리고 그 위에서 고른다·고친다·옮긴다.
//   글 블록: 한 번 누르면 요소를 고르고(옮기기·복사·삭제), 고른 글을 다시 누르면(두 번 누르기) 글을 고친다(contentEditable).
//     지표 값·아이콘·쪽 번호 링크는 칩(고칠 수 없음, 지울 수는 있음)
//     Ctrl+K = 지표 넣기(커서 자리), 글을 고치지 않은 채 Ctrl+Z/Y = 스튜디오 실행 취소/다시(칩 넣기 되돌리기)
//   선택 상자: 끌기 손잡이(왼쪽 위)로 옮기고, 변·모서리 손잡이로 크기(L3 쪽만)
//     옮기기는 기본 1pt 자유 배치. [안내선]을 켜면 12열 그리드·4pt 기준선에 맞춘다(사용자 지시 2026-11-08: 맞춤이 기본이면 열 선으로 튕겨 자리를 못 잡음). 크기는 늘 맞춤
//     이미지·일러스트는 모서리를 끌면 비율 유지(Shift = 비율 풀기), 그 밖의 요소는 Shift 로 비율 유지. 사진은 틀과 한 요소로 움직인다(select.ts PHOTO_FRAME_RE)
//   여러 개 고르기: Shift·Ctrl+클릭으로 더하고 뺀다 → 묶음 손잡이로 함께 옮기고(상대 위치 유지, 묶음 왼쪽 위를 그리드에 맞춤) Delete·Ctrl+D 도 함께
//   Alt 를 누른 채 끌거나 Alt+방향키 = 안내선이 켜 있어도 1pt 자유 배치
//   키보드: 방향키 = 옮기기(4pt, Shift 16pt, Alt 1pt · 안내선 켜짐이면 가로 1열·세로 4pt), Delete = 숨기기, Ctrl+C·X·V = 복사·잘라내기·붙여넣기, Ctrl+D = 복제, Esc = 선택 해제, Ctrl+Z/Y = 실행 취소/다시
//   안내선: 12열·여백. 검사 표식: 넘침(빨강)·대비·해상도·겹침(주황)
//   겹침: 옮기는 중(끌기·묶음 끌기) 겹치는 다른 글 상자에 옅은 주황 테두리 — 막지는 않는다. 놓은 뒤에는 쪽 검사의 '겹침' 경고로 남는다

import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as RClipboardEvent,
  type CSSProperties,
  type FocusEvent as RFocusEvent,
  type KeyboardEvent as RKeyboardEvent,
  type MouseEvent as RMouseEvent,
  type MutableRefObject,
  type PointerEvent as RPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { COL_STEP, COL_W, COLOR_TOKENS, COLUMNS, CONTENT_W, MARGIN_BOTTOM, MARGIN_TOP, MARGIN_X, PAGE_H, PAGE_W, TEXT_COLORS, resizeBox, snapX, snapY, type Box, type ResizeHandle } from "@/lib/catalog/studio/design-system";
import { CARET_ID, appendCaret, caretNode, collectChips, fromEditableDom, toEditableHtml } from "@/lib/catalog/studio/inline";
import { stripDerived, type DuplicateAt } from "@/lib/catalog/studio/edits";
import { findNode, findPath, isChip, textOf, type CNode } from "@/lib/catalog/studio/nodes";
import { boundsOf, findOverlaps, movedNodes, textBoxNodes, type OverlapBox, type OverlapNode } from "@/lib/catalog/studio/overlap";
import { nodeProps, renderNode, resolvedChildren, type TreeEnv } from "@/lib/catalog/studio/render-tree";
import { capabilities, describe, isTextBlock, outermost, photoFrameImage, resolveSelection, type EditLevel } from "@/lib/catalog/studio/select";
import type { DomLike } from "@/lib/doc-tree/inline-core";
import { checkOverlaps, checkSheet, measureRects, type CheckItem } from "./checks";
import { PortalFrame } from "./Frames";
import type { StudioKit } from "./kit";
import { selectionLabel } from "./types";

export interface CanvasHandle {
  /** 방향키 옮기기 — dx·dy(pt)만큼. 안내선이 켜 있으면 가로는 한 열·세로는 4pt 에 맞춘다. free(Alt) = 안내선과 무관하게 그대로 */
  nudge: (dx: number, dy: number, free?: boolean) => void;
  /** 지표 넣기 자리 — 고치는 중인 글이면 커서 자리, 아니면 고른 글 끝. 글 블록이 아니면 null */
  captureBind: () => BindTarget | null;
  /** 넣은 칩 뒤로 커서를 옮겨 이어서 고치게 한다 */
  focusChip: (blockId: string, chipId: string) => void;
  /** 요소가 쪽에 그려진 상자(쪽 기준 px)·글자 크기·행간 비율 */
  geometry: (id: string) => (Rect & { fontPx: number; lineRatio: number }) | null;
  /** 복제·복사 자리와 원본의 지금 모양 */
  copyInfo: (id: string) => DuplicateAt | null;
}

/** 지표 넣기 대상 — 글 블록 id 와 표식(caret)이 든 자식 */
export interface BindTarget {
  blockId: string;
  children: CNode[];
  /** 커서 자리에서 열었는지(아니면 글 끝) */
  atCaret: boolean;
}

type Rect = Box;

/** 요소의 지금 위치 방식·left·top(computed) */
interface ElPos {
  position: string;
  left: number;
  top: number;
}

/** 옮기는 중 겹침 판정 — 잡을 때 잰 옮길 요소·글 상자 */
interface DragOverlap {
  subjects: OverlapBox[];
  targets: OverlapBox[];
}

interface GroupItem {
  id: string;
  el: HTMLElement;
  rect: Rect;
  cs: ElPos;
  transform: string;
}

/** 상자들을 감싸는 상자 */
const unionRect = (list: Rect[]): Rect | null => {
  if (!list.length) return null;
  const x = Math.min(...list.map((r) => r.x));
  const y = Math.min(...list.map((r) => r.y));
  return { x, y, w: Math.max(...list.map((r) => r.x + r.w)) - x, h: Math.max(...list.map((r) => r.y + r.h)) - y };
};

const pad2 = (n: number) => String(n).padStart(2, "0");
const px = (v: number) => `${Math.round(v * 100) / 100}px`;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const noIds = (list: CNode[]) => JSON.parse(JSON.stringify(list.map(stripDerived), (k, v) => (k === "id" ? undefined : v)));

/** 캔버스 iframe 안에서만 쓰는 편집 표시 CSS(문서 CSS 는 건드리지 않는다) */
const CANVAS_CSS = `
.st-stage { position: relative; }
.st-scale { position: relative; transform-origin: 0 0; }
.st-scale > .pk-sheet { box-shadow: 0 1px 6px rgba(0,0,0,.22); }
[data-st-edit] { outline: none; cursor: default; }
[data-st-edit]:focus { cursor: text; }
[data-st-edit]:focus { box-shadow: 0 0 0 1px rgba(74,99,216,.85); }
[contenteditable="false"][data-chip] { cursor: default; background: rgba(74,99,216,.10); border-radius: 2px; }
.st-overlay { position: absolute; inset: 0; pointer-events: none; }
.st-box { position: absolute; box-sizing: border-box; }
.st-box--hover, .st-box--group { outline: 1px dashed rgba(74,99,216,.55); }
.st-box--sel { outline: 1.5px solid #4a63d8; }
.st-box--group { outline-offset: 3px; }
.st-box--warn { outline: 1.5px dashed #d64545; }
.st-box--note { outline: 1.5px dashed #c47f00; }
.st-box--overlap { outline: 1.5px dashed rgba(196,127,0,.6); background: rgba(196,127,0,.08); }
.st-handle { position: absolute; width: 9px; height: 9px; background: #fff; border: 1.5px solid #4a63d8; border-radius: 2px; pointer-events: auto; box-sizing: border-box; }
.st-handle--e { right: -5px; top: calc(50% - 4.5px); cursor: ew-resize; }
.st-handle--w { left: -5px; top: calc(50% - 4.5px); cursor: ew-resize; }
.st-handle--s { bottom: -5px; left: calc(50% - 4.5px); cursor: ns-resize; }
.st-handle--n { top: -5px; left: calc(50% - 4.5px); cursor: ns-resize; }
.st-handle--se { right: -5px; bottom: -5px; cursor: nwse-resize; }
.st-handle--nw { left: -5px; top: -5px; cursor: nwse-resize; }
.st-handle--ne { right: -5px; top: -5px; cursor: nesw-resize; }
.st-handle--sw { left: -5px; bottom: -5px; cursor: nesw-resize; }
.st-grip { position: absolute; left: 8px; top: -19px; height: 14px; padding: 0 5px; font: 600 9px/14px sans-serif; color: #fff; background: #4a63d8; border-radius: 3px 3px 0 0; pointer-events: auto; cursor: move; white-space: nowrap; user-select: none; }
.st-col { position: absolute; top: ${MARGIN_TOP}px; bottom: ${MARGIN_BOTTOM}px; background: rgba(74,99,216,.06); border-left: 0.5px solid rgba(74,99,216,.25); border-right: 0.5px solid rgba(74,99,216,.25); }
.st-margin { position: absolute; inset: ${MARGIN_TOP}px ${MARGIN_X}px ${MARGIN_BOTTOM}px ${MARGIN_X}px; outline: 0.5px dashed rgba(214,69,69,.45); }
`;

export function StudioCanvas({
  kit,
  fontSet,
  tree,
  env,
  maxLevel,
  flow,
  folio,
  selectedIds,
  zoom,
  showGuides,
  checks,
  pageLabel,
  onSelect,
  onToggleSelect,
  onCommitText,
  onCommitSlot,
  onPatchStyle,
  onPatchStyles,
  onKeyCommand,
  onRequestBind,
  onChecks,
  handleRef,
}: {
  kit: StudioKit;
  fontSet: string;
  tree: CNode;
  env: TreeEnv;
  maxLevel: EditLevel;
  flow: boolean;
  folio: number;
  /** 고른 요소(마지막 = 주 선택, 패널이 고치는 대상) */
  selectedIds: string[];
  zoom: number;
  showGuides: boolean;
  checks: CheckItem[];
  /** 쪽 이름 — 겹침 경고 문구 */
  pageLabel?: string;
  onSelect: (id: string | null) => void;
  /** Shift·Ctrl+클릭 — 고른 묶음에 더하거나 뺀다 */
  onToggleSelect: (id: string) => void;
  onCommitText: (id: string, children: CNode[]) => void;
  /** 일러스트 글자 자리(313) 고치기 — 평문 → 그 인포그래픽 내용 */
  onCommitSlot?: (slotNodeId: string, text: string) => void;
  onPatchStyle: (id: string, patch: Record<string, string>) => void;
  /** 여러 요소를 한 번에(실행 취소 한 단계) — 묶음 옮기기 */
  onPatchStyles: (list: Array<{ id: string; patch: Record<string, string> }>) => void;
  /** 캔버스에서 누른 단축키(실행 취소 등) — 처리하면 true */
  onKeyCommand: (key: string, e: KeyboardEvent) => boolean;
  /** 글 고치는 중 Ctrl+K — 지표 넣기 창을 연다 */
  onRequestBind?: (target: BindTarget) => void;
  onChecks: (items: CheckItem[]) => void;
  handleRef?: MutableRefObject<CanvasHandle | null>;
}) {
  const [frame, setFrame] = useState<{ doc: Document; win: Window } | null>(null);
  const [rects, setRects] = useState<{ sel: Rect | null; others: Rect[]; group: Rect | null; hover: Rect | null; warn: Array<{ r: Rect; kind: string }>; overlap: Rect[] }>({ sel: null, others: [], group: null, hover: null, warn: [], overlap: [] });
  const selectedId = selectedIds[selectedIds.length - 1] ?? null;
  const multi = selectedIds.length > 1;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const scaleRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<null | { mode: "move" | ResizeHandle; ratio: boolean; id: string; startX: number; startY: number; rect: Rect; el: HTMLElement; cs: { position: string; left: number; top: number }; orig: { transform: string; width: string; height: string }; ov: DragOverlap | null }>(null);
  const groupDragRef = useRef<null | { startX: number; startY: number; rect: Rect; items: GroupItem[]; ov: DragOverlap | null }>(null);

  // 위치·크기를 적용할 노드 — 사진은 그 틀
  const layoutId = useCallback((id: string) => resolveSelection(tree, id)?.frame?.id ?? id, [tree]);

  // 틀을 옮기거나 키울 때 사진에 따로 남은 위치·크기는 지운다(예전에 사진만 끌어 둔 값 — 사진이 틀을 채우도록)
  const withPhotoReset = useCallback(
    (list: Array<{ id: string; patch: Record<string, string> }>) =>
      list.flatMap((it) => {
        const frame = findNode(tree, it.id);
        const img = frame ? photoFrameImage(frame) : null;
        const stale = Object.keys(img?.style ?? {}).filter((k) => ["position", "left", "top", "right", "bottom", "width", "height", "flex"].includes(k));
        return img && stale.length ? [it, { id: img.id, patch: Object.fromEntries(stale.map((k) => [k, ""])) }] : [it];
      }),
    [tree]
  );

  // 글 블록(고칠 수 있는 노드) — 위젯 안은 빼고
  const textBlocks = useMemo(() => {
    const set = new Set<string>();
    const walk = (n: CNode, parent: CNode | null, inWidget: boolean) => {
      const w = inWidget || Boolean(n.widget);
      if (!w && isTextBlock(n, parent)) {
        set.add(n.id);
        return;
      }
      n.children?.forEach((c) => walk(c, n, w));
    };
    walk(tree, null, false);
    return set;
  }, [tree]);

  // 겹침 검사 대상 — 옮긴 요소와 글 상자(글 블록·데이터 영역·추가한 글상자)
  const overlapNodes = useMemo(() => ({ moved: movedNodes(tree), boxes: textBoxNodes(tree) }), [tree]);
  const overlapLabel = useCallback((o: OverlapNode) => selectionLabel(describe(o.path)), []);

  const chipHtml = useCallback(
    (chip: CNode) =>
      renderToStaticMarkup(
        renderNode(chip, env, {
          decorate: (c, p) => (c.id === chip.id ? { ...p, contentEditable: "false", suppressContentEditableWarning: true, "data-chip": chip.id } : p),
        }) as ReactElement
      ),
    [env]
  );

  // 글을 친 뒤 아직 반영(blur)하지 않은 블록 — 이때 Ctrl+Z 는 브라우저 기본(글 안 되돌리기)
  const dirtyRef = useRef(new Set<string>());

  // 고칠 수 있는 칸의 innerHTML 값 — 글이 같으면 같은 객체를 돌려준다. React 19 는 dangerouslySetInnerHTML 을 객체 동일성으로 비교해,
  // 매번 새 객체면 다시 그릴 때마다(요소 고르기·저장 등) innerHTML 을 덮어써 아직 반영(blur) 전인 친 글이 사라졌다(2026-11-09)
  const htmlCache = useRef(new Map<string, { __html: string }>());
  const stableHtml = useCallback((id: string, html: string) => {
    const hit = htmlCache.current.get(id);
    if (hit && hit.__html === html) return hit;
    const next = { __html: html };
    htmlCache.current.set(id, next);
    return next;
  }, []);

  const commitBlock = useCallback(
    (n: CNode, el: HTMLElement) => {
      dirtyRef.current.delete(n.id);
      const next = fromEditableDom(el as unknown as DomLike, collectChips(n.children ?? []));
      if (!sameJson(noIds(next), noIds(n.children ?? []))) onCommitText(n.id, next);
    },
    [onCommitText]
  );

  // 커서 자리에 표식을 잠깐 넣고 역파싱 → 표식 노드가 든 자식(지표를 고르면 표식을 칩으로 바꾼다)
  const captureAt = useCallback((n: CNode, el: HTMLElement | null): BindTarget => {
    const doc = el?.ownerDocument;
    const s = doc?.getSelection();
    const range = el && doc && doc.activeElement === el && s && s.rangeCount && el.contains(s.getRangeAt(0).endContainer) ? s.getRangeAt(0).cloneRange() : null;
    if (!el || !doc || !range) return { blockId: n.id, children: appendCaret(n.children ?? []), atCaret: false };
    range.collapse(false);
    const mark = doc.createElement("span");
    mark.setAttribute("data-chip", CARET_ID);
    range.insertNode(mark);
    const chips = collectChips(n.children ?? []);
    chips.set(CARET_ID, caretNode());
    const children = fromEditableDom(el as unknown as DomLike, chips);
    mark.remove();
    el.normalize();
    return { blockId: n.id, children, atCaret: true };
  }, []);

  const content = useMemo(() => {
    const hooks = {
      decorate: (n: CNode, p: Record<string, unknown>) => {
        const out: Record<string, unknown> = { ...p, "data-cn": n.id };
        if (n.tag === "a") out.onClick = (e: RMouseEvent) => e.preventDefault();
        return out;
      },
      override: (n: CNode): ReactNode | undefined => {
        // 일러스트 글자 자리 — 바로 눌러 고친다(평문, 지표에 묶은 숫자는 칩이라 고치지 않음)
        if (onCommitSlot && maxLevel >= 2 && n.attrs && "data-ill-slot" in n.attrs && !(function hasBind(x: CNode): boolean { return Boolean(x.bind) || (x.children ?? []).some(hasBind); })(n)) {
          const role = String(n.attrs["data-ill-role"] ?? "");
          const multi = role === "desc" || role === "center";
          const text = textOf(n);
          return createElement(n.tag, {
            ...nodeProps(n, env),
            "data-cn": n.id,
            "data-st-edit": "1",
            contentEditable: true,
            suppressContentEditableWarning: true,
            spellCheck: false,
            dangerouslySetInnerHTML: stableHtml(n.id, text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")),
            onKeyDown: (e: RKeyboardEvent<HTMLElement>) => {
              if (e.key === "Enter" && multi) {
                e.preventDefault();
                e.currentTarget.ownerDocument.execCommand("insertLineBreak");
              } else if (e.key === "Enter" || e.key === "Escape") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            },
            onPaste: (e: RClipboardEvent<HTMLElement>) => {
              e.preventDefault();
              e.currentTarget.ownerDocument.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
            },
            onFocus: () => onSelect(n.id),
            onBlur: (e: RFocusEvent<HTMLElement>) => {
              const next = e.currentTarget.innerText;
              if (next.trim() !== text.trim()) onCommitSlot(n.id, next);
            },
          });
        }
        if (n.attrs && "data-folio" in n.attrs && !textBlocks.has(n.id)) {
          return createElement(n.tag, { ...nodeProps(n, env), "data-cn": n.id }, pad2(folio));
        }
        if (!textBlocks.has(n.id)) return undefined;
        const kids = resolvedChildren(n, env);
        return createElement(n.tag, {
          ...nodeProps(n, env),
          "data-cn": n.id,
          "data-st-edit": "1",
          contentEditable: true,
          suppressContentEditableWarning: true,
          spellCheck: false,
          dangerouslySetInnerHTML: stableHtml(n.id, toEditableHtml(kids, (c) => (isChip(c) ? chipHtml(c) : ""))),
          onKeyDown: (e: RKeyboardEvent<HTMLElement>) => {
            const d = e.currentTarget.ownerDocument;
            const mod = e.ctrlKey || e.metaKey;
            if (mod && !e.altKey && e.code === "KeyK" && onRequestBind) {
              e.preventDefault();
              onRequestBind(captureAt(n, e.currentTarget));
            } else if (mod && !e.altKey && (e.code === "KeyZ" || e.code === "KeyY") && !dirtyRef.current.has(n.id)) {
              // 친 글이 없으면 스튜디오 실행 취소(칩 넣기·글 반영 되돌리기)
              e.preventDefault();
              onKeyCommand(e.code === "KeyZ" ? "z" : "y", e.nativeEvent);
            } else if (mod && !e.altKey && e.code === "KeyD" && !dirtyRef.current.has(n.id)) {
              // 커서가 글 안이어도 Ctrl+D = 스튜디오 복제(브라우저 책갈피 대신). 친 글이 있으면 먼저 Esc·바깥 누르기로 반영한 뒤
              e.preventDefault();
              onKeyCommand("d", e.nativeEvent);
            } else if (e.key === "Enter") {
              e.preventDefault();
              d.execCommand("insertLineBreak");
            } else if (e.key === "Escape") {
              e.currentTarget.blur();
            }
          },
          onPaste: (e: RClipboardEvent<HTMLElement>) => {
            e.preventDefault();
            e.currentTarget.ownerDocument.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
          },
          onInput: () => dirtyRef.current.add(n.id),
          onFocus: () => onSelect(n.id),
          onBlur: (e: RFocusEvent<HTMLElement>) => commitBlock(n, e.currentTarget),
        });
      },
    };
    return renderNode(tree, env, hooks);
  }, [tree, env, textBlocks, chipHtml, commitBlock, folio, onSelect, captureAt, onRequestBind, onKeyCommand, onCommitSlot, maxLevel, stableHtml]);

  const sheetEl = useCallback(() => (scaleRef.current?.querySelector(".pk-sheet") as HTMLElement | null) ?? null, []);
  const elOf = useCallback((id: string | null) => (id && frame ? (frame.doc.querySelector(`[data-cn="${CSS.escape(id)}"]`) as HTMLElement | null) : null), [frame]);

  const rectOf = useCallback(
    (el: HTMLElement | null): Rect | null => {
      const s = sheetEl();
      if (!el || !s) return null;
      const a = el.getBoundingClientRect();
      const b = s.getBoundingClientRect();
      const k = b.width / PAGE_W || 1;
      return { x: (a.left - b.left) / k, y: (a.top - b.top) / k, w: a.width / k, h: a.height / k };
    },
    [sheetEl]
  );

  const measure = useCallback(() => {
    const warn: Array<{ r: Rect; kind: string }> = [];
    for (const c of checks) {
      if (!c.nodeId || c.severity === "info") continue;
      const r = rectOf(elOf(c.nodeId));
      if (r) warn.push({ r, kind: c.kind });
      for (const rid of c.relatedIds ?? []) {
        const rr = rectOf(elOf(rid));
        if (rr) warn.push({ r: rr, kind: "related" });
      }
    }
    const others = multi ? selectedIds.map((id) => rectOf(elOf(layoutId(id)))).filter((r): r is Rect => r != null) : [];
    setRects((prev) => ({
      overlap: prev.overlap,
      sel: multi || !selectedId ? null : rectOf(elOf(layoutId(selectedId))),
      others,
      group: unionRect(others),
      hover: hoverId && !selectedIds.includes(hoverId) ? rectOf(elOf(layoutId(hoverId))) : null,
      warn,
    }));
  }, [checks, elOf, rectOf, selectedId, selectedIds, multi, hoverId, layoutId]);

  useLayoutEffect(() => {
    measure();
  }, [measure, content, zoom]);

  // 글 입력·서체 로드·이미지 로드 뒤 다시 잰다
  useEffect(() => {
    if (!frame) return;
    const re = () => measure();
    frame.doc.addEventListener("input", re);
    frame.doc.fonts?.ready.then(re);
    const imgs = Array.from(frame.doc.images);
    imgs.forEach((i) => i.addEventListener("load", re));
    return () => {
      frame.doc.removeEventListener("input", re);
      imgs.forEach((i) => i.removeEventListener("load", re));
    };
  }, [frame, measure, content]);

  // 품질 검사 — 그린 뒤 잠깐 기다렸다가(서체·이미지) 쪽 하나를 검사
  useEffect(() => {
    if (!frame) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      await frame.doc.fonts?.ready;
      const s = sheetEl();
      const sc = scaleRef.current;
      if (cancelled || !s || !sc) return;
      // 확대·축소(transform)를 잠깐 풀고 잰다 — PDF 와 같은 1pt = 1px 기준(쪽 여백 판정이 배율에 흔들리지 않게)
      const prevTransform = sc.style.transform;
      sc.style.transform = "none";
      let items: CheckItem[];
      try {
        items = checkSheet(frame.win, s);
        if (!flow) items.push(...checkOverlaps(frame.win, s, overlapNodes.moved, overlapNodes.boxes, overlapLabel, pageLabel));
      } finally {
        sc.style.transform = prevTransform;
      }
      // 흐름 쪽은 캔버스에서 쪽을 나누지 않으므로 칸 넘침은 정상 — 미리보기·전체 검사에서 본다
      if (flow) items = items.filter((i) => i.kind !== "overflow");
      onChecks(items);
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [frame, content, flow, sheetEl, onChecks, fontSet, overlapNodes, overlapLabel, pageLabel]);

  const selCaps = useMemo(() => {
    if (!selectedId) return null;
    const sel = resolveSelection(tree, selectedId);
    return sel ? capabilities(sel, maxLevel) : null;
  }, [tree, selectedId, maxLevel]);

  // 함께 옮길 요소 — 다른 고른 요소 안에 든 것·옮길 수 없는 것은 뺀다
  const groupIds = useMemo(() => {
    if (!multi) return [];
    return outermost(tree, selectedIds).filter((id) => {
      const sel = resolveSelection(tree, id);
      return sel ? capabilities(sel, maxLevel).move : false;
    });
  }, [tree, selectedIds, multi, maxLevel]);

  // ── 옮기기·크기(그리드 맞춤) ──
  // 그리드 맞춤은 안내선을 켰을 때만(Alt 는 늘 자유)
  const snapOn = useCallback((alt: boolean) => showGuides && !alt, [showGuides]);

  const commitMove = useCallback(
    (id: string, el: HTMLElement, rect: Rect, cs: ElPos, dx: number, dy: number, alt = false) => {
      const patch = movePatch(rect, cs, ...snapDelta(rect, dx, dy, !snapOn(alt)));
      if (patch) onPatchStyles(withPhotoReset([{ id, patch }]));
      void el;
    },
    [onPatchStyles, withPhotoReset, snapOn]
  );

  // 묶음 옮기기 — 묶음 왼쪽 위만 그리드에 맞추고 같은 거리만큼 모두 옮긴다(서로의 자리 유지)
  const groupItems = useCallback((): GroupItem[] => {
    if (!frame) return [];
    return groupIds.flatMap((sid) => {
      const id = layoutId(sid);
      const el = elOf(id);
      const rect = rectOf(el);
      return el && rect ? [{ id, el, rect, cs: readCs(el, frame.win), transform: el.style.transform }] : [];
    });
  }, [frame, groupIds, elOf, rectOf, layoutId]);

  const commitGroup = useCallback(
    (items: GroupItem[], ddx: number, ddy: number) => {
      const list = items.flatMap((it) => {
        const patch = movePatch(it.rect, it.cs, ddx, ddy);
        return patch ? [{ id: it.id, patch }] : [];
      });
      if (list.length) onPatchStyles(withPhotoReset(list));
    },
    [onPatchStyles, withPhotoReset]
  );

  // 옮기는 중 겹침 — 잡는 순간 옮길 요소와 다른 글 상자를 한 번 재 두고, 끄는 동안은 옮긴 거리만큼 밀어 판정한다
  const dragOverlap = useCallback(
    (ids: string[]): DragOverlap | null => {
      const s = sheetEl();
      if (!frame || !s || !ids.length) return null;
      const lineIds = new Set(overlapNodes.boxes.filter((o) => o.measure === "lines").map((o) => o.node.id));
      const subjects = ids.flatMap((id) => {
        const path = findPath(tree, id);
        const rects = measureRects(frame.win, s, elOf(id), lineIds.has(id) ? "lines" : "box");
        return path && rects ? [{ id, path: path.map((p) => p.id), rects }] : [];
      });
      const targets = overlapNodes.boxes.flatMap((o) => {
        const rects = measureRects(frame.win, s, elOf(o.node.id), o.measure);
        return rects ? [{ id: o.node.id, path: o.path.map((p) => p.id), rects }] : [];
      });
      return subjects.length ? { subjects, targets } : null;
    },
    [frame, sheetEl, overlapNodes, tree, elOf]
  );

  const overlapAt = (ov: DragOverlap | null, ddx: number, ddy: number): Rect[] => {
    if (!ov) return [];
    const moved = ov.subjects.map((b) => ({ ...b, rects: b.rects.map((r) => ({ ...r, x: r.x + ddx, y: r.y + ddy })) }));
    const hit = new Set(findOverlaps(moved, ov.targets).map((h) => h.otherId));
    return ov.targets.filter((t) => hit.has(t.id)).flatMap((t) => {
      const b = boundsOf(t.rects);
      return b ? [b] : [];
    });
  };

  const onHandleDown = (mode: "move" | ResizeHandle) => (e: RPointerEvent<HTMLElement>) => {
    if (!frame || !selectedId) return;
    const id = layoutId(selectedId);
    const el = elOf(id);
    const rect = rectOf(el);
    if (!el || !rect) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    // 이미지·일러스트는 모서리를 끌면 비율을 유지한다(Shift 로 풀기). 그 밖의 요소는 반대로 Shift 를 누를 때만
    const s = resolveSelection(tree, selectedId);
    const ratio = s?.kind === "image" || /\bkc-x-(image|illust)\b/.test(s?.node.className ?? "");
    dragRef.current = { mode, ratio, id, startX: e.clientX, startY: e.clientY, rect, el, cs: readCs(el, frame.win), orig: { transform: el.style.transform, width: el.style.width, height: el.style.height }, ov: mode === "move" ? dragOverlap([id]) : null };
  };

  const onHandleMove = (e: RPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / zoom;
    const dy = (e.clientY - d.startY) / zoom;
    if (d.mode === "move") {
      const [ddx, ddy] = snapDelta(d.rect, dx, dy, !snapOn(e.altKey));
      d.el.style.transform = `${d.orig.transform} translate(${ddx}px, ${ddy}px)`;
      const overlap = overlapAt(d.ov, ddx, ddy);
      setRects((r) => ({ ...r, sel: { ...d.rect, x: d.rect.x + ddx, y: d.rect.y + ddy }, overlap }));
    } else {
      const b = resizeBox(d.rect, d.mode, dx, dy, d.ratio !== e.shiftKey);
      d.el.style.width = b.w !== d.rect.w ? `${b.w}px` : d.orig.width;
      d.el.style.height = b.h !== d.rect.h ? `${b.h}px` : d.orig.height;
      d.el.style.transform = `${d.orig.transform} translate(${b.x - d.rect.x}px, ${b.y - d.rect.y}px)`;
      setRects((r) => ({ ...r, sel: b }));
    }
  };

  const onGroupDown = (e: RPointerEvent<HTMLElement>) => {
    const items = groupItems();
    const rect = unionRect(items.map((it) => it.rect));
    if (!rect) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    groupDragRef.current = { startX: e.clientX, startY: e.clientY, rect, items, ov: dragOverlap(items.map((it) => it.id)) };
  };

  const groupDelta = (g: { startX: number; startY: number; rect: Rect }, e: RPointerEvent<HTMLElement>) => {
    const [ddx, ddy] = snapDelta(g.rect, (e.clientX - g.startX) / zoom, (e.clientY - g.startY) / zoom, !snapOn(e.altKey));
    return { ddx, ddy };
  };

  const onGroupMove = (e: RPointerEvent<HTMLElement>) => {
    const g = groupDragRef.current;
    if (!g) return;
    const { ddx, ddy } = groupDelta(g, e);
    for (const it of g.items) it.el.style.transform = `${it.transform} translate(${ddx}px, ${ddy}px)`;
    const moved = g.items.map((it) => ({ ...it.rect, x: it.rect.x + ddx, y: it.rect.y + ddy }));
    const overlap = overlapAt(g.ov, ddx, ddy);
    setRects((r) => ({ ...r, others: moved, group: { ...g.rect, x: g.rect.x + ddx, y: g.rect.y + ddy }, overlap }));
  };

  const onGroupUp = (e: RPointerEvent<HTMLElement>) => {
    const g = groupDragRef.current;
    if (!g) return;
    groupDragRef.current = null;
    setRects((r) => ({ ...r, overlap: [] }));
    const { ddx, ddy } = groupDelta(g, e);
    for (const it of g.items) it.el.style.transform = it.transform;
    commitGroup(g.items, ddx, ddy);
  };

  const onHandleUp = (e: RPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setRects((r) => ({ ...r, overlap: [] }));
    const dx = (e.clientX - d.startX) / zoom;
    const dy = (e.clientY - d.startY) / zoom;
    d.el.style.transform = d.orig.transform;
    d.el.style.width = d.orig.width;
    d.el.style.height = d.orig.height;
    if (d.mode === "move") commitMove(d.id, d.el, d.rect, d.cs, dx, dy, e.altKey);
    else {
      const patch = resizePatch(d.rect, d.cs, resizeBox(d.rect, d.mode, dx, dy, d.ratio !== e.shiftKey));
      if (!patch) return;
      const parent = d.el.parentElement;
      if (parent && frame && /flex/.test(frame.win.getComputedStyle(parent).display)) patch.flex = "none";
      onPatchStyles(withPhotoReset([{ id: d.id, patch }]));
    }
  };

  // 방향키 옮기기 — 안내선이 켜 있으면 가로는 한 열·세로는 4pt 맞춤, 아니면 dx·dy 그대로
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      nudge: (dx, dy, free = false) => {
        const snap = snapOn(free);
        const hx = dx === 0 ? 0 : snap ? Math.sign(dx) * COL_STEP : dx;
        if (multi) {
          const items = groupItems();
          const g = unionRect(items.map((it) => it.rect));
          if (g) commitGroup(items, ...snapDelta(g, hx, dy, !snap));
          return;
        }
        if (!frame || !selectedId || !selCaps?.move) return;
        const id = layoutId(selectedId);
        const el = elOf(id);
        const rect = rectOf(el);
        if (!el || !rect) return;
        commitMove(id, el, rect, readCs(el, frame.win), hx, dy, free);
      },
      captureBind: () => {
        const active = frame?.doc.activeElement as HTMLElement | null;
        const editing = (active?.closest?.("[data-st-edit]") as HTMLElement | null) ?? null;
        const id = editing?.getAttribute("data-cn") ?? selectedId;
        const n = id && textBlocks.has(id) ? findNode(tree, id) : null;
        if (!n) return null;
        return captureAt(n, editing && editing.getAttribute("data-cn") === n.id ? editing : null);
      },
      geometry: (id) => {
        const el = elOf(layoutId(id));
        const r = rectOf(el);
        if (!el || !r || !frame) return null;
        const cs = frame.win.getComputedStyle(el);
        const fontPx = parseFloat(cs.fontSize) || 0;
        return { ...r, fontPx, lineRatio: fontPx ? lineRatioOf(cs) : 1.4 };
      },
      copyInfo: (id) => {
        const box = elOf(layoutId(id));
        const r = rectOf(box);
        if (!box || !r || !frame) return null;
        const at: DuplicateAt = { ...r, fontPx: parseFloat(frame.win.getComputedStyle(box).fontSize) || 0 };
        if (textBlocks.has(id)) {
          at.textStyle = textStyleOf(box, frame.win);
          at.childStyles = Array.from(box.children)
            .filter((c) => c.tagName !== "BR")
            .map((c) => {
              const look = textStyleOf(c as HTMLElement, frame.win);
              const display = frame.win.getComputedStyle(c).display;
              return display === "block" ? { ...look, display } : look;
            });
        }
        if (layoutId(id) !== id) {
          // 사진 틀의 모서리·초점도 사본에 — 틀을 보존한다
          const radius = frame.win.getComputedStyle(box).borderRadius;
          if (/^[\d.]+px( [\d.]+px){0,3}$/.test(radius) && parseFloat(radius.replace(/.* /, "")) > 0) at.radius = radius;
          const pos = /^([\d.]+)% ([\d.]+)%$/.exec(elOf(id) ? frame.win.getComputedStyle(elOf(id)!).objectPosition : "");
          if (pos) at.focus = { fx: Number(pos[1]), fy: Number(pos[2]) };
        }
        return at;
      },
      focusChip: (blockId, chipId) => {
        const el = elOf(blockId);
        if (!el || !frame) return;
        const chip = el.querySelector(`[data-chip="${CSS.escape(chipId)}"]`);
        el.focus();
        const r = frame.doc.createRange();
        if (chip) r.setStartAfter(chip);
        else r.selectNodeContents(el);
        r.collapse(Boolean(chip));
        const s = frame.doc.getSelection();
        s?.removeAllRanges();
        s?.addRange(r);
      },
    };
  }, [handleRef, frame, selectedId, selCaps, elOf, rectOf, commitMove, textBlocks, tree, captureAt, multi, groupItems, commitGroup, layoutId, snapOn]);

  // iframe 안의 단축키 → 화면 쪽 처리기
  useEffect(() => {
    if (!frame) return;
    const onKey = (e: KeyboardEvent) => {
      const editing = (e.target as HTMLElement | null)?.closest?.("[data-st-edit]");
      if (editing) {
        // 글 고치는 중에는 실행 취소도 글 안에서(브라우저 기본)
        return;
      }
      if (onKeyCommand(e.key, e)) e.preventDefault();
    };
    frame.doc.addEventListener("keydown", onKey);
    return () => frame.doc.removeEventListener("keydown", onKey);
  }, [frame, onKeyCommand]);

  const hitTest = (target: EventTarget | null): string | null => {
    const el = (target as HTMLElement | null)?.closest?.("[data-cn]") as HTMLElement | null;
    if (!el) return null;
    const sel = resolveSelection(tree, el.getAttribute("data-cn")!);
    return sel?.id ?? null;
  };

  const stageW = PAGE_W * zoom;
  const stageH = PAGE_H * zoom;
  const scaleStyle: CSSProperties = { width: PAGE_W, height: PAGE_H, transform: `scale(${zoom})` };
  const box = (r: Rect, cls: string, extra?: ReactNode, key?: string) => (
    <div key={key} className={`st-box ${cls}`} style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
      {extra}
    </div>
  );

  return (
    <PortalFrame
      kit={kit}
      fontSet={fontSet}
      extraCss={CANVAS_CSS}
      title="회사소개서 쪽 캔버스"
      style={{ width: stageW + 32, height: stageH + 40 }}
      onReady={(doc, win) => setFrame({ doc, win })}
    >
      <div
        className="st-stage"
        style={{ width: stageW, height: stageH, margin: "24px 16px 16px" }}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest(".st-handle, .st-grip")) return;
          const id = hitTest(e.target);
          if (id && (e.shiftKey || e.ctrlKey || e.metaKey)) {
            // 묶음에 더하기·빼기 — 글 블록에 초점이 가서 한 개 선택으로 돌아가지 않게
            e.preventDefault();
            onToggleSelect(id);
            return;
          }
          // 글 블록: 첫 클릭은 요소 고르기(글 커서를 넣지 않아야 Delete·Ctrl+C 가 요소에 먹는다). 이미 고른 글을 다시 누르거나 두 번 누르면 글 고치기
          const editEl = (e.target as HTMLElement).closest("[data-st-edit]");
          if (editEl && frame && frame.doc.activeElement !== editEl) {
            const picked = selectedIds.length === 1 && (selectedIds[0] === id || selectedIds[0] === editEl.getAttribute("data-cn"));
            if (!picked) {
              e.preventDefault();
              (frame.doc.activeElement as HTMLElement | null)?.blur?.();
              frame.win.focus();
            }
          }
          onSelect(id);
        }}
        onMouseMove={(e) => {
          const id = hitTest(e.target);
          if (id !== hoverId) setHoverId(id);
        }}
        onMouseLeave={() => setHoverId(null)}
      >
        <div ref={scaleRef} className="st-scale" style={scaleStyle}>
          {content}
          <div className="st-overlay" aria-hidden="true">
            {showGuides ? (
              <>
                <div className="st-margin"></div>
                {Array.from({ length: COLUMNS }, (_, i) => (
                  <div key={i} className="st-col" style={{ left: MARGIN_X + i * COL_STEP, width: COL_W }}></div>
                ))}
              </>
            ) : null}
            {rects.warn.map((w, i) => box(w.r, w.kind === "overflow" ? "st-box--warn" : w.kind === "related" ? "st-box--overlap" : "st-box--note", null, `w${i}`))}
            {rects.overlap.map((r, i) => box(r, "st-box--overlap", null, `o${i}`))}
            {rects.hover ? box(rects.hover, "st-box--hover") : null}
            {rects.others.map((r, i) => box(r, "st-box--sel", null, `m${i}`))}
            {rects.group
              ? box(
                  rects.group,
                  "st-box--group",
                  groupIds.length ? (
                    <span className="st-grip" onPointerDown={onGroupDown} onPointerMove={onGroupMove} onPointerUp={onGroupUp}>
                      ⠿ {groupIds.length}개 옮기기
                    </span>
                  ) : null
                )
              : null}
            {rects.sel
              ? box(
                  rects.sel,
                  "st-box--sel",
                  <>
                    {selCaps?.move ? (
                      <span className="st-grip" onPointerDown={onHandleDown("move")} onPointerMove={onHandleMove} onPointerUp={onHandleUp}>
                        ⠿ 옮기기
                      </span>
                    ) : null}
                    {selCaps?.resize
                      ? (["n", "s", "e", "w", "nw", "ne", "sw", "se"] as const).map((m) => (
                          <span key={m} className={`st-handle st-handle--${m}`} onPointerDown={onHandleDown(m)} onPointerMove={onHandleMove} onPointerUp={onHandleUp}></span>
                        ))
                      : null}
                  </>
                )
              : null}
          </div>
        </div>
      </div>
    </PortalFrame>
  );
}

function readCs(el: HTMLElement, win: Window): ElPos {
  const cs = win.getComputedStyle(el);
  const num = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
  return { position: cs.position, left: cs.position === "static" ? 0 : num(cs.left), top: cs.position === "static" ? 0 : num(cs.top) };
}

/** 옮긴 거리(그리드에 맞춘 값) → 스타일 덧씌우기. 움직임이 없으면 null */
function movePatch(rect: Rect, cs: ElPos, ddx: number, ddy: number): Record<string, string> | null {
  if (Math.abs(ddx) < 0.01 && Math.abs(ddy) < 0.01) return null;
  if (cs.position === "absolute") return { left: px(cs.left + ddx), top: px(cs.top + ddy), right: "", bottom: "", width: px(rect.w) };
  return { position: "relative", left: px(cs.left + ddx), top: px(cs.top + ddy) };
}

/** 옮긴 거리 → 실제 적용할 거리. free 면 1pt 단위 그대로, 아니면 그리드 맞춤(열 시작선·4pt 기준선) */
function snapDelta(rect: Rect, dx: number, dy: number, free: boolean): [number, number] {
  if (free) return [Math.round(dx), Math.round(dy)];
  return [snapX(rect.x + dx) - rect.x, snapY(rect.y + dy) - rect.y];
}

/** 손잡이로 바뀐 상자 → 스타일. 절대 위치는 늘 왼쪽·위 기준으로 적는다(오른쪽·아래에 붙은 요소가 반대로 자라지 않게). 바뀐 게 없으면 null */
function resizePatch(rect: Rect, cs: ElPos, b: Rect): Record<string, string> | null {
  const ddx = b.x - rect.x;
  const ddy = b.y - rect.y;
  const patch: Record<string, string> = {};
  if (b.w !== rect.w) patch.width = px(b.w);
  if (b.h !== rect.h) patch.height = px(b.h);
  if (!patch.width && !patch.height) return null;
  if (cs.position === "absolute") Object.assign(patch, { left: px(cs.left + ddx), top: px(cs.top + ddy), right: "", bottom: "" });
  else if (ddx || ddy) Object.assign(patch, { position: "relative", left: px(cs.left + ddx), top: px(cs.top + ddy) });
  return patch;
}

/** 행간 ÷ 글자 크기(normal 이면 1.4) — 글자 크기를 바꿔도 행간이 따라가게 비율로 쓴다 */
function lineRatioOf(cs: CSSStyleDeclaration): number {
  const ratio = parseFloat(cs.lineHeight) / (parseFloat(cs.fontSize) || 1);
  return Number.isFinite(ratio) && ratio > 0 ? Math.min(9, Math.round(ratio * 100) / 100) : 1.4;
}

/** 글의 지금 모양 → 글상자 스타일(토큰 색·서체 역할만) — 복사한 글이 원본과 같아 보이도록 */
function textStyleOf(el: HTMLElement, win: Window): Record<string, string> {
  const cs = win.getComputedStyle(el);
  const out: Record<string, string> = { fontSize: px(parseFloat(cs.fontSize) || 10.5), lineHeight: String(lineRatioOf(cs)) };
  if (/^[1-9]00$/.test(cs.fontWeight)) out.fontWeight = cs.fontWeight;
  if (cs.letterSpacing !== "normal" && parseFloat(cs.letterSpacing)) out.letterSpacing = px(parseFloat(cs.letterSpacing));
  if (["left", "center", "right"].includes(cs.textAlign)) out.textAlign = cs.textAlign;
  if (cs.textTransform !== "none") out.textTransform = cs.textTransform;
  // 지금 값과 같은 토큰을 찾는다 — 토큰이 없는 값은 쓰지 않는다(편집층은 토큰 색만, 글상자 기본 글자색·서체로 남음)
  const probe = el.ownerDocument.createElement("span");
  el.appendChild(probe);
  const resolved = win.getComputedStyle(probe);
  for (const name of [...TEXT_COLORS, ...COLOR_TOKENS.map((t) => t.name)]) {
    if (!resolved.getPropertyValue(`--${name}`)) continue;
    probe.style.color = `var(--${name})`;
    if (resolved.color === cs.color) {
      out.color = `var(--${name})`;
      break;
    }
  }
  for (const role of ["display", "figure"]) {
    probe.style.fontFamily = `var(--kc-font-${role})`;
    if (resolved.fontFamily === cs.fontFamily) out.fontFamily = `var(--kc-font-${role})`;
  }
  probe.remove();
  return out;
}

/** 안내선 폭 설명(디자인 탭) */
export const GRID_NOTE = `본문 폭 ${CONTENT_W}pt · 12열(열 ${COL_W.toFixed(1)}pt, 거터 24pt) · 기준선 4pt`;
