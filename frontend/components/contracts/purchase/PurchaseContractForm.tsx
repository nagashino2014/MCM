"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { hasPerm, permsOf } from "@/lib/auth/perms";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import { AmountInput, formatAmount } from "@/components/ui/AmountInput";
import { FACILITY_TRADE_ROLE_LABELS } from "@/lib/ieps/facility-service";
import {
  PURCHASE_CONTRACT_TYPES,
  amountHint,
  amountLabel,
  amountMode,
  defaultPurchaseAccount,
  endDateLabel,
  flagAvailability,
  flagForced,
  isPurchaseAccountAllowed,
  purchaseAccountCodesOf,
  purchaseCategoriesOf,
  relatedContractMode,
  startDateLabel,
} from "@/lib/contracts/purchase/options";
import { parseTypeDetails, type PurchaseTypeDetails } from "@/lib/contracts/purchase/type-details";
import type { PurchaseAccountOption } from "@/lib/contracts/purchase/types";
import { purchaseApi, type PurchaseFacilityItem, type RelatedContractItem } from "@/lib/contracts/purchase/client";

/**
 * 매입 계약 "계약 상세정보" 폼(331·333) — 신규 입력·변경계약 입력 모달이 공유한다.
 * 배치(2026-11-02 사용자 요청): 계약명 → 계약상대 업체 → [계약 유형 | 계약 분류] → (조건부) 관련 매출 계약 →
 * [계약금액 | 계약일] → [준공일 | 단가 계약·추가 지출·종량제] → [계정과목 | 메모].
 * 2차(2026-11-03): 라벨·입력 방식이 유형을 따른다 — 정기 구독은 '정기 구독료'를 직접 입력, 임대·관리는 금액 비해당,
 * 계약일/준공일 라벨은 startDateLabel/endDateLabel, 계정과목은 유형별 목록만, 관리 계약은 종량제 고정.
 */
export interface PurchaseFormState {
  contractTitle: string;
  counterpartyQuery: string;
  counterpartyFacilityId: string;
  counterpartyName: string;
  counterpartyTradeRoles: string[];
  contractType: string;
  contractCategory: string;
  relatedContractQuery: string;
  relatedContractId: string;
  relatedContractLabel: string;
  /** 정기 구독의 월 구독료(콤마 없는 숫자 문자열). 다른 유형은 빈 값. */
  contractAmount: string;
  contractDate: string;
  completedAt: string;
  isUnitPrice: boolean;
  hasExtraSpend: boolean;
  isMetered: boolean;
  accountCode: string;
  memo: string;
  /** 임대 계약 분류 탭의 상세(333). */
  typeDetails: PurchaseTypeDetails;
}

export function createEmptyPurchaseFormState(): PurchaseFormState {
  const first = PURCHASE_CONTRACT_TYPES[0];
  return {
    contractTitle: "",
    counterpartyQuery: "",
    counterpartyFacilityId: "",
    counterpartyName: "",
    counterpartyTradeRoles: [],
    contractType: first.key,
    contractCategory: first.categories[0],
    relatedContractQuery: "",
    relatedContractId: "",
    relatedContractLabel: "",
    contractAmount: "",
    contractDate: "",
    completedAt: "",
    isUnitPrice: false,
    hasExtraSpend: false,
    isMetered: false,
    accountCode: defaultPurchaseAccount(first.key, first.categories[0]),
    memo: "",
    typeDetails: {},
  };
}

/** 저장된 상세(contract 행)로 폼 상태를 만든다(계약 정보 수정). */
export function purchaseFormStateFromRow(row: Record<string, unknown>): PurchaseFormState {
  const s = (v: unknown) => (v == null ? "" : String(v));
  const base = createEmptyPurchaseFormState();
  return {
    ...base,
    contractTitle: s(row.contract_title),
    counterpartyQuery: s(row.counterparty_name),
    counterpartyFacilityId: s(row.counterparty_facility_id),
    counterpartyName: s(row.counterparty_name),
    counterpartyTradeRoles: Array.isArray(row.counterparty_trade_roles) ? (row.counterparty_trade_roles as unknown[]).map(String) : [],
    contractType: s(row.contract_type) || base.contractType,
    contractCategory: s(row.contract_category) || base.contractCategory,
    relatedContractQuery: s(row.related_contract_title),
    relatedContractId: s(row.related_contract_id),
    relatedContractLabel: row.related_contract_title
      ? `${s(row.related_contract_title)}${row.related_counterparty_name ? ` · ${s(row.related_counterparty_name)}` : ""}`
      : "",
    contractAmount: amountMode(s(row.contract_type)) === "manual" && row.contract_amount != null ? String(Math.round(Number(row.contract_amount))) : "",
    contractDate: s(row.contract_date).slice(0, 10),
    completedAt: s(row.completed_at).slice(0, 10),
    isUnitPrice: Number(row.is_unit_price ?? 0) === 1,
    hasExtraSpend: Number(row.has_extra_spend ?? 0) === 1,
    isMetered: Number(row.is_metered ?? 0) === 1 || !!flagForced(s(row.contract_type)).metered,
    accountCode: s(row.account_code),
    memo: s(row.memo),
    typeDetails: parseTypeDetails(row.type_details),
  };
}

