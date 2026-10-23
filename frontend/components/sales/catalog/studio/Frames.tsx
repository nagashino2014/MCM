"use client";

// 스튜디오 지면 틀 — 문서 CSS 를 앱과 섞지 않으려고 iframe 안에 그린다.
//   PortalFrame: 캔버스용. React 포털로 iframe 문서에 그려 선택·글 고치기·끌기를 한다(같은 출처 srcdoc).
//   StaticFrame: 썸네일·후보 미리보기용. 정적 HTML 을 srcdoc 으로 싣고 축소해 보인다(조작 없음).

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { fontCssFor, frameDocument, type StudioKit } from "./kit";

export function PortalFrame({
  kit,
  fontSet,
  extraCss,
  title,
  style,
  className,
  onReady,
  children,
}: {
  kit: StudioKit;
  fontSet: string;
  extraCss?: string;
  title: string;
  style?: CSSProperties;
  className?: string;
  onReady?: (doc: Document, win: Window) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  // 틀 문서는 키트가 바뀔 때만 다시 만든다(서체·추가 CSS 는 아래 효과가 갈아 끼운다)
  const srcDoc = useMemo(() => frameDocument(kit, "pretendard", { script: "check" }), [kit]);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;

  const onLoad = () => {
    const doc = ref.current?.contentDocument;
    const win = ref.current?.contentWindow;
    if (!doc || !win) return;
    setMount(doc.getElementById("st-root"));
    readyRef.current?.(doc, win);
  };

  useEffect(() => {
    const doc = ref.current?.contentDocument;
    const el = doc?.getElementById("st-font");
    if (el) el.textContent = fontCssFor(fontSet);
  }, [fontSet, mount]);
  useEffect(() => {
    const doc = ref.current?.contentDocument;
    const el = doc?.getElementById("st-extra");
    if (el) el.textContent = extraCss ?? "";
  }, [extraCss, mount]);

  return (
    <>
      {/* 문서 지면은 라이트 고정 — iframe 의 color-scheme 을 문서와 같게 둬야 다크 화면에서 틀 바탕이 흰 판으로 덮이지 않는다 */}
      <iframe ref={ref} srcDoc={srcDoc} title={title} onLoad={onLoad} className={className} style={{ border: 0, display: "block", colorScheme: "light", ...style }} />
      {mount ? createPortal(children, mount) : null}
    </>
  );
}

/** 화면에 보일 때만 그린다(썸네일이 많아도 가볍게) */
function useInView<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setSeen(true), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

/** 정적 HTML 축소 미리보기 — width·height(px) 상자에 원래 크기(srcW×srcH, pt)를 줄여 넣는다 */
export function StaticFrame({
  kit,
  fontSet,
  html,
  width,
  srcW = 842,
  srcH = 595,
  title,
  extraCss,
  onMeasure,
}: {
  kit: StudioKit;
  fontSet: string;
  html: string;
  width: number;
  srcW?: number;
  srcH?: number;
  title: string;
  extraCss?: string;
  /** 불러온 뒤 내용 높이(pt) — 자리 넘침 판정용 */
  onMeasure?: (contentHeight: number) => void;
}) {
  const [wrapRef, seen] = useInView<HTMLDivElement>();
  const scale = width / srcW;
  const height = Math.round(srcH * scale);
  // 같은 HTML 이면 다시 싣지 않는다(잦은 편집에도 깜박임 최소화 — 0.3초 늦춰 묶음)
  const [shown, setShown] = useState(html);
  useEffect(() => {
    const t = setTimeout(() => setShown(html), 300);
    return () => clearTimeout(t);
  }, [html]);
  const srcDoc = useMemo(
    () =>
      frameDocument(kit, fontSet, {
        body: `<div class="st-thumb" style="width:${srcW}px;transform:scale(${scale});transform-origin:0 0">${shown}</div>`,
        extraCss: `.pk-sheet{box-shadow:none}${extraCss ?? ""}`,
      }),
    [kit, fontSet, shown, scale, srcW, extraCss]
  );
  const measure = useRef(onMeasure);
  measure.current = onMeasure;
  return (
    <div ref={wrapRef} style={{ width, height, overflow: "hidden", position: "relative" }} aria-hidden="true">
      {seen ? (
        <iframe
          srcDoc={srcDoc}
          title={title}
          tabIndex={-1}
          loading="lazy"
          sandbox="allow-same-origin"
          style={{ border: 0, width, height, display: "block", pointerEvents: "none", colorScheme: "light" }}
          onLoad={(e) => {
            const doc = (e.target as HTMLIFrameElement).contentDocument;
            const inner = doc?.querySelector(".st-thumb > *") as HTMLElement | null;
            if (inner && measure.current) {
              const wait = doc?.fonts?.ready ?? Promise.resolve();
              wait.then(() => measure.current?.(inner.scrollHeight));
            }
          }}
        />
      ) : null}
    </div>
  );
}
