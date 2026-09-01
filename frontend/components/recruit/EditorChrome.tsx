"use client";

// 에디터 크롬 — 일러스트레이터식 좌측 고정 도구 바 + 블록 선택 박스(리사이즈 핸들).
// 호버 팝업 없이 "클릭해 선택 → 좌측 바에서 해당 도구 활성화" 모델로 동작한다.
// - 블록 선택: 클릭한 블록에 선택 테두리 + 우측(너비)/하단(높이)/모서리 핸들 드래그 크기조절
// - 선택 상태(편집 캐럿 없음)에서 화살표 = 1px 미세 이동(Shift 8px), Delete = 삭제, Esc = 해제
// - 인라인 이미지 클릭 시 이미지 도구(크기·좌/우 배치·삭제) 활성화

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  AArrowDown,
  AArrowUp,
  ArrowDown,
  ArrowUp,
  Bold,
  ChevronsLeft,
  ChevronsRight,
  Copy,
  Dot,
  Eraser,
  Highlighter,
  ImagePlus,
  Minus,
  Omega,
  PanelLeft,
  PanelRight,
  Plus,
  Square,
  Trash2,
  Underline,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { DocNode } from "@/lib/recruit/types";
import { findNode, findParent, hasBullet } from "@/lib/recruit/tree-ops";
import { commitEditableElement, type DocEditorCallbacks } from "./DocNodeView";

const MAX_IMAGE_BYTES = 500 * 1024;

export interface ChromeOps {
  addRepeatItem: (id: string) => void;
  removeRepeatItem: (id: string) => void;
  moveRepeatItem: (id: string, dir: -1 | 1) => void;
  duplicateNode: (id: string) => void;
  removeNode: (id: string) => void;
  moveNode: (id: string, dir: -1 | 1) => void;
  nudgeNode: (id: string, dx: number, dy: number) => void;
  resizeNode: (id: string, size: { width?: number; height?: number }) => void;
  insertImageBlock: (refId: string, dataUri: string) => void;
  toggleBullet: (id: string) => void;
  adjustBulletGap: (id: string, delta: number) => void;
  setFontSize: (id: string, px: number) => void;
}

// 기호 삽입 팔레트 — 채용공고에서 쓸 법한 글머리·강조·화살표류 위주.
const SYMBOLS = [
  "※", "·", "ㆍ", "•", "●", "○", "■", "□", "◆", "◇", "▶", "▷",
  "▲", "△", "▼", "▽", "★", "☆", "→", "⇒", "↔", "✓", "✔", "―",
  "①", "②", "③", "④", "⑤", "＋", "﹡", "◎",
];

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) {
      return reject(new Error("PNG/JPEG/GIF/WebP 이미지만 넣을 수 있습니다."));
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return reject(new Error("이미지는 500KB 이하만 넣을 수 있습니다. (로고는 작게 줄여서 사용하세요)"));
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

interface SelRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function ToolBtn({
  icon,
  title,
  disabled,
  danger,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      // mousedown 을 막아 편집 중 텍스트 선택·포커스를 유지한 채 도구를 누를 수 있게 한다.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "w-9 h-9 rounded-lg inline-flex items-center justify-center transition-colors",
        disabled
          ? "cd-text-faint opacity-40 cursor-not-allowed"
          : danger
            ? "text-[color:var(--cd-error)] hover:bg-[color:var(--cd-error-soft)]"
            : "cd-text-muted hover:cd-soft-primary"
      )}
    >
      {icon}
    </button>
  );
}

function Divider() {
  return <div className="w-6 h-px my-1 self-center" style={{ background: "var(--cd-border)" }} />;
}