/** 폼 상태 → 등록/수정 API 본문. */
export function purchaseFormToBody(state: PurchaseFormState) {
  return {
    contractTitle: state.contractTitle,
    counterpartyFacilityId: state.counterpartyFacilityId,
    contractType: state.contractType,
    contractCategory: state.contractCategory,
    relatedContractId: state.relatedContractId || null,
    contractAmount: amountMode(state.contractType) === "manual" && state.contractAmount ? Number(state.contractAmount) : null,
    contractDate: state.contractDate || null,
    completedAt: state.completedAt || null,
    isUnitPrice: state.isUnitPrice,
    hasExtraSpend: state.hasExtraSpend,
    isMetered: state.isMetered,
    accountCode: state.accountCode || null,
    memo: state.memo || null,
    typeDetails: state.typeDetails,
  };
}

/** 화면에서 먼저 거르는 필수 검증(서버 validate.ts 와 같은 규칙). */
export function validatePurchaseForm(state: PurchaseFormState): string | null {
  if (!state.contractTitle.trim()) return "계약명을 입력해 주세요.";
  if (!state.counterpartyFacilityId) return "계약상대 업체를 검색해 선택해 주세요.";
  if (!state.contractCategory) return "계약 분류를 선택해 주세요.";
  if (relatedContractMode(state.contractType, state.contractCategory) === "required" && !state.relatedContractId) {
    return `${state.contractCategory} 외주 계약은 관련 매출 계약을 선택해야 합니다.`;
  }
  if (state.contractType === "lease" && state.contractCategory === "차량 렌트" && !(state.typeDetails.vehicle?.name ?? "").trim()) {
    return "차량 렌트 탭에서 차종을 입력해 주세요(자산관리 차량으로 등록됩니다).";
  }
  return null;
}

/** 유형·분류가 바뀌면 켤 수 없는 플래그를 끄고(강제 플래그는 켜고), 계정과목을 유형 목록 안으로 맞춘다. */
export function applyPurchaseTypeRules(state: PurchaseFormState): PurchaseFormState {
  const avail = flagAvailability(state.contractType, state.contractCategory);
  const forced = flagForced(state.contractType);
  const related = relatedContractMode(state.contractType, state.contractCategory);
  const accountCode = isPurchaseAccountAllowed(state.contractType, state.accountCode)
    ? state.accountCode
    : defaultPurchaseAccount(state.contractType, state.contractCategory);
  return {
    ...state,
    isUnitPrice: avail.unitPrice && state.isUnitPrice,
    hasExtraSpend: avail.extraSpend && state.hasExtraSpend,
    isMetered: forced.metered ? true : avail.metered && state.isMetered,
    contractAmount: amountMode(state.contractType) === "manual" ? state.contractAmount : "",
    accountCode,
    ...(related === "hidden" ? { relatedContractQuery: "", relatedContractId: "", relatedContractLabel: "" } : {}),
  };
}

