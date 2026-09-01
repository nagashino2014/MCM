"use client";

// 에디터 오버레이 — 문서 레이아웃을 건드리지 않고 캔버스 스크롤 컨테이너 위에 떠서 동작한다.
// 1) BlockControlsOverlay: data-rcid 블록 호버 시 추가/복제/이동/삭제 버튼(반복 그룹이면 그룹 시맨틱).
// 2) InlineToolbar: 문단 블록 편집 중 캐럿/선택 위치에 굵게·밑줄·액센트 강조·서식 지우기·이미지 삽입.
//    이미지 클릭 시 크기 조절/삭제 모드로 전환.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import {
  ArrowDown,
  ArrowUp,
  Bold,
  Copy,
  Eraser,
  Highlighter,
  ImagePlus,
  Minus,
  Move,
  Plus,
  Trash2,
  Underline,
  X,
} from "lucide-react";
import type { DocNode } from "@/lib/recruit/types";
import { findNode, findParent } from "@/lib/recruit/tree-ops";
import { commitEditableElement, controlKind, type DocEditorCallbacks } from "./DocNodeView";

const MAX_IMAGE_BYTES = 500 * 1024;

// 오버레이 버튼 공통 스타일 — 문서는 cdash 스코프 밖이라 hex 고정(cd-primary 계열).
const BTN: CSSProperties = {
  width: 24,
  height: 24,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "none",
  borderRadius: 6,
  background: "#5d87ff",
  color: "#fff",
  cursor: "pointer",
  padding: 0,
};
const BAR: CSSProperties = {
  position: "absolute",
  zIndex: 30,
  display: "flex",
  gap: 3,
  background: "#ffffff",
  border: "1px solid #dbe3ef",
  borderRadius: 8,
  padding: 3,
  boxShadow: "0 4px 12px rgba(0,0,0,0.14)",
};

interface BlockOps {
  addRepeatItem: (id: string) => void;
  removeRepeatItem: (id: string) => void;
  moveRepeatItem: (id: string, dir: -1 | 1) => void;
  duplicateNode: (id: string) => void;
  removeNode: (id: string) => void;
  moveNode: (id: string, dir: -1 | 1) => void;
  nudgeNode: (id: string, dx: number, dy: number) => void;
}

interface HoverState {
  id: string;
  kind: "repeat" | "block";
  top: number;
  left: number;
  canRemove: boolean;
}

/** 컨테이너 좌표계 기준 rect 상단 우측 위치. */
function overlayPos(el: Element, container: HTMLElement): { top: number; left: number } {
  const r = el.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  return {
    top: r.top - c.top + container.scrollTop - 13,
    left: Math.min(r.right - c.left + container.scrollLeft - 8, container.scrollWidth - 130),
  };
}

