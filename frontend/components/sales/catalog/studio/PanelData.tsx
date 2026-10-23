"use client";

// 오른쪽 패널 · 데이터 탭 — 고른 요소에 묶인 지표(바인딩)와 원천 화면 바로가기, 바인딩 해제·되돌리기.
// 숫자는 지표 사전에서만 온다(블루프린트 §6-5). 바인딩을 풀면 그 숫자만 지금 값으로 고정되어 자동 갱신에서 빠진다.

import Link from "next/link";
import { ExternalLink, Link2Off, RotateCcw } from "lucide-react";
import { CdHelp } from "@/components/cdash/CdHelp";
import type { MetricId } from "@/lib/catalog/metrics";
import { unbindChip } from "@/lib/catalog/studio/inline";
import { findPath, type CNode } from "@/lib/catalog/studio/nodes";
import { resolveBind } from "@/lib/catalog/studio/render-tree";
import { isTextBlock, WIDGET_SOURCE } from "@/lib/catalog/studio/select";
import type { PanelProps } from "./types";

interface BindRow {
  node: CNode;
  /** 이 칩을 품은 글 블록 */
  block: CNode | null;
  label: string;
  value: string;
  footnote: string;
}

export function PanelData({ studio, composed, sel, ops }: PanelProps) {
  const data = studio.data;
  if (!data) return null;
  const tree = composed.tree;
  const root = sel?.node ?? tree;
  const rows: BindRow[] = [];
  const walk = (n: CNode) => {
    if (n.bind) {
      const path = findPath(tree, n.id) ?? [];
      let block: CNode | null = null;
      for (let i = path.length - 1; i >= 1; i--) if (isTextBlock(path[i], path[i - 1])) block = path[i];
      const metric = n.bind.startsWith("metric:") ? data.metrics[n.bind.slice(7) as MetricId] : null;
      rows.push({
        node: n,
        block,
        label: metric?.label ?? n.bind.replace(/^data:/, "데이터 · "),
        value: resolveBind(n.bind, data, n.bindDigits) ?? "-",
        footnote: metric?.footnote ?? "",
      });
      return;
    }
    n.children?.forEach(walk);
  };
  walk(root);
  const source = sel?.node.widget ? WIDGET_SOURCE[sel.node.widget] : null;
  const orphans = composed.orphans.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs cd-text-muted flex items-center gap-1">
        기준일 {data.asOf} · 열 때마다 MCM 데이터를 새로 읽습니다 <CdHelp topic="catalog.studio-data" />
      </div>

      {source ? (
        <section className="rounded-lg border cd-border-c p-2 text-xs flex flex-col gap-1">
          <span className="cd-text">{source.what}은(는) 데이터에서 자동으로 채웁니다.</span>
          <Link href={source.href} className="cd-action cd-btn cd-btn-ghost cd-btn-sm self-start" target="_blank" rel="noreferrer">
            <ExternalLink className="w-3.5 h-3.5" /> {source.label} 열기
          </Link>
        </section>
      ) : null}

      {sel?.node.pinned && sel.node.origin === "base" ? (
        <section className="rounded-lg border cd-border-c p-2 text-xs flex flex-col gap-1">
          <span className="cd-text">고친 글이라 자동 갱신에서 빠져 있습니다. 안의 지표 칩은 계속 최신 값입니다.</span>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm self-start" onClick={() => ops.reset(sel.id, ["content"])}>
            <RotateCcw className="w-3.5 h-3.5" /> 자동 값으로 되돌리기
          </button>
        </section>
      ) : null}

      <section className="flex flex-col gap-1.5">
        <h3 className="text-sm font-semibold cd-text">{sel ? "고른 요소의 지표" : "이 쪽의 지표"} {rows.length}</h3>
        {rows.length === 0 ? <p className="text-xs cd-text-faint">묶인 지표가 없습니다.</p> : null}
        <ul className="flex flex-col gap-1.5">
          {rows.map((r) => {
            const pinnedChip = r.node.origin === "pin";
            return (
              <li key={r.node.id} className="rounded-lg border cd-border-c p-2 text-xs flex flex-col gap-1">
                <span className="flex items-center gap-1">
                  <b className="cd-text">{r.label}</b>
                  <span className="ml-auto tabular-nums cd-text">{r.value}</span>
                </span>
                {r.footnote ? <span className="cd-text-faint">{r.footnote}</span> : null}
                {r.block ? (
                  <button
                    type="button"
                    className="cd-btn cd-btn-ghost cd-btn-sm self-start"
                    onClick={() => {
                      const block = r.block!;
                      ops.commitText(block.id, unbindChip(block.children ?? [], r.node.id, r.value));
                    }}
                  >
                    <Link2Off className="w-3.5 h-3.5" /> {pinnedChip ? "고정 값으로 바꾸기" : "이 값 고정(바인딩 해제)"}
                  </button>
                ) : (
                  <span className="cd-text-faint">데이터 영역 안 지표 — 원천 화면에서 바뀝니다.</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {orphans ? (
        <section className="rounded-lg border cd-border-c p-2 text-xs flex flex-col gap-1">
          <span className="cd-text">데이터 구조가 바뀌어 붙을 곳을 잃은 편집 {orphans}건이 있습니다(지금 쪽에는 보이지 않음).</span>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm self-start" onClick={ops.dropOrphans}>
            정리하기
          </button>
        </section>
      ) : null}

      {data.notices.length ? (
        <section className="flex flex-col gap-1">
          <h3 className="text-xs font-semibold cd-text-muted">확인할 내용 {data.notices.length}</h3>
          <ul className="list-disc pl-4 text-xs cd-text-muted flex flex-col gap-0.5">
            {data.notices.slice(0, 12).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
