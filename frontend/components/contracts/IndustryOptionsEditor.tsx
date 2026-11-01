"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { CdModal } from "@/components/cdash/CdModal";
import { INTEGRATED_PERMIT_OPTION_SUFFIX } from "@/lib/ieps/integrated-permit-industries";
import { usePermitIndustries } from "@/lib/ieps/use-permit-industries";

/** 통합허가 대상 업종 옵션 접미 — 화관법·HAPs 등 다른 업종 옵션과 구분한다. */
export { INTEGRATED_PERMIT_OPTION_SUFFIX };

/**
 * 계약 업종 드롭다운 옵션 = 통합허가 대상 업종(관리자 설정 '통합허가 업종', permit_industries 사용 중) + '(통합허가)' 접미
 *   + 그 밖의 업종 옵션(contract_industry_options 중 '(통합허가)'가 아닌 것 — 화관법·HAPs 등, 이 편집기에서 관리).
 * 통합허가 업종은 여기서 추가·삭제하지 않는다(325, 2026-11-01).
 */
export function useContractIndustryOptions() {
  const { industries: permitIndustries, all: allPermitIndustries } = usePermitIndustries();
  const [extraOptions, setExtraOptions] = useState<string[]>([]);
  const permitOptions = useMemo(
    () => permitIndustries.map((item) => `${item.label}${INTEGRATED_PERMIT_OPTION_SUFFIX}`),
    [permitIndustries]
  );
  const industryOptions = useMemo(
    () => [...permitOptions, ...extraOptions.filter((option) => !permitOptions.includes(option))],
    [permitOptions, extraOptions]
  );
  /** 편집기가 넘긴 전체 목록에서 통합허가 외 옵션만 보관한다. */
  const setIndustryOptions = useCallback((options: string[]) => {
    setExtraOptions(options.filter((option) => !option.endsWith(INTEGRATED_PERMIT_OPTION_SUFFIX)));
  }, []);
  const loadIndustryOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/contracts/industry-options", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { extraOptions?: string[] };
      if (Array.isArray(json.extraOptions)) setExtraOptions(json.extraOptions);
    } catch {
      // DB 옵션을 아직 적용하지 않은 환경에서는 통합허가 업종만 보인다.
    }
  }, []);

  useEffect(() => {
    loadIndustryOptions();
  }, [loadIndustryOptions]);

  return { industryOptions, setIndustryOptions, loadIndustryOptions, permitIndustries: allPermitIndustries };
}

interface Props {
  options: string[];
  onOptionsChange: (options: string[]) => void;
}

export function IndustryOptionsEditorButton({ options, onOptionsChange }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [newOption, setNewOption] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch("/api/contracts/industry-options", { cache: "no-store" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error ?? "HTTP " + res.status);
    }
    const json = (await res.json()) as { extraOptions?: string[] };
    onOptionsChange(Array.isArray(json.extraOptions) ? json.extraOptions : []);
  }, [onOptionsChange]);

  const addOption = async () => {
    const optionName = newOption.trim();
    if (!optionName) return;
    setSaving(true);
    try {
      const res = await fetch("/api/contracts/industry-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optionName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      setNewOption("");
      await reload();
      toast.show("업종 옵션을 추가했습니다.", "success");
    } catch (err) {
      toast.show("업종 추가 실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const removeOption = async (optionName: string) => {
    if (!window.confirm(`'${optionName}' 업종 옵션을 삭제할까요? 이미 계약에 사용 중이면 삭제되지 않습니다.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/contracts/industry-options?optionName=${encodeURIComponent(optionName)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      await reload();
      toast.show("업종 옵션을 삭제했습니다.", "success");
    } catch (err) {
      toast.show("업종 삭제 실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-lg border cd-border-c cd-surface-bg px-3 py-2 text-xs font-semibold cd-text-muted hover:bg-[color:var(--cd-card)]"
      >
        업종 수정
      </button>
      <CdModal open={open} onClose={() => setOpen(false)} title="업종 옵션 수정" size="lg">
        <div className="flex flex-col gap-4">
          <p className="text-xs cd-text-faint -mt-1">
            신규/변경 계약 업종 드롭다운에 표시될 옵션입니다. &lsquo;(통합허가)&rsquo; 업종은{" "}
            <Link href="/admin/permit-industries" className="cd-text-primary font-semibold underline-offset-2 hover:underline">
              관리 › 통합허가 업종
            </Link>
            에서 관리합니다.
          </p>
          <div className="flex items-center gap-2">
            <input
              className="cd-input flex-1"
              placeholder="추가할 업종명(통합허가 외 — 예: 화관법)"
              value={newOption}
              onChange={(event) => setNewOption(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addOption();
                }
              }}
            />
            <button type="button" disabled={saving} onClick={addOption} className="cd-btn cd-btn-primary rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50">
              추가
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto rounded-lg border cd-border-c cd-surface-bg">
            {options.map((option) => {
              const permit = option.endsWith(INTEGRATED_PERMIT_OPTION_SUFFIX);
              return (
                <div key={option} className="flex items-center justify-between gap-3 border-b cd-border-c px-3 py-2 last:border-b-0">
                  <span className="text-sm font-semibold cd-text-muted">{option}</span>
                  {permit ? (
                    <span className="text-[11px] cd-text-faint">통합허가 업종에서 관리</span>
                  ) : (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => removeOption(option)}
                      className="rounded-lg px-2 py-1 text-xs font-semibold cd-error-text hover:bg-[color:var(--cd-error-soft)] disabled:opacity-50"
                    >
                      삭제
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </CdModal>
    </>
  );
}
