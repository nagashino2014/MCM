"use client";

// 문서 캔버스 — 노드트리에 테마 CSS 변수·폰트를 씌워 실제 공고 문서로 렌더한다.
// 에디터 본편(원본 크기)과 카드 축소 미리보기가 공용으로 쓴다.

import { forwardRef, type CSSProperties, type ReactNode } from "react";
import type { DocNode, DocTheme } from "@/lib/recruit/types";
import { buildDocCssVars } from "@/lib/recruit/theme";
import { DocNodeView } from "./DocNodeView";

// 핸드오프 템플릿 표준 폰트(Pretendard) — 문서 렌더·PNG 캡처 품질을 위해 명시 로드.
const PRETENDARD_CSS =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";

export const DocCanvas = forwardRef<HTMLDivElement, { tree: DocNode; theme: DocTheme; width: number }>(
  function DocCanvas({ tree, theme, width }, ref) {
    const vars = buildDocCssVars(theme) as CSSProperties;
    return (
      <div ref={ref} data-rc-doc style={{ ...vars, width }}>
        {/* React 19 가 head 로 호이스팅한다 — 같은 href 는 중복 로드되지 않는다.
            crossOrigin: CORS 모드로 로드해야 PNG/PDF 캡처(html-to-image)가 이 시트의 @font-face 를
            읽어 폰트를 임베드할 수 있다. 없으면 폴백 폰트로 캡처되어 글자 폭이 달라지고
            "경력직 채용" 배지처럼 여유 없는 요소가 줄바꿈되는 캔버스↔출력 불일치가 생긴다. */}
        <link rel="stylesheet" href={PRETENDARD_CSS} precedence="default" crossOrigin="anonymous" />
        <DocNodeView node={tree} />
      </div>
    );
  }
);

/** 카드용 축소 미리보기 — 문서를 scale 로 줄여 고정 높이 안에 담는다. */
export function DocMiniPreview({
  tree,
  theme,
  docWidth,
  previewWidth,
  previewHeight,
  className,
}: {
  tree: DocNode;
  theme: DocTheme;
  docWidth: number;
  previewWidth: number;
  previewHeight: number;
  className?: string;
}) {
  const scale = previewWidth / docWidth;
  return (
    <div
      className={className}
      style={{
        width: previewWidth,
        height: previewHeight,
        overflow: "hidden",
        background: theme.deskColor ?? "#E9ECEA",
        pointerEvents: "none",
        userSelect: "none",
      }}
      aria-hidden
    >
      <div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>
        <DocCanvas tree={tree} theme={theme} width={docWidth} />
      </div>
    </div>
  );
}

/** 에디터 전용 스타일 — 편집 가능 블록/텍스트의 호버·포커스 표시. 문서 트리 밖에서 한 번만 주입. */
export function DocEditorStyles(): ReactNode {
  return (
    <style>{`
      .rc-edit-text { border-radius: 3px; outline: none; }
      .rc-edit-text:hover { box-shadow: 0 0 0 1px rgba(93,135,255,0.55); }
      .rc-edit-text:focus { box-shadow: 0 0 0 2px rgba(93,135,255,0.85); background: rgba(93,135,255,0.06); }
      .rc-inline-block { outline: none; border-radius: 4px; }
      .rc-inline-block:hover { box-shadow: 0 0 0 1px rgba(93,135,255,0.45); }
      .rc-inline-block:focus { box-shadow: 0 0 0 2px rgba(93,135,255,0.85); background: rgba(93,135,255,0.05); }
      .rc-inline-block img { cursor: pointer; }
      .rc-img-selected { outline: 2px solid #5d87ff; outline-offset: 1px; }
      [data-rcid]:not(.rc-inline-block):hover { box-shadow: 0 0 0 1px rgba(93,135,255,0.4); border-radius: 6px; }
    `}</style>
  );
}
