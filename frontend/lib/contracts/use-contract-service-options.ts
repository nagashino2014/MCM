"use client";

// 계약 용역 대분류·세분류 — 화면 공용 훅. /api/contract-service-categories 를 페이지당 한 번 읽어 모듈 캐시에 둔다.
// 첫 렌더는 기본값(DEFAULT_CONTRACT_SERVICE_TYPES)으로 그리고, 응답이 오면 관리 화면에서 고친 목록으로 바뀐다.
// 관리 화면(/admin/contract-service-categories)이 저장 후 refreshContractServiceOptions() 로 같은 탭의 다른 화면도 갱신한다.
// 계약 입력·변경계약·견적 작성·견적 기준·계약서 작성·계약서 템플릿 화면이 같은 목록을 쓴다(348).
import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_CONTRACT_SERVICE_TYPES,
  activeServiceOptions,
  setContractServiceSnapshot,
  type ContractServiceOption,
  type ContractServiceType,
} from "@/lib/contracts/service-categories";

let loaded: ContractServiceType[] | null = null;
let inflight: Promise<ContractServiceType[]> | null = null;
const listeners = new Set<(list: ContractServiceType[]) => void>();

function fetchContractServiceTypes(): Promise<ContractServiceType[]> {
  if (!inflight) {
    inflight = fetch("/api/contract-service-categories", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        const json = (await res.json()) as { types?: ContractServiceType[] };
        return Array.isArray(json.types) && json.types.length ? json.types : DEFAULT_CONTRACT_SERVICE_TYPES;
      })
      .catch(() => loaded ?? DEFAULT_CONTRACT_SERVICE_TYPES)
      .then((list) => {
        loaded = list;
        setContractServiceSnapshot(list);
        listeners.forEach((fn) => fn(list));
        return list;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** 저장 후 다시 읽기 — 같은 탭의 모든 useContractServiceOptions 가 갱신된다. */
export function refreshContractServiceOptions(): Promise<ContractServiceType[]> {
  loaded = null;
  return fetchContractServiceTypes();
}

/**
 * options = 사용 중 대분류·세분류(선택 목록, CONTRACT_SERVICE_OPTIONS 와 같은 모양),
 * all = 사용 중지 포함 전체. 저장된 값이 목록에 없을 때는 withCurrentServiceOption() 으로 덧붙인다.
 */
export function useContractServiceOptions(): {
  options: ContractServiceOption[];
  all: ContractServiceType[];
  loaded: boolean;
} {
  const [all, setAll] = useState<ContractServiceType[]>(loaded ?? DEFAULT_CONTRACT_SERVICE_TYPES);
  const [isLoaded, setIsLoaded] = useState(loaded !== null);
  useEffect(() => {
    const onChange = (list: ContractServiceType[]) => {
      setAll(list);
      setIsLoaded(true);
    };
    listeners.add(onChange);
    if (loaded) onChange(loaded);
    else void fetchContractServiceTypes();
    return () => {
      listeners.delete(onChange);
    };
  }, []);
  const options = useMemo(() => activeServiceOptions(all), [all]);
  return { options, all, loaded: isLoaded };
}
