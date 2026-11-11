"use client";

// 양식별 고정 결재선(335) — 기안 화면 공용. 결재선 카드 안에서 편집 행 대신 잠긴 결재선을 보여 준다.
// 일반 기안·견적서·공문·내부고시·계약서 다섯 화면이 같이 쓴다. 서버도 같은 규칙으로 저장·상신을 강제한다.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { LINE_STEP_ROLE_LABELS, type FixedLineResult, type FixedLineStep } from "@/lib/approval/fixed-line-rules";

export interface FixedLineEditorStep {
  stepType: "agree" | "approve";
  assigneeUserId: string;
  assigneeName: string;
  assigneePosition: string | null;
}

/**
 * 기안자 기준 고정 결재선 해석 — 양식이 바뀌거나 강제 조건 필드(계약서·견적서 doc_stage) 값이 바뀌면 다시 묻는다.
 * result=null 은 아직 모름(조회 중) — 이때는 종전 결재선 UI 를 그대로 둔다.
 */
export function useFixedLine(formId: string | null | undefined, values: Record<string, unknown>): {
  result: FixedLineResult | null;
  locked: boolean;
} {
  const [result, setResult] = useState<FixedLineResult | null>(null);
  const [field, setField] = useState<string | null>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const fieldValue = field ? String(values[field] ?? "") : "";

  useEffect(() => {
    if (!formId) {
      setResult(null);
      return;
    }
    let cancelled = false;
    fetch("/api/approval/fixed-line", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formId, fieldValues: valuesRef.current }),
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: FixedLineResult | null) => {
        if (cancelled || !d) return;
        setResult(d);
        if (d.enforced) setField(d.enforceField);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [formId, fieldValue]);

  return { result, locked: result?.enforced === true };
}

/** 해석 결과 → 결재선 상태(저장 요청에 그대로 실린다). 해석 실패면 빈 결재선. */
export function fixedLineToSteps(result: FixedLineResult | null): FixedLineEditorStep[] {
  if (!result?.enforced || !result.ok) return [];
  return result.steps.map((s) => ({ stepType: "approve", assigneeUserId: s.userId, assigneeName: s.name, assigneePosition: s.position }));
}

/** 상신 전 확인 — 잠긴 결재선을 풀지 못했으면 이유(없으면 null). */
export function fixedLineBlockMessage(result: FixedLineResult | null): string | null {
  if (!result?.enforced || result.ok) return null;
  return `결재선을 정할 수 없어 상신할 수 없습니다.\n\n${result.errors.join("\n")}`;
}

export function FixedLineList({
  result,
  renderBadge,
}: {
  result: FixedLineResult & { enforced: true };
  /** 결재자 행 아래 추가 표기(부재 배지 등) */
  renderBadge?: (step: FixedLineStep, index: number, isFinal: boolean) => ReactNode;
}) {
  const steps = result.steps;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] cd-text-faint flex items-center gap-1">
        <Lock className="w-3 h-3 shrink-0" /> 이 양식은 결재선이 정해져 있어 바꿀 수 없습니다.
      </p>
      {steps.map((s, i) => (
        <div key={`${s.userId}-${i}`} className="rounded-lg border cd-border-c px-3 py-2 flex items-center gap-2">
          <span className="text-[11px] font-mono cd-text-faint w-4">{i + 1}</span>
          <span className="cd-pill cd-pill-outline shrink-0">{LINE_STEP_ROLE_LABELS[s.role]}</span>
          <span className="text-[13px] cd-text truncate flex-1">
            {s.name}
            {s.position ? <span className="cd-text-faint text-[11px]"> {s.position}</span> : null}
            {s.proxies.length > 0 && (
              <span className="block text-[11px] cd-text-faint whitespace-normal">
                부재 시 대결 {s.proxies.map((p) => p.name).join(", ")}
              </span>
            )}
            {renderBadge?.(s, i, i === steps.length - 1)}
          </span>
        </div>
      ))}
      {!result.ok && (
        <div className="rounded-lg border px-3 py-2 text-[12px] whitespace-normal cd-error-text" style={{ borderColor: "var(--cd-error)" }}>
          {result.errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
    </div>
  );
}
