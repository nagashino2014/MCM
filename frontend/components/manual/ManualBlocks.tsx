"use client";

// 매뉴얼·도움말 블록 렌더러 — content/manual/types.ts 의 ManualBlock 을 cdash 토큰으로 그린다.
// 인라인 표기: [[버튼 이름]] → 버튼 모양 글자, **강조** → 굵게.

import { Fragment, type ReactNode } from "react";
import { ArrowRight, Lightbulb, TriangleAlert } from "lucide-react";
import type { ManualBlock } from "@/content/manual";
import { getArticle } from "@/lib/manual/match";

/** [[ ]]·** ** 인라인 표기를 React 노드로. */
export function ManualInline({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const re = /\[\[(.+?)\]\]|\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(<Fragment key={i++}>{text.slice(last, m.index)}</Fragment>);
    if (m[1] !== undefined) {
      parts.push(
        <span
          key={i++}
          className="mx-px inline-flex items-center whitespace-nowrap rounded-[var(--mcm-action-radius,8px)] border cd-border-c px-1.5 text-[12px] font-medium leading-[20px] cd-text"
          style={{ background: "var(--cd-surface)" }}
        >
          {m[1]}
        </span>
      );
    } else {
      parts.push(<strong key={i++} className="font-semibold cd-text">{m[2]}</strong>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(<Fragment key={i++}>{text.slice(last)}</Fragment>);
  return <>{parts}</>;
}

export interface ManualBlocksProps {
  blocks: ManualBlock[];
  /** 다른 기사 링크를 눌렀을 때(드로어 안 이동). 없으면 /manual 링크로 동작. */
  onNavigate?: (article: string, section?: string) => void;
  /** 도움말 팝업처럼 좁은 곳 — 간격을 줄인다. */
  compact?: boolean;
}

export function ManualBlocks({ blocks, onNavigate, compact }: ManualBlocksProps) {
  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      {blocks.map((block, idx) => (
        <ManualBlockView key={idx} block={block} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

function ManualBlockView({ block, onNavigate }: { block: ManualBlock; onNavigate?: ManualBlocksProps["onNavigate"] }) {
  switch (block.kind) {
    case "p":
      return (
        <p className="text-[13px] leading-[calc(1.625em+3px)] cd-text">
          <ManualInline text={block.text} />
        </p>
      );
    case "steps":
      return (
        <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-[calc(1.625em+3px)] cd-text">
          {block.items.map((item, i) => (
            <li key={i}>
              <ManualInline text={item} />
            </li>
          ))}
        </ol>
      );
    case "list":
      return (
        <ul className="list-disc space-y-1 pl-5 text-[13px] leading-[calc(1.625em+3px)] cd-text">
          {block.items.map((item, i) => (
            <li key={i}>
              <ManualInline text={item} />
            </li>
          ))}
        </ul>
      );
    case "tip":
      return (
        <div className="flex gap-2 rounded-lg border cd-border-c px-3 py-2 text-[13px] leading-[calc(1.625em+3px)] cd-text" style={{ background: "var(--cd-surface)" }}>
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 cd-text-muted" aria-hidden="true" />
          <div>
            <span className="sr-only">팁: </span>
            <ManualInline text={block.text} />
          </div>
        </div>
      );
    case "warn":
      return (
        <div className="flex gap-2 rounded-lg border cd-border-c cd-warn-bg px-3 py-2 text-[13px] leading-[calc(1.625em+3px)] cd-text">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 cd-warn-text" aria-hidden="true" />
          <div>
            <span className="sr-only">주의: </span>
            <ManualInline text={block.text} />
          </div>
        </div>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-lg border cd-border-c">
          <table className="w-full border-collapse text-left text-[12px] leading-[calc(1.625em+3px)]">
            <thead style={{ background: "var(--cd-surface)" }}>
              <tr>
                {block.head.map((h, i) => (
                  <th key={i} scope="col" className="whitespace-nowrap border-b cd-border-c px-2.5 py-1.5 font-semibold cd-text">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className={r > 0 ? "border-t cd-border-c" : undefined}>
                  {row.map((cell, c) => (
                    <td key={c} className={`px-2.5 py-1.5 align-top cd-text${c === 0 && cell.length <= 14 ? " whitespace-nowrap" : ""}`}>
                      <ManualInline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "flow":
      return (
        <ul className="space-y-1.5 text-[13px] leading-[calc(1.625em+3px)]">
          {block.items.map((item, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-1.5 cd-text">
              <span className="font-medium">
                <ManualInline text={item.from} />
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 self-center cd-text-muted" aria-label="에 따라" />
              <span className="cd-text-muted">
                <ManualInline text={item.to} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "image":
      return (
        <figure className="space-y-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- public/ 정적 캡처, 크기는 파일 그대로 */}
          <img src={block.src} alt={block.alt} loading="lazy" className="block h-auto max-w-full rounded-lg border cd-border-c" />
          {block.caption && (
            <figcaption className="text-[12px] leading-[calc(1.625em+3px)] cd-text-muted">
              <ManualInline text={block.caption} />
            </figcaption>
          )}
        </figure>
      );
    case "link": {
      const target = getArticle(block.article);
      if (!target) return null;
      const label = block.label ?? target.title;
      const cls = "inline-flex items-center gap-1 text-[13px] font-medium text-[color:var(--cd-primary)] hover:underline";
      return onNavigate ? (
        <button type="button" className={cls} onClick={() => onNavigate(block.article, block.section)}>
          {label}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : (
        <a className={cls} href={`/manual/${encodeURIComponent(block.article)}${block.section ? `#${block.section}` : ""}`}>
          {label}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      );
    }
  }
}