export function BlockControlsOverlay({
  containerRef,
  tree,
  ops,
}: {
  containerRef: RefObject<HTMLElement | null>;
  tree: DocNode | null;
  ops: BlockOps;
}) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [nudgeId, setNudgeId] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // 미세 이동 모드 — 화살표 1px(Shift 8px)로 블록 시각 위치 조정, Esc/외부 클릭으로 종료.
  useEffect(() => {
    if (!nudgeId) return;
    const container = containerRef.current;
    const onKey = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 8 : 1;
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (delta[e.key]) {
        e.preventDefault();
        ops.nudgeNode(nudgeId, ...delta[e.key]);
      } else if (e.key === "Escape" || e.key === "Enter") {
        setNudgeId(null);
      }
    };
    const onClick = (e: MouseEvent) => {
      const el = container?.querySelector(`[data-rcid="${CSS.escape(nudgeId)}"]`);
      if (el && !el.contains(e.target as Node) && !barRef.current?.contains(e.target as Node)) setNudgeId(null);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onClick, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onClick, true);
    };
  }, [nudgeId, containerRef, ops]);

  // 미세 이동 대상 표시 — 트리 변경 리렌더로 요소가 재생성돼도 다시 칠한다.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !nudgeId) return;
    const el = container.querySelector<HTMLElement>(`[data-rcid="${CSS.escape(nudgeId)}"]`);
    if (el) el.style.outline = "2px dashed #5d87ff";
    return () => {
      const cur = container.querySelector<HTMLElement>(`[data-rcid="${CSS.escape(nudgeId)}"]`);
      if (cur) cur.style.outline = "";
    };
  }, [nudgeId, containerRef, tree]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !tree) return;
    const onOver = (e: MouseEvent) => {
      if (barRef.current?.contains(e.target as Node)) return; // 컨트롤 위에서는 유지
      const el = (e.target as Element).closest?.("[data-rcid]");
      if (!el) return;
      const id = el.getAttribute("data-rcid")!;
      const node = findNode(tree, id);
      const parent = node ? findParent(tree, id) : null;
      if (!node || !parent) return setHover(null);
      const kind = controlKind(node);
      if (!kind) return setHover(null);
      const canRemove =
        kind === "repeat"
          ? (parent.children ?? []).filter((c) => c.repeatGroup === node.repeatGroup && !c.separator).length > 1
          : (parent.children ?? []).length > 1;
      setHover({ id, kind, ...overlayPos(el, container as HTMLElement), canRemove });
    };
    const hide = () => setHover(null);
    container.addEventListener("mouseover", onOver);
    container.addEventListener("mouseleave", hide);
    container.addEventListener("scroll", hide, { passive: true });
    return () => {
      container.removeEventListener("mouseover", onOver);
      container.removeEventListener("mouseleave", hide);
      container.removeEventListener("scroll", hide);
    };
  }, [containerRef, tree]);

  if (nudgeId) {
    const c = containerRef.current?.getBoundingClientRect();
    return (
      <div
        ref={barRef}
        style={{
          ...BAR,
          position: "fixed",
          top: (c?.top ?? 0) + 10,
          left: "auto",
          right: window.innerWidth - (c?.right ?? window.innerWidth) + 14,
          alignItems: "center",
          padding: "5px 10px",
        }}
      >
        <span style={{ fontSize: 12, color: "#2a3547", fontWeight: 600 }}>
          미세 이동 — 화살표 1px · Shift 8px · Esc 종료
        </span>
      </div>
    );
  }

  if (!hover) return null;
  const repeat = hover.kind === "repeat";
  return (
    <div ref={barRef} style={{ ...BAR, top: hover.top, left: hover.left }} onMouseDown={(e) => e.preventDefault()}>
      <button
        type="button"
        title={repeat ? "항목 추가(아래에 복제)" : "문단 복제(아래에)"}
        style={BTN}
        onClick={() => (repeat ? ops.addRepeatItem(hover.id) : ops.duplicateNode(hover.id))}
      >
        {repeat ? <Plus size={14} /> : <Copy size={13} />}
      </button>
      <button
        type="button"
        title="위로 이동"
        style={BTN}
        onClick={() => (repeat ? ops.moveRepeatItem(hover.id, -1) : ops.moveNode(hover.id, -1))}
      >
        <ArrowUp size={14} />
      </button>
      <button
        type="button"
        title="아래로 이동"
        style={BTN}
        onClick={() => (repeat ? ops.moveRepeatItem(hover.id, 1) : ops.moveNode(hover.id, 1))}
      >
        <ArrowDown size={14} />
      </button>
      <button
        type="button"
        title="위치 미세 이동 (화살표 키)"
        style={{ ...BTN, background: "#8ea1c0" }}
        onClick={() => setNudgeId(hover.id)}
      >
        <Move size={13} />
      </button>
      <button
        type="button"
        title={hover.canRemove ? "삭제" : "마지막 항목은 삭제할 수 없습니다"}
        style={{ ...BTN, background: hover.canRemove ? "#fa896b" : "#c3ccda", cursor: hover.canRemove ? "pointer" : "not-allowed" }}
        onClick={() => {
          if (!hover.canRemove) return;
          if (repeat) ops.removeRepeatItem(hover.id);
          else ops.removeNode(hover.id);
          setHover(null);
        }}
      >
        <X size={14} />
      </button>
    </div>
  );
}

/** 파일 → data URI (크기·타입 검증 포함). */
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

