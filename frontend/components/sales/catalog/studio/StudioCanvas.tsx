"use client";

// 스튜디오 A4 캔버스 — 쪽 하나를 iframe 안에 그대로(PDF 와 같은 CSS) 그리고 그 위에서 고른다·고친다·옮긴다.
//   글 블록: 바로 눌러 고친다(contentEditable). 지표 값·아이콘·쪽 번호 링크는 칩(고칠 수 없음, 지울 수는 있음)
//     Ctrl+K = 지표 넣기(커서 자리), 글을 고치지 않은 채 Ctrl+Z/Y = 스튜디오 실행 취소/다시(칩 넣기 되돌리기)
//   선택 상자: 끌기 손잡이(왼쪽 위)로 옮기고, 오른쪽·아래·모서리 손잡이로 크기 — 12열 그리드·4pt 기준선에 맞춘다(L3 쪽만)
//   키보드: 방향키 = 옮기기(가로 1열·세로 4pt, Shift 세로 16pt), Delete = 숨기기, Esc = 선택 해제, Ctrl+Z/Y = 실행 취소/다시
//   안내선: 12열·여백. 검사 표식: 넘침(빨강)·대비·해상도(주황)

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
import { COL_STEP, COL_W, COLUMNS, CONTENT_W, MARGIN_BOTTOM, MARGIN_TOP, MARGIN_X, PAGE_H, PAGE_W, snapWidth, snapX, snapY } from "@/lib/catalog/studio/design-system";
import { CARET_ID, appendCaret, caretNode, collectChips, fromEditableDom, toEditableHtml } from "@/lib/catalog/studio/inline";
import { stripDerived } from "@/lib/catalog/studio/edits";
import { findNode, isChip, textOf, type CNode } from "@/lib/catalog/studio/nodes";
import { nodeProps, renderNode, resolvedChildren, type TreeEnv } from "@/lib/catalog/studio/render-tree";
import { capabilities, isTextBlock, resolveSelection, type EditLevel } from "@/lib/catalog/studio/select";
import type { DomLike } from "@/lib/doc-tree/inline-core";
import { checkSheet, type CheckItem } from "./checks";
import { PortalFrame } from "./Frames";
import type { StudioKit } from "./kit";

export interface CanvasHandle {
  /** 방향키 옮기기(가로 = 열, 세로 = 4pt) */
  nudge: (dx: -1 | 0 | 1, dy: number) => void;
  /** 지표 넣기 자리 — 고치는 중인 글이면 커서 자리, 아니면 고른 글 끝. 글 블록이 아니면 null */
  captureBind: () => BindTarget | null;
  /** 넣은 칩 뒤로 커서를 옮겨 이어서 고치게 한다 */
  focusChip: (blockId: string, chipId: string) => void;
}

