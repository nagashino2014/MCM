/**
 * 계약 용역 대분류·세분류 — 클라이언트/서버 공용 형식·기본값·선택 목록 함수(DB import 금지).
 *
 * 단일 원천은 DB 표 contract_service_types·contract_service_subtypes(348)이고, 관리자 설정
 * '용역 분류'(/admin/contract-service-categories)에서 편집한다.
 *   - 서버: lib/contracts/service-categories-server.ts loadContractServiceTypes()
 *   - 화면: lib/contracts/use-contract-service-options.ts useContractServiceOptions()
 * 표가 없으면(348 적용 전) 코드 기본 목록(CONTRACT_SERVICE_OPTIONS)으로 동작한다.
 *
 * 계약·견적·계약서 행은 분류를 이름 문자열로 저장한다. 그래서 선택 목록은 '사용 중' 항목만 보여 주되,
 * 이미 저장된 값이 목록에 없으면(사용 중지·옛 이름) withCurrentServiceOption() 으로 그 값을 덧붙여 지워지지 않게 한다.
 */
import { CONTRACT_SERVICE_OPTIONS } from "@/lib/contracts/service-options";

export interface ContractServiceSubtype {
  id: string;
  label: string;
  /** 옛 이름(이름 변경 이력) */
  aliases: string[];
  sortOrder: number;
  active: boolean;
  /** 이름을 바꿀 수 없는 이유 — null 이면 변경 가능 */
  lockReason: string | null;
}

export interface ContractServiceType {
  id: string;
  label: string;
  sortOrder: number;
  active: boolean;
  lockReason: string | null;
  subtypes: ContractServiceSubtype[];
}

/** 선택 목록 형태 — 기존 CONTRACT_SERVICE_OPTIONS·QUOTE_SERVICE_OPTIONS 와 같은 모양 */
export interface ContractServiceOption {
  type: string;
  subtypes: string[];
}

const DEFAULT_TYPE_IDS: Record<string, string> = {
  통합허가: "integrated-permit",
  "장외&화관법": "chem",
  HAPs: "haps",
  ESG탄소중립: "esg",
  기타: "etc",
};

export const TYPE_LOCK_REASON = "견적번호 종류·성과급 부서 귀속·할 일 업무 유형·영업 발굴 분류가 이 이름을 씁니다.";
export const PERMIT_NO_LOCK_REASON = "계약 상세의 허가번호 입력이 이 세분류에서만 켜집니다.";
const PERMIT_NO_SUBTYPES = new Set(["최초허가", "변경허가", "재검토"]);

/** 348 시드와 같은 기본 목록(표가 없을 때) */
export const DEFAULT_CONTRACT_SERVICE_TYPES: ContractServiceType[] = CONTRACT_SERVICE_OPTIONS.map((option, i) => {
  const typeId = DEFAULT_TYPE_IDS[option.type] ?? `type-${i + 1}`;
  return {
    id: typeId,
    label: option.type,
    sortOrder: (i + 1) * 10,
    active: true,
    lockReason: TYPE_LOCK_REASON,
    subtypes: option.subtypes.map((label, j) => ({
      id: `${typeId}-${j + 1}`,
      label,
      aliases: [],
      sortOrder: (j + 1) * 10,
      active: true,
      lockReason: typeId === "integrated-permit" && PERMIT_NO_SUBTYPES.has(label) ? PERMIT_NO_LOCK_REASON : null,
    })),
  };
});

/** 사용 중 항목만 선택 목록 형태로 — 사용 중인 대분류 아래 사용 중인 세분류. */
export function activeServiceOptions(list: ContractServiceType[]): ContractServiceOption[] {
  return list
    .filter((t) => t.active)
    .map((t) => ({ type: t.label, subtypes: t.subtypes.filter((s) => s.active).map((s) => s.label) }));
}

/**
 * 저장된 값을 잃지 않는 선택 목록 — 현재 대분류·세분류가 목록에 없으면(사용 중지·옛 이름·자유 입력 값) 덧붙인다.
 * 새 계약 입력처럼 현재 값이 없으면 그대로 돌려준다.
 */
export function withCurrentServiceOption(
  options: ContractServiceOption[],
  currentType: string | null | undefined,
  currentSubtype: string | null | undefined
): ContractServiceOption[] {
  const type = String(currentType ?? "").trim();
  const subtype = String(currentSubtype ?? "").trim();
  if (!type) return options;
  const found = options.find((o) => o.type === type);
  if (!found) return [...options, { type, subtypes: subtype ? [subtype] : [] }];
  if (!subtype || found.subtypes.includes(subtype)) return options;
  return options.map((o) => (o === found ? { ...o, subtypes: [...o.subtypes, subtype] } : o));
}

/** 대분류의 세분류 목록(선택 목록에서) */
export function subtypesOf(options: ContractServiceOption[], type: string | null | undefined): string[] {
  return options.find((o) => o.type === type)?.subtypes ?? [];
}

// ── 모듈 스냅샷 — 동기 함수(새 계약 기본값 등)가 최근에 읽은 목록을 쓰게 한다 ──
let snapshot: ContractServiceType[] = DEFAULT_CONTRACT_SERVICE_TYPES;

export function setContractServiceSnapshot(list: ContractServiceType[]): void {
  if (Array.isArray(list) && list.length) snapshot = list;
}

/** 최근에 읽은 사용 중 선택 목록(아직 못 읽었으면 기본 목록) */
export function contractServiceOptionsSnapshot(): ContractServiceOption[] {
  const options = activeServiceOptions(snapshot);
  return options.length ? options : activeServiceOptions(DEFAULT_CONTRACT_SERVICE_TYPES);
}
