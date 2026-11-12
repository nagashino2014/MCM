"use client";

// 계약서·견적서 초안/최종안 단계(336, 2026-11-03) — 작성 화면 결재선 카드 위의 단계 전환과
// 송부·상신으로 잠긴 버전의 안내 띠. 단계 규칙은 lib/approval/doc-stage.ts 가 단일 원천이다.

import { CopyPlus, Lock, Stamp } from "lucide-react";
import { CdHelp } from "@/components/cdash/CdHelp";
import { CdTabs } from "@/components/cdash/CdTabs";
import { DOC_STAGE_LABEL, type DocStage } from "@/lib/approval/doc-stage";

export function DocStageSwitch({
  stage,
  onChange,
  disabled,
}: {
  stage: DocStage;
  onChange: (next: DocStage) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <span className="cd-label-text">문서 단계</span>
        <CdHelp topic="doc.stage" />
      </div>
      <CdTabs<DocStage>
        items={[
          { key: "draft", label: DOC_STAGE_LABEL.draft, disabled: disabled && stage !== "draft" },
          { key: "final", label: DOC_STAGE_LABEL.final, disabled: disabled && stage !== "final" },
        ]}
        active={stage}
        onChange={onChange}
      />
      <p className="cd-hint">
        {stage === "draft"
          ? "결재 없이 발주처에 송부합니다. 송부한 버전은 잠기고, 고칠 때는 새 버전을 만듭니다."
          : "결재선(부서장 → 임원 → 대표이사)으로 상신하고, 승인 후 발송합니다."}
      </p>
    </div>
  );
}

/** 잠긴 버전(송부한 초안·결재 중·승인) 안내 — 고치려면 새 버전을 만든다 */
export function LockedVersionNotice({
  reason,
  onNewVersion,
  onFinalize,
}: {
  reason: string;
  onNewVersion: () => void;
  /** 최종안으로 확정 — 같은 내용을 새 버전(최종안)으로 복사해 상신 화면을 연다 */
  onFinalize?: () => void;
}) {
  return (
    <div className="rounded-lg border cd-border-c cd-tint-primary px-4 py-3 flex items-center gap-3 flex-wrap">
      <Lock className="w-4 h-4 cd-text-primary shrink-0" aria-hidden="true" />
      <span className="text-[13px] cd-text flex-1 min-w-[240px]">{reason}</span>
      <button type="button" className="cd-btn rounded-lg border cd-border-c px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5" onClick={onNewVersion}>
        <CopyPlus className="w-3.5 h-3.5" /> 새 버전 만들기
      </button>
      {onFinalize && (
        <button type="button" className="cd-btn cd-btn-primary rounded-lg px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5" onClick={onFinalize}>
          <Stamp className="w-3.5 h-3.5" /> 최종안으로 확정
        </button>
      )}
    </div>
  );
}
