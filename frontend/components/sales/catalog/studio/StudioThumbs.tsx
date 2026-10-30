"use client";

// 스튜디오 왼쪽 — 쪽 썸네일 목록(섹션 묶음). 누르면 그 쪽을 연다. 순서는 끌어 놓기 또는 위·아래 단추, 숨김은 눈 단추(L2).
// 키보드: 목록은 Tab 한 번(지금 쪽)으로 들어오고 위·아래 방향키로 쪽을 옮겨 다닌다. 순서·숨김 단추는 지금 쪽에만 보인다.

import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArrowDown, ArrowUp, Eye, EyeOff, Pencil, TriangleAlert } from "lucide-react";
import { RESEARCH_SECTIONS, SECTIONS } from "@/lib/catalog/render/master-content";
import { isEmptyEdits } from "@/lib/catalog/studio/edits";
import { pageState } from "@/lib/catalog/studio/doc";
import type { CNode } from "@/lib/catalog/studio/nodes";
import { renderNode, type TreeEnv } from "@/lib/catalog/studio/render-tree";
import { StaticFrame } from "./Frames";
import type { StudioKit } from "./kit";
import type { Studio } from "./useStudio";

const htmlCache = new WeakMap<CNode, string>();
export function staticHtml(tree: CNode, env: TreeEnv): string {
  let html = htmlCache.get(tree);
  if (html == null) {
    html = renderToStaticMarkup(renderNode(tree, env) as ReactElement);
    htmlCache.set(tree, html);
  }
  return html;
}

const sectionName = (key: string) => {
  if (!key) return "";
  const s = SECTIONS.find((x) => x.key === key);
  if (s) return `${s.key === "부록" ? "부록" : s.key} ${s.name}`;
  // 연구소·ESG 제안형(research) 섹션 R1…R8 — 쪽 머리 번호(01~08)로
  const r = RESEARCH_SECTIONS.find((x) => x.key === key);
  return r ? `${r.num} ${r.name}` : key;
};

