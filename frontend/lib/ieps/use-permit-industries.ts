"use client";

// 통합허가 대상 업종 — 화면 공용 훅. /api/permit-industries 를 페이지당 한 번 읽어 모듈 캐시에 둔다.
// 첫 렌더는 기본값(DEFAULT_PERMIT_INDUSTRIES)으로 그리고, 응답이 오면 관리 화면에서 고친 목록으로 바뀐다.
// 관리 화면(/admin/permit-industries)이 저장 후 refreshPermitIndustries() 로 같은 탭의 다른 화면도 갱신한다.
import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_PERMIT_INDUSTRIES,
  activePermitIndustries,
  setPermitIndustriesSnapshot,
  type IntegratedPermitIndustry,
} from "@/lib/ieps/integrated-permit-industries";

let loaded: IntegratedPermitIndustry[] | null = null;
let inflight: Promise<IntegratedPermitIndustry[]> | null = null;
const listeners = new Set<(list: IntegratedPermitIndustry[]) => void>();

function fetchPermitIndustries(): Promise<IntegratedPermitIndustry[]> {
  if (!inflight) {
    inflight = fetch("/api/permit-industries", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = (await res.json()) as { industries?: IntegratedPermitIndustry[] };
        return Array.isArray(json.industries) && json.industries.length ? json.industries : DEFAULT_PERMIT_INDUSTRIES;
      })
      .catch(() => loaded ?? DEFAULT_PERMIT_INDUSTRIES)
      .then((list) => {
        loaded = list;
        setPermitIndustriesSnapshot(list);
        listeners.forEach((fn) => fn(list));
        return list;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** 저장 후 다시 읽기 — 같은 탭의 모든 usePermitIndustries 가 갱신된다. */
export function refreshPermitIndustries(): Promise<IntegratedPermitIndustry[]> {
  loaded = null;
  return fetchPermitIndustries();
}

/**
 * industries = 사용 중 업종(선택 목록·칩·KSIC 분류용), all = 사용 중지 포함(저장된 id·이름의 이름표용).
 */
export function usePermitIndustries(): {
  industries: IntegratedPermitIndustry[];
  all: IntegratedPermitIndustry[];
  loaded: boolean;
} {
  const [all, setAll] = useState<IntegratedPermitIndustry[]>(loaded ?? DEFAULT_PERMIT_INDUSTRIES);
  const [isLoaded, setIsLoaded] = useState(loaded !== null);
  useEffect(() => {
    const onChange = (list: IntegratedPermitIndustry[]) => {
      setAll(list);
      setIsLoaded(true);
    };
    listeners.add(onChange);
    if (loaded) onChange(loaded);
    else void fetchPermitIndustries();
    return () => {
      listeners.delete(onChange);
    };
  }, []);
  const industries = useMemo(() => activePermitIndustries(all), [all]);
  return { industries, all, loaded: isLoaded };
}
