"use client";

import { memo, useCallback } from "react";
import { ChevronDown, ChevronRight, Folder, FolderClosed, FolderOpen } from "lucide-react";
import type { ServiceTypeStyle } from "@/lib/ieps/contract-tree-style";
import { formatMoney } from "@/lib/contracts/format-money";

/**
 * 계약 원장 트리 행 — 매출 계약 관리(app/(app)/contracts/page.tsx)에 있던 TreeGroupHeader/TreeChildRow 를
 * 매입 계약 원장(331)과 공유하려고 옮겼다. 모양은 그대로이고, 노드 타입에 묶이지 않도록 자식 행은
 * 표시에 필요한 값만 평탄한 prop 으로 받는다. 부모·자식 아이콘 색은 호출 쪽이 style 로 준다.
 */
export type TreeFlatRow<N> =
  | {
      kind: "group";
      groupKey: string;
      label: string;
      count: number;
      isOpen: boolean;
      style: ServiceTypeStyle;
    }
  | {
      kind: "child";
      contract: N;
      isLastChild: boolean;
      style: ServiceTypeStyle;
    };

export interface TreeGroupHeaderProps {
  groupKey: string;
  label: string;
  count: number;
  isOpen: boolean;
  style: ServiceTypeStyle;
  onToggle: (groupKey: string) => void;
}

export const TreeGroupHeader = memo(function TreeGroupHeader({
  groupKey,
  label,
  count,
  isOpen,
  style,
  onToggle,
}: TreeGroupHeaderProps) {
  // Switch the parent folder icon between closed and open variants so that
  // expanding a group is reinforced visually beyond the chevron rotation.
  const ParentIcon = isOpen ? FolderOpen : Folder;
  const handleClick = useCallback(() => onToggle(groupKey), [onToggle, groupKey]);
  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-[color:var(--cd-surface)] border-b cd-border-c"
    >
      {isOpen ? (
        <ChevronDown className="w-4 h-4 cd-text-faint" />
      ) : (
        <ChevronRight className="w-4 h-4 cd-text-faint" />
      )}
      <ParentIcon
        className="w-4 h-4 fill-current transition-transform"
        style={{ color: style.parentColor }}
      />
      <span className="text-sm cd-text">{label}</span>
      <span className="text-[11px] cd-text-faint ml-auto">{count}건</span>
    </button>
  );
});

export interface TreeChildRowProps {
  nodeId: string;
  title: string;
  contractDate: string | null;
  currentAmount: number | null;
  contractStatus: string;
  /** 매출=수금 완료, 매입=지급 완료 점. */
  isFullyCollected: boolean;
  fullyCollectedLabel?: string;
  isSelected: boolean;
  isLastChild: boolean;
  childColor: string;
  onSelect: (nodeId: string) => void;
}

export const TreeChildRow = memo(function TreeChildRow({
  nodeId,
  title,
  contractDate,
  currentAmount,
  contractStatus,
  isFullyCollected,
  fullyCollectedLabel = "수금 완료",
  isSelected,
  isLastChild,
  childColor,
  onSelect,
}: TreeChildRowProps) {
  const handleClick = useCallback(() => onSelect(nodeId), [onSelect, nodeId]);
  // Selected child rows show an "open folder" icon to mirror the active-state
  // metaphor used by the parent group header.
  const ChildIcon = isSelected ? FolderOpen : FolderClosed;
  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        "relative w-full flex items-center gap-2 pl-12 pr-3 py-2 text-left text-xs hover:bg-[color:var(--cd-surface)] " +
        (isSelected ? "cd-tint-primary border-l-4 border-[color:var(--cd-primary)]" : "border-l-4 border-transparent")
      }
    >
      <span
        aria-hidden
        className={
          "pointer-events-none absolute left-7 w-px bg-[var(--cd-border)] " +
          (isLastChild ? "top-0 h-1/2" : "top-0 bottom-0")
        }
      />
      <span
        aria-hidden
        className="pointer-events-none absolute left-7 top-1/2 w-3 h-px bg-[var(--cd-border)]"
      />
      <ChildIcon
        className="w-3.5 h-3.5 fill-current shrink-0"
        style={{ color: childColor }}
      />
      <span className="flex items-center gap-1.5 flex-1 min-w-0">
        <span className="truncate cd-text">{title}</span>
        {contractStatus === "terminated" && (
          <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] text-white" style={{ background: "#FF7171" }}>
            계약해지
          </span>
        )}
        {contractStatus === "suspended" && (
          <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[11px] cd-text" style={{ background: "#FFD966" }}>
            계약중지
          </span>
        )}
        {isFullyCollected && (
          <span
            aria-label={fullyCollectedLabel}
            title={fullyCollectedLabel}
            className="shrink-0 w-1.5 h-1.5 rounded-full"
            style={{ background: childColor }}
          />
        )}
      </span>
      <span className="w-[88px] text-right text-[11px] font-mono cd-text-faint ml-2 shrink-0 tabular-nums">
        {contractDate ?? "-"}
      </span>
      <span className="w-[72px] text-right text-[11px] font-mono cd-text-faint ml-1 shrink-0 tabular-nums">
        {formatMoney(currentAmount)}
      </span>
    </button>
  );
});