export function StudioThumbs({
  studio,
  kit,
  currentKey,
  onPick,
  warnByKey,
  compact,
}: {
  studio: Studio;
  kit: StudioKit;
  currentKey: string;
  onPick: (key: string) => void;
  /** 쪽 키 → 경고 수(캔버스 검사·전체 검사) */
  warnByKey: Record<string, number>;
  compact: boolean;
}) {
  const { plan, state, env } = studio;
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const keys = useMemo(() => plan.map((p) => p.key), [plan]);
  const listRef = useRef<HTMLOListElement>(null);
  const onListKey = (e: KeyboardEvent<HTMLButtonElement>, key: string) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const i = keys.indexOf(key);
    const j = e.key === "Home" ? 0 : e.key === "End" ? keys.length - 1 : Math.max(0, Math.min(keys.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
    onPick(keys[j]);
    requestAnimationFrame(() => (listRef.current?.querySelector(`[data-page-key="${keys[j]}"]`) as HTMLButtonElement | null)?.focus());
  };
  if (!state || !env) return null;

  let visibleNo = 0;
  let lastSection: string | null = null;

  const move = (key: string, dir: -1 | 1) => {
    const i = keys.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= keys.length) return;
    const next = [...keys];
    [next[i], next[j]] = [next[j], next[i]];
    studio.reorder(next);
  };

  const onDrop = (e: DragEvent, target: string) => {
    e.preventDefault();
    const from = dragKey;
    setDragKey(null);
    setOverKey(null);
    if (!from || from === target) return;
    const next = keys.filter((k) => k !== from);
    next.splice(next.indexOf(target), 0, from);
    studio.reorder(next);
  };

  return (
    <ol ref={listRef} className="flex flex-col gap-1.5" aria-label="쪽 목록">
      {plan.map((item, i) => {
        const st = pageState(state.pages, item.key);
        const hidden = st.hidden;
        if (!hidden) visibleNo += 1;
        const head = item.section !== lastSection && item.section ? sectionName(item.section) : null;
        lastSection = item.section;
        const current = item.key === currentKey;
        const warn = warnByKey[item.key] ?? 0;
        const tree = hidden ? null : studio.composedOf(item).tree;
        return (
          <li key={item.key} onDragOver={(e) => (e.preventDefault(), setOverKey(item.key))} onDrop={(e) => onDrop(e, item.key)}>
            {head ? <p className="text-[11px] font-semibold cd-text-faint px-1 pt-1.5 pb-0.5">{head}</p> : null}
            <div
              className="rounded-lg border p-1.5"
              style={{
                borderColor: current ? "var(--cd-primary)" : overKey === item.key && dragKey ? "var(--cd-primary)" : "var(--cd-border)",
                background: current ? "color-mix(in srgb, var(--cd-primary) 7%, var(--cd-card-solid))" : "var(--cd-card-solid)",
                opacity: hidden ? 0.6 : 1,
              }}
              draggable
              onDragStart={() => setDragKey(item.key)}
              onDragEnd={() => (setDragKey(null), setOverKey(null))}
            >
              <button
                type="button"
                className="cd-action w-full text-left flex flex-col gap-1"
                aria-current={current ? "page" : undefined}
                aria-label={`${hidden ? "숨긴 쪽" : `${visibleNo}쪽`} ${item.label}`}
                data-page-key={item.key}
                tabIndex={current ? 0 : -1}
                onKeyDown={(e) => onListKey(e, item.key)}
                onClick={() => onPick(item.key)}
              >
                {!compact && tree ? <StaticFrame kit={kit} fontSet={studio.fontSet} html={staticHtml(tree, env)} width={150} title={`${item.label} 썸네일`} /> : null}
                <span className="flex items-center gap-1 text-xs min-w-0">
                  <span className="tabular-nums cd-text-faint shrink-0">{hidden ? "—" : String(visibleNo).padStart(2, "0")}</span>
                  <span className="cd-text truncate">{item.label}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {hidden ? <span className="cd-pill cd-pill-idle">숨김</span> : null}
                  {item.flow ? <span className="cd-pill cd-pill-idle">자동 분쪽</span> : null}
                  {!isEmptyEdits(st.edits) ? (
                    <span className="cd-pill cd-pill-idle inline-flex items-center gap-0.5">
                      <Pencil className="w-3 h-3" aria-hidden /> 편집
                    </span>
                  ) : null}
                  {warn > 0 ? (
                    <span className="cd-pill cd-pill-error inline-flex items-center gap-0.5">
                      <TriangleAlert className="w-3 h-3" aria-hidden /> {warn}
                    </span>
                  ) : null}
                </span>
              </button>
              {current ? (
                <div className="flex items-center gap-0.5 mt-1">
                  <button type="button" className="cd-icon-button cd-icon-button-sm" aria-label={`${item.label} 위로 옮기기`} disabled={i === 0} onClick={() => move(item.key, -1)}>
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    className="cd-icon-button cd-icon-button-sm"
                    aria-label={`${item.label} 아래로 옮기기`}
                    disabled={i === plan.length - 1}
                    onClick={() => move(item.key, 1)}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    className="cd-icon-button cd-icon-button-sm ml-auto"
                    aria-label={hidden ? `${item.label} 쪽 보이기` : `${item.label} 쪽 숨기기`}
                    aria-pressed={hidden}
                    onClick={() => studio.setPageHidden(item.key, !hidden)}
                  >
                    {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              ) : hidden ? (
                <div className="flex items-center mt-1">
                  <button
                    type="button"
                    className="cd-icon-button cd-icon-button-sm ml-auto"
                    aria-label={`${item.label} 쪽 보이기`}
                    aria-pressed={hidden}
                    tabIndex={-1}
                    onClick={() => studio.setPageHidden(item.key, false)}
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