export function EditorChrome({
  containerRef,
  tree,
  ctx,
  ops,
  onError,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  tree: DocNode;
  ctx: DocEditorCallbacks;
  ops: ChromeOps;
  onError: (message: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
  const [editingActive, setEditingActive] = useState(false);
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null);
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const [selRect, setSelRect] = useState<SelRect | null>(null);
  const savedRange = useRef<Range | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const resizingRef = useRef(false);

  const selEl = useCallback((): HTMLElement | null => {
    const container = containerRef.current;
    if (!container || !selectedId) return null;
    return container.querySelector<HTMLElement>(`[data-rcid="${CSS.escape(selectedId)}"]`);
  }, [containerRef, selectedId]);

  const updateRect = useCallback(() => {
    const container = containerRef.current;
    const el = selEl();
    if (!container || !el) return setSelRect(null);
    const r = el.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    setSelRect({
      top: r.top - c.top + container.scrollTop,
      left: r.left - c.left + container.scrollLeft,
      width: r.width,
      height: r.height,
    });
  }, [containerRef, selEl]);

  // 선택·트리 변경 시 선택 박스 추적(요소가 사라졌으면 해제)
  useEffect(() => {
    if (!selectedId) return setSelRect(null);
    if (!selEl()) {
      setSelectedId(null);
      return setSelRect(null);
    }
    updateRect();
  }, [selectedId, tree, selEl, updateRect]);

  // 클릭 = 선택. 인라인 이미지 > 블록 > 배경(해제) 순으로 판정.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onClick = (e: MouseEvent) => {
      if (resizingRef.current) return; // 리사이즈 드래그 종료 클릭이 선택을 해제하지 않게
      const t = e.target as HTMLElement;
      selectedImg?.classList.remove("rc-img-selected");
      if (t.tagName === "IMG" && t.closest("[contenteditable]")) {
        t.classList.add("rc-img-selected");
        setSelectedImg(t as HTMLImageElement);
        setSelectedId(null);
        return;
      }
      setSelectedImg(null);
      const block = t.closest("[data-rcid]");
      setSelectedId(block ? block.getAttribute("data-rcid") : null);
    };
    const onScroll = () => updateRect();
    container.addEventListener("click", onClick);
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("click", onClick);
      container.removeEventListener("scroll", onScroll);
    };
  }, [containerRef, selectedImg, updateRect]);

  // 편집(캐럿) 상태 추적 + 선택 범위 저장(이미지 삽입 위치 복원용)
  useEffect(() => {
    const container = containerRef.current;
    const onFocusChange = () => {
      const active = document.activeElement as HTMLElement | null;
      const editing = Boolean(active?.isContentEditable && container?.contains(active));
      setEditingActive(editing);
      setActiveBlockId(editing ? active!.getAttribute("data-rcid") : null);
    };
    const onSelectionChange = () => {
      const sel = document.getSelection();
      const active = document.activeElement as HTMLElement | null;
      if (sel && sel.rangeCount > 0 && active?.isContentEditable && container?.contains(active)) {
        savedRange.current = sel.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener("focusin", onFocusChange);
    document.addEventListener("focusout", onFocusChange);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("focusin", onFocusChange);
      document.removeEventListener("focusout", onFocusChange);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [containerRef]);

  // 선택 상태(편집 캐럿 없음) 키 조작 — 화살표 미세 이동 / Delete 삭제 / Esc 해제
  const node = selectedId ? findNode(tree, selectedId) : null;
  const parent = selectedId ? findParent(tree, selectedId) : null;
  const isRepeat = Boolean(node?.repeatGroup && !node.separator);
  const canRemove = node && parent
    ? isRepeat
      ? (parent.children ?? []).filter((c) => c.repeatGroup === node.repeatGroup && !c.separator).length > 1
      : (parent.children ?? []).length > 1
    : false;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingActive || !selectedId) return;
      const step = e.shiftKey ? 8 : 1;
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (delta[e.key]) {
        e.preventDefault();
        ops.nudgeNode(selectedId, ...delta[e.key]);
      } else if ((e.key === "Delete" || e.key === "Backspace") && canRemove) {
        e.preventDefault();
        if (isRepeat) ops.removeRepeatItem(selectedId);
        else ops.removeNode(selectedId);
        setSelectedId(null);
      } else if (e.key === "Escape") {
        setSelectedId(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editingActive, selectedId, ops, isRepeat, canRemove]);

  // ── 도구 동작 ────────────────────────────────────────
  const exec = useCallback((command: string, value?: string) => {
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, value);
  }, []);

  const applyAccent = useCallback(() => {
    exec("foreColor", ctx.accentHex);
    if (!document.queryCommandState("bold")) exec("bold");
  }, [exec, ctx.accentHex]);

  /** 도구 적용 대상 블록 — 편집 중이면 그 블록, 아니면 선택 블록. */
  const targetBlockId = editingActive ? activeBlockId : selectedId;
  const targetNode = targetBlockId ? findNode(tree, targetBlockId) : null;

  /** 편집 중이면 현재 DOM 을 먼저 커밋(blur)하고, 대상을 선택 상태로 남겨 연속 조작을 가능하게 한다. */
  const flushToSelection = useCallback((): string | null => {
    const id = targetBlockId;
    if (!id) return null;
    const active = document.activeElement as HTMLElement | null;
    if (active?.isContentEditable) active.blur(); // onBlur 커밋이 동기 실행된다
    setSelectedId(id);
    return id;
  }, [targetBlockId]);

  const toggleBullet = useCallback(() => {
    const id = flushToSelection();
    if (id) ops.toggleBullet(id);
  }, [flushToSelection, ops]);

  /** 글머리 기호와 텍스트 사이 여백 ±2px. */
  const adjustGap = useCallback(
    (delta: number) => {
      const id = flushToSelection();
      if (id) ops.adjustBulletGap(id, delta);
    },
    [flushToSelection, ops]
  );

  /**
   * 글자 크기 ±1px — 편집 중 드래그 선택 영역이 있으면 그 부분만(span font-size),
   * 아니면 대상 블록 전체의 fontSize 를 조절한다.
   */
  const adjustFontSize = useCallback(
    (delta: number) => {
      const sel = document.getSelection();
      const active = document.activeElement as HTMLElement | null;
      if (editingActive && active?.isContentEditable && sel && !sel.isCollapsed) {
        const anchorEl =
          sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement ?? active;
        const cur = parseFloat(getComputedStyle(anchorEl as Element).fontSize) || 14;
        const target = Math.min(Math.max(Math.round(cur) + delta, 8), 96);
        // execCommand('fontSize', 7) 이 만든 마커(font size=7 / xxx-large span)를 px 스팬으로 치환하는 고전 트릭
        document.execCommand("styleWithCSS", false, "false");
        document.execCommand("fontSize", false, "7");
        active.querySelectorAll('font[size="7"], span[style*="xxx-large"]').forEach((f) => {
          const span = document.createElement("span");
          span.style.fontSize = `${target}px`;
          while (f.firstChild) span.appendChild(f.firstChild);
          f.replaceWith(span);
        });
        return;
      }
      const id = targetBlockId;
      const container = containerRef.current;
      const el = id && container ? container.querySelector<HTMLElement>(`[data-rcid="${CSS.escape(id)}"]`) : null;
      if (!id || !el) return;
      const cur = parseFloat(getComputedStyle(el).fontSize) || 14;
      flushToSelection();
      ops.setFontSize(id, Math.round(cur) + delta);
    },
    [editingActive, targetBlockId, containerRef, flushToSelection, ops]
  );

  /** 기호 삽입 — 편집 캐럿(저장해 둔 선택 범위) 위치에 문자를 넣는다. */
  const insertSymbol = useCallback((ch: string) => {
    const sel = document.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    document.execCommand("insertText", false, ch);
  }, []);

  const insertImage = useCallback(
    async (file: File) => {
      try {
        const uri = await fileToDataUri(file);
        if (editingActive || savedRange.current) {
          // 편집 캐럿 위치에 인라인 삽입 — 커밋은 블록 블러 시점에 일어난다
          const sel = document.getSelection();
          if (savedRange.current && sel) {
            sel.removeAllRanges();
            sel.addRange(savedRange.current);
          }
          document.execCommand("insertImage", false, uri);
          const container = containerRef.current;
          const imgs = container?.querySelectorAll<HTMLImageElement>(`img[src="${CSS.escape(uri)}"]`);
          const img = imgs && imgs.length > 0 ? imgs[imgs.length - 1] : null;
          if (img) {
            if (!img.style.width) img.style.width = "140px";
            img.style.maxWidth = "100%";
            img.style.verticalAlign = "middle";
          }
        } else if (selectedId) {
          ops.insertImageBlock(selectedId, uri);
        }
      } catch (e) {
        onError((e as Error).message);
      }
    },
    [editingActive, selectedId, containerRef, ops, onError]
  );

  /** 인라인 이미지 조작 — DOM 에 즉시 반영, 트리 커밋은 블록 블러 시(참조 유지). */
  const resizeImg = useCallback(
    (factor: number) => {
      if (!selectedImg) return;
      const w = selectedImg.getBoundingClientRect().width;
      selectedImg.style.width = `${Math.max(20, Math.round(w * factor))}px`;
      selectedImg.style.height = "auto";
    },
    [selectedImg]
  );

  const setImgFloat = useCallback(
    (side: "left" | "right" | null) => {
      if (!selectedImg) return;
      if (side) {
        selectedImg.style.float = side;
        selectedImg.style[side === "left" ? "marginRight" : "marginLeft"] = "14px";
        selectedImg.style.marginBottom = "6px";
      } else {
        selectedImg.style.float = "";
        selectedImg.style.marginLeft = "";
        selectedImg.style.marginRight = "";
        selectedImg.style.marginBottom = "";
      }
    },
    [selectedImg]
  );

  const deleteImg = useCallback(() => {
    if (!selectedImg) return;
    const host = selectedImg.closest("[contenteditable][data-rcid]") as HTMLElement | null;
    selectedImg.remove();
    setSelectedImg(null);
    if (host) commitEditableElement(host, ctx);
  }, [selectedImg, ctx]);

  /** 블록 조작 전 편집 중이던 내용을 먼저 커밋(blur) — 미저장 타이핑 유실 방지. */
  const flushEditing = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active?.isContentEditable) active.blur();
  }, []);

  const duplicate = useCallback(() => {
    if (!selectedId) return;
    flushEditing();
    if (isRepeat) ops.addRepeatItem(selectedId);
    else ops.duplicateNode(selectedId);
  }, [selectedId, isRepeat, ops, flushEditing]);

  const move = useCallback(
    (dir: -1 | 1) => {
      if (!selectedId) return;
      flushEditing();
      if (isRepeat) ops.moveRepeatItem(selectedId, dir);
      else ops.moveNode(selectedId, dir);
    },
    [selectedId, isRepeat, ops, flushEditing]
  );

  const removeSelected = useCallback(() => {
    if (!selectedId || !canRemove) return;
    flushEditing();
    if (isRepeat) ops.removeRepeatItem(selectedId);
    else ops.removeNode(selectedId);
    setSelectedId(null);
  }, [selectedId, canRemove, isRepeat, ops, flushEditing]);

  // ── 리사이즈 핸들 드래그 ─────────────────────────────
  const startResize = useCallback(
    (e: React.MouseEvent, mode: "e" | "s" | "se") => {
      const el = selEl();
      if (!el || !selectedId) return;
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = true;
      const startX = e.clientX;
      const startY = e.clientY;
      const startRect = el.getBoundingClientRect();
      let finalW: number | undefined;
      let finalH: number | undefined;
      const onMove = (ev: MouseEvent) => {
        if (mode !== "s") {
          finalW = Math.max(8, startRect.width + (ev.clientX - startX));
          el.style.width = `${Math.round(finalW)}px`;
        }
        if (mode !== "e") {
          finalH = Math.max(8, startRect.height + (ev.clientY - startY));
          el.style.height = `${Math.round(finalH)}px`;
        }
        updateRect();
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        // 드래그 종료의 click 이벤트가 지나간 뒤 플래그 해제
        setTimeout(() => { resizingRef.current = false; }, 0);
        ops.resizeNode(selectedId, { width: finalW, height: finalH });
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [selEl, selectedId, ops, updateRect]
  );

  /** 선택 블록이 독립 이미지 블록이면 도구 바의 이미지 크기 버튼으로 조절(핸들 드래그와 병행). */
  const blockImgSelected = node?.tag === "img";
  const resizeAnyImg = useCallback(
    (factor: number) => {
      if (selectedImg) return resizeImg(factor);
      const el = selEl();
      if (el && selectedId && blockImgSelected) {
        ops.resizeNode(selectedId, { width: el.getBoundingClientRect().width * factor });
      }
    },
    [selectedImg, resizeImg, selEl, selectedId, blockImgSelected, ops]
  );

  const textToolsOn = editingActive;
  const blockToolsOn = Boolean(selectedId);
  const fontSizeOn = editingActive || blockToolsOn;
  const bulletOn = editingActive || blockToolsOn;
  const gapOn = bulletOn && hasBullet(targetNode);
  const imageInsertOn = editingActive || blockToolsOn;
  const imgToolsOn = Boolean(selectedImg) || blockImgSelected;

  const HANDLE: React.CSSProperties = {
    position: "absolute",
    width: 10,
    height: 10,
    background: "#ffffff",
    border: "2px solid #5d87ff",
    borderRadius: 3,
    pointerEvents: "auto",
  };

  return (
    <>
      {/* 좌측 고정 도구 바 */}
      <aside
        className="w-12 shrink-0 rounded-2xl border cd-border-c cd-card-bg p-1.5 flex flex-col items-center sticky top-6 self-start relative"
        style={{ boxShadow: "var(--cd-shadow)" }}
      >
        <ToolBtn icon={<Bold className="w-4 h-4" />} title="굵게 (텍스트 선택 후)" disabled={!textToolsOn} onClick={() => exec("bold")} />
        <ToolBtn icon={<Underline className="w-4 h-4" />} title="밑줄" disabled={!textToolsOn} onClick={() => exec("underline")} />
        <ToolBtn
          icon={<Highlighter className="w-4 h-4" style={textToolsOn ? { color: ctx.accentHex } : undefined} />}
          title="액센트 강조 (색+굵게, 테마 색을 따라감)"
          disabled={!textToolsOn}
          onClick={applyAccent}
        />
        <ToolBtn icon={<Eraser className="w-4 h-4" />} title="서식 지우기" disabled={!textToolsOn} onClick={() => exec("removeFormat")} />
        <ToolBtn
          icon={<AArrowUp className="w-4 h-4" />}
          title="글자 크게 (+1px) — 드래그 선택 부분만, 선택 없으면 블록 전체"
          disabled={!fontSizeOn}
          onClick={() => adjustFontSize(1)}
        />
        <ToolBtn
          icon={<AArrowDown className="w-4 h-4" />}
          title="글자 작게 (−1px)"
          disabled={!fontSizeOn}
          onClick={() => adjustFontSize(-1)}
        />
        <ToolBtn
          icon={<Omega className="w-4 h-4" />}
          title="기호 삽입 (편집 커서 위치에)"
          disabled={!editingActive && !savedRange.current}
          onClick={() => setSymbolsOpen((v) => !v)}
        />
        <Divider />
        <ToolBtn icon={<Dot className="w-6 h-6 -m-1" />} title="글머리 기호 넣기/빼기" disabled={!bulletOn} onClick={toggleBullet} />
        <ToolBtn
          icon={<ChevronsLeft className="w-4 h-4" />}
          title="글머리 여백 좁게 (−2px)"
          disabled={!gapOn}
          onClick={() => adjustGap(-2)}
        />
        <ToolBtn
          icon={<ChevronsRight className="w-4 h-4" />}
          title="글머리 여백 넓게 (+2px)"
          disabled={!gapOn}
          onClick={() => adjustGap(2)}
        />
        <ToolBtn
          icon={<ImagePlus className="w-4 h-4" />}
          title="이미지 삽입 — 편집 중이면 커서 위치에, 블록 선택 시 그 아래에 (500KB 이하)"
          disabled={!imageInsertOn}
          onClick={() => fileRef.current?.click()}
        />
        <Divider />
        <ToolBtn icon={<Copy className="w-4 h-4" />} title="블록 복제 (반복 항목이면 항목 추가)" disabled={!blockToolsOn} onClick={duplicate} />
        <ToolBtn icon={<ArrowUp className="w-4 h-4" />} title="위로 이동" disabled={!blockToolsOn} onClick={() => move(-1)} />
        <ToolBtn icon={<ArrowDown className="w-4 h-4" />} title="아래로 이동" disabled={!blockToolsOn} onClick={() => move(1)} />
        <ToolBtn
          icon={<Trash2 className="w-4 h-4" />}
          title={canRemove ? "블록 삭제 (Delete)" : "블록을 선택하세요 (마지막 항목은 삭제 불가)"}
          disabled={!blockToolsOn || !canRemove}
          danger
          onClick={removeSelected}
        />
        {imgToolsOn && (
          <>
            <Divider />
            <ToolBtn icon={<Minus className="w-4 h-4" />} title="이미지 작게 (−15%)" onClick={() => resizeAnyImg(0.85)} />
            <ToolBtn icon={<Plus className="w-4 h-4" />} title="이미지 크게 (+20%)" onClick={() => resizeAnyImg(1.2)} />
            {selectedImg && (
              <>
                <ToolBtn icon={<PanelLeft className="w-4 h-4" />} title="왼쪽 배치 (텍스트가 오른쪽으로 흐름)" onClick={() => setImgFloat("left")} />
                <ToolBtn icon={<PanelRight className="w-4 h-4" />} title="오른쪽 배치 (텍스트가 왼쪽으로 흐름)" onClick={() => setImgFloat("right")} />
                <ToolBtn icon={<Square className="w-4 h-4" />} title="배치 해제 (글자처럼 배치)" onClick={() => setImgFloat(null)} />
                <ToolBtn icon={<Trash2 className="w-4 h-4" />} title="이미지 삭제" danger onClick={deleteImg} />
              </>
            )}
          </>
        )}
        {symbolsOpen && (
          <div
            className="absolute left-full ml-2 top-24 rounded-xl border cd-border-c cd-card-bg p-2 grid grid-cols-8 gap-0.5 z-40"
            style={{ boxShadow: "var(--cd-shadow)", width: 236 }}
            onMouseDown={(e) => e.preventDefault()}
          >
            {SYMBOLS.map((ch) => (
              <button
                key={ch}
                type="button"
                className="w-7 h-7 rounded-md text-sm cd-text hover:cd-soft-primary"
                onClick={() => insertSymbol(ch)}
              >
                {ch}
              </button>
            ))}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void insertImage(f);
            e.target.value = "";
          }}
        />
      </aside>

      {/* 블록 선택 박스 + 리사이즈 핸들 (캔버스 스크롤 컨테이너 안에 포털) */}
      {selRect &&
        containerRef.current &&
        createPortal(
          <div
            style={{
              position: "absolute",
              top: selRect.top - 2,
              left: selRect.left - 2,
              width: selRect.width + 4,
              height: selRect.height + 4,
              border: "2px solid #5d87ff",
              borderRadius: 4,
              pointerEvents: "none",
              zIndex: 25,
            }}
          >
            <div title="너비 조절" style={{ ...HANDLE, right: -6, top: "50%", marginTop: -5, cursor: "ew-resize" }} onMouseDown={(e) => startResize(e, "e")} />
            <div title="높이 조절" style={{ ...HANDLE, bottom: -6, left: "50%", marginLeft: -5, cursor: "ns-resize" }} onMouseDown={(e) => startResize(e, "s")} />
            <div title="크기 조절" style={{ ...HANDLE, right: -6, bottom: -6, cursor: "nwse-resize" }} onMouseDown={(e) => startResize(e, "se")} />
          </div>,
          containerRef.current
        )}
    </>
  );
}
