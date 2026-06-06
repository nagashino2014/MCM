"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export const DEFAULT_CONTRACT_INDUSTRY_OPTIONS = [
  "발전",
  "폐기물소각",
  "철강",
  "비철",
  "유기",
  "석유정제",
  "무기화학",
  "정밀화학",
  "비료및질소화합물",
  "펄프종이및판지",
  "전자부품",
  "반도체",
  "섬유염색및가공처리업",
  "도축육류가공및저장처리업",
  "알콜음료제조업",
  "플라스틱제품제조업",
  "자동차부품제조업",
  "폐기물처리업",
  "시멘트 제조업",
  "이차전지 제조업",
];

export function useContractIndustryOptions() {
  const [industryOptions, setIndustryOptions] = useState(DEFAULT_CONTRACT_INDUSTRY_OPTIONS);
  const loadIndustryOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/contracts/industry-options", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { options?: string[] };
      if (Array.isArray(json.options) && json.options.length > 0) {
        setIndustryOptions(json.options);
      }
    } catch {
      // DB 옵션을 아직 적용하지 않은 환경에서는 기본 옵션을 유지한다.
    }
  }, []);

  useEffect(() => {
    loadIndustryOptions();
  }, [loadIndustryOptions]);

  return { industryOptions, setIndustryOptions, loadIndustryOptions };
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
    const json = (await res.json()) as { options?: string[] };
    onOptionsChange(Array.isArray(json.options) && json.options.length ? json.options : DEFAULT_CONTRACT_INDUSTRY_OPTIONS);
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
        className="shrink-0 rounded-xl border border-stone-200 bg-white/80 px-3 py-2 text-xs font-bold text-stone-700 hover:bg-white"
      >
        업종 수정
      </button>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 p-4" onMouseDown={() => setOpen(false)}>
          <div className="glass-panel rounded-3xl p-5 w-full max-w-lg" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="text-lg font-bold text-stone-800">업종 옵션 수정</h3>
                <p className="text-xs text-stone-500 mt-1">신규/변경 계약 업종 드롭다운에 표시될 옵션입니다.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="glass-button rounded-full p-2">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-2 mb-4">
              <input
                className="ui-input flex-1"
                placeholder="추가할 업종명"
                value={newOption}
                onChange={(event) => setNewOption(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addOption();
                  }
                }}
              />
              <button type="button" disabled={saving} onClick={addOption} className="btn-primary rounded-xl px-4 py-2 text-sm">
                추가
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto rounded-2xl border border-stone-200 bg-white/70">
              {options.map((option) => (
                <div key={option} className="flex items-center justify-between gap-3 border-b border-stone-100 px-3 py-2 last:border-b-0">
                  <span className="text-sm font-semibold text-stone-700">{option}</span>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => removeOption(option)}
                    className="rounded-lg px-2 py-1 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    삭제
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
