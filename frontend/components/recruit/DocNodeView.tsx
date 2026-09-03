"use client";

// 노드트리 재귀 렌더러 — 채용공고 문서의 뷰이자 인라인 에디터.
// 업로드 HTML 을 innerHTML 로 꽂지 않고 React 엘리먼트로만 그린다(스크립트 실행 경로 차단).
// 편집 모드:
// - 자식이 전부 인라인인 요소(문단 블록)는 통째로 contentEditable — Enter 줄바꿈, 드래그 선택 후
//   부분 볼드/색 강조/이미지 삽입이 가능하고, 블러 시 DOM 을 역파싱해 트리에 커밋한다.
// - 반복 항목·문단 블록·리프 장식 블록에는 data-rcid 를 달아, 캔버스 오버레이(EditorOverlays)가
//   호버 컨트롤(추가/복제/이동/삭제)을 그 위에 띄운다.

import { createContext, createElement, useContext, type CSSProperties, type ReactNode } from "react";
import type { DocNode } from "@/lib/recruit/types";
import { domToInlineNodes, isInlineBlock, isInlineNode, renderInlineHtml } from "@/lib/recruit/inline";

/**
 * 필(pill) 배지 렌더 방어 — 인라인 내용만 담은 둥근 배지는 줄바꿈되면 항상 깨진다.
 * PNG/PDF 캡처(SVG 직렬화)는 텍스트 폭이 화면과 서브픽셀 수준으로 달라질 수 있어,
 * 여유가 몇 px 뿐인 배지가 캡처에서만 줄바꿈되는 사고("경력직 채용")가 난다.
 * 저장된 트리를 고치는 대신 렌더 시점에 nowrap 을 보강한다(기존 공고 데이터에도 즉시 적용).
 */
function pillSafeStyle(node: DocNode): CSSProperties | undefined {
  const style = node.style;
  if (
    style &&
    /999|9999px/.test(style.borderRadius ?? "") &&
    !style.whiteSpace &&
    (node.children?.length ?? 0) > 0 &&
    node.children!.every(isInlineNode)
  ) {
    return { ...style, whiteSpace: "nowrap" } as CSSProperties;
  }
  return style as CSSProperties | undefined;
}

export interface DocEditorCallbacks {
  editable: boolean;
  /** 액센트 hex — 편집 중 칠한 색을 var(--accent) 로 정규화할 때 비교 기준. */
  accentHex: string;
  /** 문단 블록 편집 커밋 — 자식 노드 배열 교체. */
  onReplaceChildren: (id: string, children: DocNode[]) => void;
  /** 문단 블록 밖 단독 텍스트 런의 폴백 커밋. */
  onCommitText: (id: string, text: string) => void;
}

const DocEditorContext = createContext<DocEditorCallbacks | null>(null);
export const DocEditorProvider = DocEditorContext.Provider;

/** 오버레이 컨트롤 대상 판정 — EditorOverlays 와 공유. */
export function controlKind(node: DocNode): "repeat" | "block" | null {
  if (node.separator || node.tag === "#text") return null;
  if (node.repeatGroup) return "repeat";
  if (isInlineBlock(node)) return "block";
  if (!node.children || node.children.length === 0) return "block"; // 브랜드 마크 같은 리프 장식 블록
  return null;
}

/** 편집된 contentEditable 요소를 트리에 커밋 — 툴바(이미지 조작 등)에서도 호출한다. */
export function commitEditableElement(el: HTMLElement, ctx: DocEditorCallbacks): void {
  const id = el.getAttribute("data-rcid");
  if (id) ctx.onReplaceChildren(id, domToInlineNodes(el, ctx.accentHex));
}

function TextNodeView({ node }: { node: DocNode }) {
  const ctx = useContext(DocEditorContext);
  if (!ctx?.editable) return <>{node.text ?? ""}</>;
  // 문단 블록에 속하지 않는(혼합 콘텐츠 부모의) 텍스트 런 폴백 — 단일 문구 편집만 지원.
  return (
    <span
      className="rc-edit-text"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onPaste={(e) => {
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
      }}
      onBlur={(e) => {
        const next = (e.target as HTMLElement).innerText.replace(/\n+/g, " ");
        if (next !== (node.text ?? "")) ctx.onCommitText(node.id, next);
      }}
    >
      {node.text ?? ""}
    </span>
  );
}

/** 문단 블록 — 통째 contentEditable. 내용은 직렬화 HTML 로 그리고, 블러 시 역파싱 커밋. */
function InlineBlockView({ node }: { node: DocNode }) {
  const ctx = useContext(DocEditorContext)!;
  const html = renderInlineHtml(node.children ?? []);
  return createElement(node.tag, {
    style: pillSafeStyle(node),
    className: "rc-inline-block",
    "data-rcid": node.id,
    contentEditable: true,
    suppressContentEditableWarning: true,
    spellCheck: false,
    dangerouslySetInnerHTML: { __html: html },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        // 사용자 임의 개행 — div 분할 대신 <br> 삽입으로 통일.
        e.preventDefault();
        document.execCommand("insertLineBreak");
      } else if (e.key === "Escape") {
        (e.target as HTMLElement).blur();
      }
    },
    onPaste: (e: React.ClipboardEvent) => {
      e.preventDefault();
      document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
    },
    onBlur: (e: React.FocusEvent) => commitEditableElement(e.currentTarget as HTMLElement, ctx),
  });
}

function ElementNodeView({ node }: { node: DocNode }) {
  const ctx = useContext(DocEditorContext);
  const editable = ctx?.editable ?? false;

  if (node.tag === "br" || node.tag === "hr") return createElement(node.tag);
  if (node.tag === "img") {
    // 독립 이미지 블록 — 편집 모드에선 선택 대상(data-rcid)이 되어 크기조절·이동·삭제 가능.
    return createElement("img", {
      src: node.src,
      style: node.style as CSSProperties | undefined,
      alt: "",
      ...(editable ? { "data-rcid": node.id } : {}),
    });
  }
  if (editable && isInlineBlock(node)) return <InlineBlockView node={node} />;

  const props: Record<string, unknown> = { style: pillSafeStyle(node) };
  if (editable && controlKind(node)) props["data-rcid"] = node.id;
  if (node.tag === "a") {
    props.href = node.href ?? "#";
    props.target = "_blank";
    props.rel = "noreferrer";
    if (editable) props.onClick = (e: React.MouseEvent) => e.preventDefault();
  }

  const children: ReactNode[] = (node.children ?? []).map((c) => <DocNodeView key={c.id} node={c} />);
  return createElement(node.tag, props, ...(children.length > 0 ? children : []));
}

export function DocNodeView({ node }: { node: DocNode }) {
  if (node.tag === "#text") return <TextNodeView node={node} />;
  return <ElementNodeView node={node} />;
}