export function PurchaseContractForm({
  state,
  onChange,
  amount,
}: {
  state: PurchaseFormState;
  onChange: (next: PurchaseFormState) => void;
  /** 계약금액 = 청구·수금 단계 합계(읽기 전용 표시). */
  amount: number;
}) {
  const { data: session } = useSession();
  const canSearchSales = hasPerm(permsOf(session?.user), "contract.view");
  const [facilityOptions, setFacilityOptions] = useState<PurchaseFacilityItem[]>([]);
  const [relatedOptions, setRelatedOptions] = useState<RelatedContractItem[]>([]);
  const [accounts, setAccounts] = useState<PurchaseAccountOption[]>([]);
  const categories = purchaseCategoriesOf(state.contractType);
  const relatedMode = relatedContractMode(state.contractType, state.contractCategory);
  const avail = flagAvailability(state.contractType, state.contractCategory);
  const forced = flagForced(state.contractType);
  const mode = amountMode(state.contractType);
  // 유형별 허용 계정만 — 목록 순서는 PURCHASE_ACCOUNT_CODES 순(분류별 기본값이 맨 앞은 아니므로 select 는 값으로 고정).
  const allowedCodes = purchaseAccountCodesOf(state.contractType);
  const typeAccounts = allowedCodes.map((code) => accounts.find((a) => a.accountCode === code)).filter((a): a is PurchaseAccountOption => !!a);

  // 계정과목 목록 — 비용 계정만(서버 필터).
  useEffect(() => {
    let alive = true;
    purchaseApi<{ accounts: PurchaseAccountOption[] }>("/api/purchase-contracts/account-codes")
      .then((json) => alive && setAccounts(json.accounts ?? []))
      .catch(() => alive && setAccounts([]));
    return () => {
      alive = false;
    };
  }, []);

  // 계약상대 업체 검색 — 매입처(trade_roles 'purchase')를 앞에 두고 배지를 붙인다(신규 업체도 고를 수 있다).
  useEffect(() => {
    const q = state.counterpartyQuery.trim();
    if (q.length < 2 || (state.counterpartyFacilityId && q === state.counterpartyName)) {
      setFacilityOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: "20", sort: "name" });
        const res = await fetch(`/api/facilities?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        if (!res.ok) return;
        const json = (await res.json()) as { items?: PurchaseFacilityItem[] };
        const items = [...(json.items ?? [])].sort(
          (a, b) => Number(b.tradeRoles?.includes("purchase") ?? false) - Number(a.tradeRoles?.includes("purchase") ?? false)
        );
        setFacilityOptions(items);
      } catch {
        if (!controller.signal.aborted) setFacilityOptions([]);
      }
    }, 160);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [state.counterpartyQuery, state.counterpartyFacilityId, state.counterpartyName]);

  // 관련 매출 계약 검색 — contract.view 가 있을 때만(없으면 안내).
  useEffect(() => {
    const q = state.relatedContractQuery.trim();
    if (!canSearchSales || relatedMode === "hidden" || q.length < 2 || (state.relatedContractId && q === state.relatedContractLabel.split(" · ")[0])) {
      setRelatedOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: "20", sort: "recent" });
        const res = await fetch(`/api/contracts?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        if (!res.ok) return;
        const json = (await res.json()) as { items?: RelatedContractItem[] };
        setRelatedOptions(json.items ?? []);
      } catch {
        if (!controller.signal.aborted) setRelatedOptions([]);
      }
    }, 160);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [state.relatedContractQuery, state.relatedContractId, state.relatedContractLabel, canSearchSales, relatedMode]);

  // 유형·분류가 바뀌면 계정과목은 분류 기본값으로 다시 잡는다(사용자가 고른 값이 새 목록에 없으면 되돌아간다).
  const setType = (contractType: string) => {
    const first = purchaseCategoriesOf(contractType)[0] ?? "";
    onChange(applyPurchaseTypeRules({ ...state, contractType, contractCategory: first, accountCode: defaultPurchaseAccount(contractType, first), typeDetails: {} }));
  };
  const setCategory = (contractCategory: string) =>
    onChange(applyPurchaseTypeRules({ ...state, contractCategory, accountCode: defaultPurchaseAccount(state.contractType, contractCategory), typeDetails: {} }));

  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="grid gap-1 text-sm col-span-2">
        <span className="font-semibold cd-text-muted">계약명</span>
        <input
          className="cd-input"
          value={state.contractTitle}
          onChange={(e) => onChange({ ...state, contractTitle: e.target.value })}
          placeholder="예: 2026년 사무실 복합기 임대"
        />
      </label>

      <div className="grid gap-1 text-sm col-span-2 relative">
        <span className="font-semibold cd-text-muted">계약상대 업체</span>
        <input
          className="cd-input"
          value={state.counterpartyQuery}
          onChange={(e) =>
            onChange({ ...state, counterpartyQuery: e.target.value, counterpartyFacilityId: "", counterpartyName: "", counterpartyTradeRoles: [] })
          }
          placeholder="업체명 두 글자 이상 입력"
        />
        {state.counterpartyFacilityId ? (
          <span className="text-[11px] cd-text-faint flex items-center gap-1.5">
            선택됨: {state.counterpartyName}
            {state.counterpartyTradeRoles.map((r) => (
              <TradeRoleBadge key={r} role={r} />
            ))}
            {!state.counterpartyTradeRoles.includes("purchase") && <span>· 저장 시 매입처로 표시됩니다</span>}
          </span>
        ) : (
          <span className="text-[11px] cd-text-faint">사업장 마스터에서 검색합니다. 매입처로 지정된 업체가 먼저 나옵니다.</span>
        )}
        {facilityOptions.length > 0 && (
          <ul className="absolute left-0 right-0 top-[66px] z-20 max-h-56 overflow-auto rounded-lg border cd-border-c cd-card-bg shadow-[var(--cd-shadow)] text-xs">
            {facilityOptions.map((f) => (
              <li key={f.facilityId}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-[color:var(--cd-surface)] flex items-center gap-2"
                  onClick={() => {
                    onChange({
                      ...state,
                      counterpartyQuery: f.companyName,
                      counterpartyFacilityId: f.facilityId,
                      counterpartyName: f.companyName,
                      counterpartyTradeRoles: f.tradeRoles ?? [],
                    });
                    setFacilityOptions([]);
                  }}
                >
                  <span className="cd-text truncate">{f.companyName}</span>
                  {(f.tradeRoles ?? []).map((r) => (
                    <TradeRoleBadge key={r} role={r} />
                  ))}
                  <span className="cd-text-faint ml-auto shrink-0 font-mono">{f.businessRegistrationNo ?? ""}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="grid gap-1 text-sm content-start">
        <span className="font-semibold cd-text-muted">계약 유형</span>
        <select className="cd-select" value={state.contractType} onChange={(e) => setType(e.target.value)}>
          {PURCHASE_CONTRACT_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm content-start">
        <span className="font-semibold cd-text-muted">계약 분류</span>
        <select className="cd-select" value={state.contractCategory} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>

      {relatedMode !== "hidden" && (
        <div className="grid gap-1 text-sm col-span-2 relative">
          <span className="font-semibold cd-text-muted">
            관련 매출 계약 {relatedMode === "required" ? <span className="cd-error-text">*</span> : <span className="cd-text-faint font-normal">(선택)</span>}
          </span>
          {canSearchSales ? (
            <>
              <input
                className="cd-input"
                value={state.relatedContractQuery}
                onChange={(e) => onChange({ ...state, relatedContractQuery: e.target.value, relatedContractId: "", relatedContractLabel: "" })}
                placeholder="매출 계약명 또는 발주처 두 글자 이상"
              />
              <span className="text-[11px] cd-text-faint">
                {state.relatedContractId ? `선택됨: ${state.relatedContractLabel}` : "이 외주 계약이 수행하는 매출 계약(용역)을 고릅니다."}
              </span>
              {relatedOptions.length > 0 && (
                <ul className="absolute left-0 right-0 top-[66px] z-20 max-h-56 overflow-auto rounded-lg border cd-border-c cd-card-bg shadow-[var(--cd-shadow)] text-xs">
                  {relatedOptions.map((c) => (
                    <li key={c.contractId}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left hover:bg-[color:var(--cd-surface)] flex items-center gap-2"
                        onClick={() => {
                          onChange({
                            ...state,
                            relatedContractQuery: c.contractTitle,
                            relatedContractId: c.contractId,
                            relatedContractLabel: `${c.contractTitle} · ${c.counterpartyName}`,
                          });
                          setRelatedOptions([]);
                        }}
                      >
                        <span className="cd-text truncate">{c.contractTitle}</span>
                        <span className="cd-text-faint truncate">{c.counterpartyName}</span>
                        <span className="cd-text-faint ml-auto shrink-0 font-mono">{c.contractDate ?? ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="rounded-lg border cd-border-c p-3 text-xs cd-text-muted">
              매출 계약 조회 권한(contract.view)이 없어 관련 매출 계약을 검색할 수 없습니다.
              {relatedMode === "required" && " 이 분류는 관련 매출 계약이 필수라 계약 조회 권한이 있는 담당자가 등록해야 합니다."}
            </p>
          )}
        </div>
      )}

      {/* 좌·우 칸은 content-start 로 위에 붙여 힌트 줄 유무와 관계없이 입력란 상단·높이를 맞춘다(2026-11-03 사용자 지적). */}
      <label className="grid gap-1 text-sm content-start">
        <span className="font-semibold cd-text-muted">{amountLabel(state.contractType)}</span>
        {mode === "manual" ? (
          <AmountInput className="cd-input tabular-nums" value={state.contractAmount} onChange={(contractAmount) => onChange({ ...state, contractAmount })} placeholder={amountHint(state.contractType)} />
        ) : (
          <input className="cd-input tabular-nums" value={mode === "milestone_sum" && amount > 0 ? formatAmount(amount) : ""} readOnly disabled={mode === "disabled"} placeholder={amountHint(state.contractType)} />
        )}
        <span className="text-[11px] cd-text-faint">
          {mode === "milestone_sum" && "청구·수금 단계에 등록한 대금 지급 조건 합계액이 표시됩니다."}
          {mode === "manual" && "1개월 기준 구독료를 적습니다. 추가 지출은 '추가 지출' 탭에서 월별로 기록합니다."}
          {mode === "disabled" && "임대·관리 계약은 분류 탭과 월별 표에서 금액을 다룹니다."}
        </span>
      </label>
      <label className="grid gap-1 text-sm content-start">
        <span className="font-semibold cd-text-muted">{startDateLabel(state.contractType)}</span>
        <AutoDateInput className="cd-input tabular-nums" value={state.contractDate} onChange={(contractDate) => onChange({ ...state, contractDate })} />
      </label>

      <label className="grid gap-1 text-sm content-start">
        <span className="font-semibold cd-text-muted">{endDateLabel(state.contractType)}</span>
        <AutoDateInput className="cd-input tabular-nums" value={state.completedAt} onChange={(completedAt) => onChange({ ...state, completedAt })} />
        {state.contractType === "lease" && <span className="text-[11px] cd-text-faint">렌트·임대 계약 종료일이 정해져 있으면 적습니다.</span>}
      </label>
      <div className="grid gap-1 text-sm content-start">
        <span className="font-semibold cd-text-muted">계약 조건</span>
        {/* 단가 계약=외주 계약, 추가 지출=정기 구독, 종량제=복합기·비데·정수기 렌트·관리 계약(관리 계약은 고정). 체크 시 해당 탭이 열린다. */}
        <div className="flex flex-wrap items-center gap-4 min-h-[38px]">
          <FlagCheckbox label="단가 계약" checked={state.isUnitPrice} disabled={!avail.unitPrice} onChange={(isUnitPrice) => onChange({ ...state, isUnitPrice })} title="외주 계약에서만 선택할 수 있습니다" />
          <FlagCheckbox label="추가 지출" checked={state.hasExtraSpend} disabled={!avail.extraSpend} onChange={(hasExtraSpend) => onChange({ ...state, hasExtraSpend })} title="정기 구독에서만 선택할 수 있습니다" />
          <FlagCheckbox
            label="종량제"
            checked={state.isMetered}
            disabled={!avail.metered || !!forced.metered}
            onChange={(isMetered) => onChange({ ...state, isMetered })}
            title={forced.metered ? "관리 계약은 종량제로 고정됩니다" : "임대 계약(복합기·비데·정수기 렌트)·관리 계약에서만 선택할 수 있습니다"}
          />
        </div>
      </div>

      <label className="grid gap-1 text-sm content-start">
        <span className="font-semibold cd-text-muted">매입 계정과목</span>
        <select className="cd-select" value={state.accountCode} onChange={(e) => onChange({ ...state, accountCode: e.target.value })}>
          <option value="">미지정</option>
          {typeAccounts.map((a) => (
            <option key={a.accountCode} value={a.accountCode}>{a.accountCode} {a.name}</option>
          ))}
        </select>
        <span className="text-[11px] cd-text-faint">이 계약 유형에 맞는 비용 계정만 보입니다. 분류를 고르면 기본 계정이 잡히고, 매입 계산서 분개의 참고 계정으로 씁니다.</span>
      </label>
      <label className="grid gap-1 text-sm content-start">
        <span className="font-semibold cd-text-muted">메모</span>
        <textarea className="cd-input min-h-[70px]" value={state.memo} onChange={(e) => onChange({ ...state, memo: e.target.value })} />
      </label>
    </div>
  );
}

function FlagCheckbox({ label, checked, disabled, onChange, title }: { label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void; title: string }) {
  return (
    <label className={"inline-flex items-center gap-1.5 text-xs " + (disabled ? "cd-text-faint cursor-not-allowed" : "cd-text cursor-pointer")} title={disabled ? title : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function TradeRoleBadge({ role }: { role: string }) {
  const label = FACILITY_TRADE_ROLE_LABELS[role as keyof typeof FACILITY_TRADE_ROLE_LABELS];
  if (!label) return null;
  return (
    <span className={"shrink-0 rounded-full px-1.5 py-0.5 text-[10px] " + (role === "purchase" ? "cd-tint-primary cd-text-primary" : "cd-surface-bg cd-text-muted")}>
      {label}
    </span>
  );
}