export function InlineToolbar({
  containerRef,
  ctx,
  onError,
}: {
  containerRef: RefObject<HTMLElement | null>;
  ctx: DocEditorCallbacks;
  onError: (message: string) => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // 캐럿/선택 위치 추적 — 문단 블록 편집 중에만 표시.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onSelectionChange = () => {
      const sel = document.getSelection();
      const active = document.activeElement as HTMLElement | null;
      if (!sel || sel.rangeCount === 0 || !active?.isContentEditable || !container.contains(active)) {
        if (!imgEl) setPos(null);
        return;
      }
      setImgEl(null);
      const range = sel.getRangeAt(0);
      savedRange.current = range.cloneRange();
      let rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) rect = active.getBoundingClientRect();
      const c = container.getBoundingClientRect();
      setPos({
        top: rect.top - c.top + container.scrollTop - 40,
        left: Math.max(rect.left - c.left + container.scrollLeft, 8),
      });
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "IMG" && t.closest("[contenteditable]")) {
        const c = container.getBoundingClientRect();
        const r = t.getBoundingClientRect();
        setImgEl(t as HTMLImageElement);
        setPos({ top: r.top - c.top + container.scrollTop - 40, left: r.left - c.left + container.scrollLeft });
      } else if (imgEl && !barRef.current?.contains(t)) {
        setImgEl(null);
      }
    };
    document.addEventListener("selectionchange", onSelectionChange);
    container.addEventListener("click", onClick);
    const hide = () => { setPos(null); setImgEl(null); };
    container.addEventListener("scroll", hide, { passive: true });
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      container.removeEventListener("click", onClick);
      container.removeEventListener("scroll", hide);
    };
  }, [containerRef, imgEl]);

  const exec = useCallback((command: string, value?: string) => {
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(command, false, value);
  }, []);

  /** 액센트 강조 — 색 + 굵게(템플릿의 ※ 강조행 스타일). 커밋 시 var(--accent) 로 정규화된다. */
  const applyAccent = useCallback(() => {
    exec("foreColor", ctx.accentHex);
    if (!document.queryCommandState("bold")) exec("bold");
  }, [exec, ctx.accentHex]);

  const commitActiveEditable = useCallback(
    (el: HTMLElement | null) => {
      const editable = el?.closest("[contenteditable][data-rcid]") as HTMLElement | null;
      if (editable) commitEditableElement(editable, ctx);
    },
    [ctx]
  );

  const insertImage = useCallback(
    async (file: File) => {
      try {
        const uri = await fileToDataUri(file);
        const sel = document.getSelection();
        if (savedRange.current && sel) {
          sel.removeAllRanges();
          sel.addRange(savedRange.current);
        }
        document.execCommand("insertImage", false, uri);
        // 삽입된 이미지에 기본 크기 부여(원본이 커도 문서를 깨지 않게)
        const container = containerRef.current;
        const imgs = container?.querySelectorAll<HTMLImageElement>(`img[src="${CSS.escape(uri)}"]`);
        const img = imgs && imgs.length > 0 ? imgs[imgs.length - 1] : null;
        if (img) {
          if (!img.style.width) img.style.width = "140px";
          img.style.maxWidth = "100%";
          img.style.verticalAlign = "middle";
          commitActiveEditable(img);
        }
      } catch (e) {
        onError((e as Error).message);
      }
    },
    [containerRef, commitActiveEditable, onError]
  );

  const resizeImage = useCallback(
    (factor: number) => {
      if (!imgEl) return;
      const w = imgEl.getBoundingClientRect().width;
      imgEl.style.width = `${Math.max(24, Math.round(w * factor))}px`;
      imgEl.style.height = "auto";
      commitActiveEditable(imgEl);
    },
    [imgEl, commitActiveEditable]
  );

  const deleteImage = useCallback(() => {
    if (!imgEl) return;
    const host = imgEl.closest("[contenteditable][data-rcid]") as HTMLElement | null;
    imgEl.remove();
    setImgEl(null);
    if (host) commitEditableElement(host, ctx);
  }, [imgEl, ctx]);

  if (!pos) return null;

  return (
    <div ref={barRef} style={{ ...BAR, top: pos.top, left: pos.left }} onMouseDown={(e) => e.preventDefault()}>
      {imgEl ? (
        <>
          <button type="button" title="작게" style={BTN} onClick={() => resizeImage(0.85)}><Minus size={14} /></button>
          <button type="button" title="크게" style={BTN} onClick={() => resizeImage(1.2)}><Plus size={14} /></button>
          <button type="button" title="이미지 삭제" style={{ ...BTN, background: "#fa896b" }} onClick={deleteImage}>
            <Trash2 size={13} />
          </button>
        </>
      ) : (
        <>
          <button type="button" title="굵게 (선택 영역)" style={BTN} onClick={() => exec("bold")}><Bold size={13} /></button>
          <button type="button" title="밑줄" style={BTN} onClick={() => exec("underline")}><Underline size={13} /></button>
          <button
            type="button"
            title="액센트 강조 (색+굵게, 테마 색을 따라감)"
            style={{ ...BTN, background: ctx.accentHex }}
            onClick={applyAccent}
          >
            <Highlighter size={13} />
          </button>
          <button type="button" title="서식 지우기" style={{ ...BTN, background: "#8ea1c0" }} onClick={() => exec("removeFormat")}>
            <Eraser size={13} />
          </button>
          <button type="button" title="이미지 삽입 (커서 위치, 500KB 이하)" style={{ ...BTN, background: "#13deb9" }} onClick={() => fileRef.current?.click()}>
            <ImagePlus size={13} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void insertImage(f);
              e.target.value = "";
            }}
          />
        </>
      )}
    </div>
  );
}
