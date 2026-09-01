"use client";

// 노드트리 재귀 렌더러 — 채용공고 문서의 뷰이자 인라인 에디터.
// 업로드 HTML 을 innerHTML 로 꽂지 않고 React 엘리먼트로만 그린다(스크립트 실행 경로 차단).
// - 편집 모드: 텍스트 노드는 contentEditable(블러 시 커밋), 반복 항목은 호버 시 추가/삭제/이동 컨트롤.
// - 읽기 모드(미리보기·축소 카드): 순수 렌더.

import {
  createContext,
  createElement,
  useContext,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import type { DocNode } from "@/lib/recruit/types";

export interface DocEditorCallbacks {
  editable: boolean;
  onCommitText: (id: string, text: string) => void;
  onAddItem: (id: string) => void;
  onRemoveItem: (id: string) => void;
  onMoveItem: (id: string, dir: -1 | 1) => void;
}

const DocEditorContext = createContext<DocEditorCallbacks | null>(null);
export const DocEditorProvider = DocEditorContext.Provider;

// 반복 항목 호버 컨트롤 색 — 문서는 cdash 스코프 밖이라 hex 고정(cd-primary 계열).
const CTRL_BG = "#5d87ff";

function TextNodeView({ node }: { node: DocNode }) {
  const ctx = useContext(DocEditorContext);
  if (!ctx?.editable) return <>{node.text ?? ""}</>;
  return (
    <span
      className="rc-edit-text"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onKeyDown={(e) => {
        // 텍스트 런은 단일 문구 단위 — Enter 는 줄바꿈 대신 커밋으로 처리한다.
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLElement).blur();
        }
      }}
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

/** 반복 항목 위 호버 컨트롤(추가/이동/삭제). 문서 레이아웃을 건드리지 않게 absolute 오버레이. */
function RepeatControls({ node, canRemove }: { node: DocNode; canRemove: boolean }) {
  const ctx = useContext(DocEditorContext)!;
  const btn: CSSProperties = {
    width: 22,
    height: 22,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    borderRadius: 6,
    background: CTRL_BG,
    color: "#fff",
    cursor: "pointer",
    padding: 0,
  };
  return (
    <span
      className="rc-item-controls"
      style={{
        position: "absolute",
        top: -11,
        right: -6,
        zIndex: 20,
        display: "flex",
        gap: 3,
        background: "#ffffff",
        border: "1px solid #dbe3ef",
        borderRadius: 8,
        padding: 3,
        boxShadow: "0 4px 10px rgba(0,0,0,0.12)",
      }}
      contentEditable={false}
    >
      <button type="button" title="항목 추가" style={btn} onClick={() => ctx.onAddItem(node.id)}>
        <Plus size={13} />
      </button>
      <button type="button" title="위로 이동" style={btn} onClick={() => ctx.onMoveItem(node.id, -1)}>
        <ArrowUp size={13} />
      </button>
      <button type="button" title="아래로 이동" style={btn} onClick={() => ctx.onMoveItem(node.id, 1)}>
        <ArrowDown size={13} />
      </button>
      <button
        type="button"
        title={canRemove ? "항목 삭제" : "마지막 항목은 삭제할 수 없습니다"}
        style={{ ...btn, background: canRemove ? "#fa896b" : "#c3ccda", cursor: canRemove ? "pointer" : "not-allowed" }}
        onClick={() => canRemove && ctx.onRemoveItem(node.id)}
      >
        <X size={13} />
      </button>
    </span>
  );
}

function ElementNodeView({ node, canRemove }: { node: DocNode; canRemove?: boolean }) {
  const ctx = useContext(DocEditorContext);
  const [hover, setHover] = useState(false);
  const editable = ctx?.editable ?? false;
  const isRepeatItem = editable && !!node.repeatGroup && !node.separator;

  const style: CSSProperties = { ...(node.style as CSSProperties | undefined) };
  if (isRepeatItem && !style.position) style.position = "relative";

  // 같은 부모 아래 그룹별 항목 수 — 자식의 삭제 가능 여부 판정.
  const counts = new Map<string, number>();
  for (const c of node.children ?? []) {
    if (c.repeatGroup && !c.separator) counts.set(c.repeatGroup, (counts.get(c.repeatGroup) ?? 0) + 1);
  }

  const children: ReactNode[] = (node.children ?? []).map((c) => (
    <DocNodeView key={c.id} node={c} canRemove={(counts.get(c.repeatGroup ?? "") ?? 0) > 1} />
  ));
  if (isRepeatItem && hover) {
    children.push(<RepeatControls key="__ctrl" node={node} canRemove={canRemove ?? false} />);
  }

  const props: Record<string, unknown> = { style };
  if (isRepeatItem) {
    props.onMouseEnter = () => setHover(true);
    props.onMouseLeave = () => setHover(false);
    props.className = "rc-repeat-item";
  }
  if (node.tag === "a") {
    props.href = node.href ?? "#";
    props.target = "_blank";
    props.rel = "noreferrer";
    if (editable) props.onClick = (e: React.MouseEvent) => e.preventDefault();
  }

  if (node.tag === "br" || node.tag === "hr") return createElement(node.tag, { key: node.id });
  return createElement(node.tag, props, ...(children.length > 0 ? children : []));
}

export function DocNodeView({ node, canRemove }: { node: DocNode; canRemove?: boolean }) {
  if (node.tag === "#text") return <TextNodeView node={node} />;
  return <ElementNodeView node={node} canRemove={canRemove} />;
}