/** 지표 넣기 대상 — 글 블록 id 와 표식(caret)이 든 자식 */
export interface BindTarget {
  blockId: string;
  children: CNode[];
  /** 커서 자리에서 열었는지(아니면 글 끝) */
  atCaret: boolean;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const px = (v: number) => `${Math.round(v * 100) / 100}px`;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const noIds = (list: CNode[]) => JSON.parse(JSON.stringify(list.map(stripDerived), (k, v) => (k === "id" ? undefined : v)));

/** 캔버스 iframe 안에서만 쓰는 편집 표시 CSS(문서 CSS 는 건드리지 않는다) */
const CANVAS_CSS = `
.st-stage { position: relative; }
.st-scale { position: relative; transform-origin: 0 0; }
.st-scale > .pk-sheet { box-shadow: 0 1px 6px rgba(0,0,0,.22); }
[data-st-edit] { outline: none; cursor: text; }
[data-st-edit]:focus { box-shadow: 0 0 0 1px rgba(74,99,216,.85); }
[contenteditable="false"][data-chip] { cursor: default; background: rgba(74,99,216,.10); border-radius: 2px; }
.st-overlay { position: absolute; inset: 0; pointer-events: none; }
.st-box { position: absolute; box-sizing: border-box; }
.st-box--hover { outline: 1px dashed rgba(74,99,216,.55); }
.st-box--sel { outline: 1.5px solid #4a63d8; }
.st-box--warn { outline: 1.5px dashed #d64545; }
.st-box--note { outline: 1.5px dashed #c47f00; }
.st-handle { position: absolute; width: 9px; height: 9px; background: #fff; border: 1.5px solid #4a63d8; border-radius: 2px; pointer-events: auto; box-sizing: border-box; }
.st-handle--e { right: -5px; top: calc(50% - 4.5px); cursor: ew-resize; }
.st-handle--s { bottom: -5px; left: calc(50% - 4.5px); cursor: ns-resize; }
.st-handle--se { right: -5px; bottom: -5px; cursor: nwse-resize; }
.st-grip { position: absolute; left: -1px; top: -15px; height: 14px; padding: 0 5px; font: 600 9px/14px sans-serif; color: #fff; background: #4a63d8; border-radius: 3px 3px 0 0; pointer-events: auto; cursor: move; white-space: nowrap; user-select: none; }
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
  selectedId,
  zoom,
  showGuides,
  checks,
  onSelect,
  onCommitText,
  onCommitSlot,
  onPatchStyle,
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
  selectedId: string | null;
  zoom: number;
  showGuides: boolean;
  checks: CheckItem[];
  onSelect: (id: string | null) => void;
  onCommitText: (id: string, children: CNode[]) => void;
  /** 일러스트 글자 자리(313) 고치기 — 평문 → 그 인포그래픽 내용 */
  onCommitSlot?: (slotNodeId: string, text: string) => void;
  onPatchStyle: (id: string, patch: Record<string, string>) => void;
  /** 캔버스에서 누른 단축키(실행 취소 등) — 처리하면 true */
  onKeyCommand: (key: string, e: KeyboardEvent) => boolean;
  /** 글 고치는 중 Ctrl+K — 지표 넣기 창을 연다 */
  onRequestBind?: (target: BindTarget) => void;
  onChecks: (items: CheckItem[]) => void;
  handleRef?: MutableRefObject<CanvasHandle | null>;
}) {
  const [frame, setFrame] = useState<{ doc: Document; win: Window } | null>(null);
  const [rects, setRects] = useState<{ sel: Rect | null; hover: Rect | null; warn: Array<{ r: Rect; kind: string }> }>({ sel: null, hover: null, warn: [] });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const scaleRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<null | { mode: "move" | "e" | "s" | "se"; id: string; startX: number; startY: number; rect: Rect; el: HTMLElement; cs: { position: string; left: number; top: number }; orig: { transform: string; width: string; height: string } }>(null);

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
            dangerouslySetInnerHTML: { __html: text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>") },
            onKeyDown: (e: RKeyboardEvent<HTMLElement>) => {
              if (e.key === "Enter" && multi && role === "center") {
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
          dangerouslySetInnerHTML: { __html: toEditableHtml(kids, (c) => (isChip(c) ? chipHtml(c) : "")) },
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
  }, [tree, env, textBlocks, chipHtml, commitBlock, folio, onSelect, captureAt, onRequestBind, onKeyCommand, onCommitSlot, maxLevel]);

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
    }
    setRects({ sel: rectOf(elOf(selectedId)), hover: hoverId && hoverId !== selectedId ? rectOf(elOf(hoverId)) : null, warn });
  }, [checks, elOf, rectOf, selectedId, hoverId]);

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
  }, [frame, content, flow, sheetEl, onChecks, fontSet]);

  const selCaps = useMemo(() => {
    if (!selectedId) return null;
    const sel = resolveSelection(tree, selectedId);
    return sel ? capabilities(sel, maxLevel) : null;
  }, [tree, selectedId, maxLevel]);

  // ── 옮기기·크기(그리드 맞춤) ──
  const commitMove = useCallback(
    (id: string, el: HTMLElement, rect: Rect, cs: { position: string; left: number; top: number }, dx: number, dy: number) => {
      const tx = snapX(rect.x + dx);
      const ty = snapY(rect.y + dy);
      const ddx = tx - rect.x;
      const ddy = ty - rect.y;
      if (Math.abs(ddx) < 0.01 && Math.abs(ddy) < 0.01) return;
      if (cs.position === "absolute") onPatchStyle(id, { left: px(cs.left + ddx), top: px(cs.top + ddy), right: "", bottom: "", width: px(rect.w) });
      else onPatchStyle(id, { position: "relative", left: px(cs.left + ddx), top: px(cs.top + ddy) });
      void el;
    },
    [onPatchStyle]
  );

  const readCs = (el: HTMLElement, win: Window) => {
    const cs = win.getComputedStyle(el);
    const num = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);
    return { position: cs.position, left: cs.position === "static" ? 0 : num(cs.left), top: cs.position === "static" ? 0 : num(cs.top) };
  };

  const onHandleDown = (mode: "move" | "e" | "s" | "se") => (e: RPointerEvent<HTMLElement>) => {
    if (!frame || !selectedId) return;
    const el = elOf(selectedId);
    const rect = rectOf(el);
    if (!el || !rect) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { mode, id: selectedId, startX: e.clientX, startY: e.clientY, rect, el, cs: readCs(el, frame.win), orig: { transform: el.style.transform, width: el.style.width, height: el.style.height } };
  };

  const onHandleMove = (e: RPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / zoom;
    const dy = (e.clientY - d.startY) / zoom;
    if (d.mode === "move") {
      const ddx = snapX(d.rect.x + dx) - d.rect.x;
      const ddy = snapY(d.rect.y + dy) - d.rect.y;
      d.el.style.transform = `${d.orig.transform} translate(${ddx}px, ${ddy}px)`;
      setRects((r) => ({ ...r, sel: { ...d.rect, x: d.rect.x + ddx, y: d.rect.y + ddy } }));
    } else {
      const w = d.mode !== "s" ? snapWidth(Math.max(8, d.rect.w + dx)).width : d.rect.w;
      const h = d.mode !== "e" ? Math.max(8, snapY(d.rect.h + dy)) : d.rect.h;
      if (d.mode !== "s") d.el.style.width = `${w}px`;
      if (d.mode !== "e") d.el.style.height = `${h}px`;
      setRects((r) => ({ ...r, sel: { ...d.rect, w, h } }));
    }
  };

  const onHandleUp = (e: RPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    const dx = (e.clientX - d.startX) / zoom;
    const dy = (e.clientY - d.startY) / zoom;
    d.el.style.transform = d.orig.transform;
    d.el.style.width = d.orig.width;
    d.el.style.height = d.orig.height;
    if (d.mode === "move") commitMove(d.id, d.el, d.rect, d.cs, dx, dy);
    else {
      const patch: Record<string, string> = {};
      if (d.mode !== "s") patch.width = px(snapWidth(Math.max(8, d.rect.w + dx)).width);
      if (d.mode !== "e") patch.height = px(Math.max(8, snapY(d.rect.h + dy)));
      const parent = d.el.parentElement;
      if (parent && frame && /flex/.test(frame.win.getComputedStyle(parent).display)) patch.flex = "none";
      onPatchStyle(d.id, patch);
    }
  };

  // 방향키 옮기기 — 가로는 한 열, 세로는 4pt(Shift 16pt)
  useEffect(() => {
    if (!handleRef) return;
    handleRef.current = {
      nudge: (dir, dy) => {
        if (!frame || !selectedId || !selCaps?.move) return;
        const el = elOf(selectedId);
        const rect = rectOf(el);
        if (!el || !rect) return;
        const dx = dir === 0 ? 0 : dir * COL_STEP;
        commitMove(selectedId, el, rect, readCs(el, frame.win), dx, dy);
      },
      captureBind: () => {
        const active = frame?.doc.activeElement as HTMLElement | null;
        const editing = (active?.closest?.("[data-st-edit]") as HTMLElement | null) ?? null;
        const id = editing?.getAttribute("data-cn") ?? selectedId;
        const n = id && textBlocks.has(id) ? findNode(tree, id) : null;
        if (!n) return null;
        return captureAt(n, editing && editing.getAttribute("data-cn") === n.id ? editing : null);
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
  }, [handleRef, frame, selectedId, selCaps, elOf, rectOf, commitMove, textBlocks, tree, captureAt]);

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
          onSelect(hitTest(e.target));
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
            {rects.warn.map((w, i) => box(w.r, w.kind === "overflow" ? "st-box--warn" : "st-box--note", null, `w${i}`))}
            {rects.hover ? box(rects.hover, "st-box--hover") : null}
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
                      ? (["e", "s", "se"] as const).map((m) => (
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

/** 안내선 폭 설명(디자인 탭) */
export const GRID_NOTE = `본문 폭 ${CONTENT_W}pt · 12열(열 ${COL_W.toFixed(1)}pt, 거터 24pt) · 기준선 4pt`;
