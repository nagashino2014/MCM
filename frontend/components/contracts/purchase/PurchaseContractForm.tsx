"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { hasPerm, permsOf } from "@/lib/auth/perms";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import { formatAmount } from "@/components/ui/AmountInput";
import { FACILITY_TRADE_ROLE_LABELS } from "@/lib/ieps/facility-service";
import {
  PURCHASE_CONTRACT_TYPES,
  flagAvailability,
  purchaseCategoriesOf,
  relatedContractMode,
} from "@/lib/contracts/purchase/options";
import type { PurchaseAccountOption } from "@/lib/contracts/purchase/types";
import { purchaseApi, type PurchaseFacilityItem, type RelatedContractItem } from "@/lib/contracts/purchase/client";

/**
 * 매입 계약 "계약 상세정보" 폼(331) — 신규 입력·계약 정보 수정 모달이 공유한다.
 * 배치(2026-11-02 사용자 요청): 계약명 → 계약상대 업체 → [계약 유형 | 계약 분류] → (조건부) 관련 매출 계약 →
 * [계약금액(단계 합계) | 계약일] → [준공일 | 단가 계약·추가 지출·종량제] → [계정과목 | 메모].
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
  contractDate: string;
  completedAt: string;
  isUnitPrice: boolean;
  hasExtraSpend: boolean;
  isMetered: boolean;
  accountCode: string;
  memo: string;
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
    contractDate: "",
    completedAt: "",
    isUnitPrice: false,
    hasExtraSpend: false,
    isMetered: false,
    accountCode: "",
    memo: "",
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
    contractDate: s(row.contract_date).slice(0, 10),
    completedAt: s(row.completed_at).slice(0, 10),
    isUnitPrice: Number(row.is_unit_price ?? 0) === 1,
    hasExtraSpend: Number(row.has_extra_spend ?? 0) === 1,
    isMetered: Number(row.is_metered ?? 0) === 1,
    accountCode: s(row.account_code),
    memo: s(row.memo),
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
    contractDate: state.contractDate || null,
    completedAt: state.completedAt || null,
    isUnitPrice: state.isUnitPrice,
    hasExtraSpend: state.hasExtraSpend,
    isMetered: state.isMetered,
    accountCode: state.accountCode || null,
    memo: state.memo || null,
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
  return null;
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

  // 계정과목 목록 — 비용·자산 계정만(서버 필터).
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

  const setType = (contractType: string) => {
    const first = purchaseCategoriesOf(contractType)[0] ?? "";
    onChange(applyFlagRules({ ...state, contractType, contractCategory: first }));
  };
  const setCategory = (contractCategory: string) => onChange(applyFlagRules({ ...state, contractCategory }));

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

      <label className="grid gap-1 text-sm">
        <span className="font-semibold cd-text-muted">계약 유형</span>
        <select className="cd-select" value={state.contractType} onChange={(e) => setType(e.target.value)}>
          {PURCHASE_CONTRACT_TYPES.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
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

      <label className="grid gap-1 text-sm">
        <span className="font-semibold cd-text-muted">계약금액</span>
        <input className="cd-input tabular-nums" value={amount > 0 ? formatAmount(amount) : ""} readOnly placeholder="청구·수금 단계 합계" />
        <span className="text-[11px] cd-text-faint">청구·수금 단계에 등록한 대금 지급 조건 합계액이 표시됩니다.</span>
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-semibold cd-text-muted">계약일</span>
        <AutoDateInput className="cd-input tabular-nums" value={state.contractDate} onChange={(contractDate) => onChange({ ...state, contractDate })} />
      </label>

      <label className="grid gap-1 text-sm">
        <span className="font-semibold cd-text-muted">준공일</span>
        <AutoDateInput className="cd-input tabular-nums" value={state.completedAt} onChange={(completedAt) => onChange({ ...state, completedAt })} />
      </label>
      <div className="grid gap-1 text-sm">
        <span className="font-semibold cd-text-muted">계약 조건</span>
        {/* 단가 계약=외주 계약, 추가 지출=정기 구독, 종량제=복합기 렌트·관리 계약에서만 켤 수 있다. 세부 설정은 후속. */}
        <div className="flex flex-wrap items-center gap-4 min-h-[38px]">
          <FlagCheckbox label="단가 계약" checked={state.isUnitPrice} disabled={!avail.unitPrice} onChange={(isUnitPrice) => onChange({ ...state, isUnitPrice })} title="외주 계약에서만 선택할 수 있습니다" />
          <FlagCheckbox label="추가 지출" checked={state.hasExtraSpend} disabled={!avail.extraSpend} onChange={(hasExtraSpend) => onChange({ ...state, hasExtraSpend })} title="정기 구독에서만 선택할 수 있습니다" />
          <FlagCheckbox label="종량제" checked={state.isMetered} disabled={!avail.metered} onChange={(isMetered) => onChange({ ...state, isMetered })} title="임대 계약(복합기 렌트)·관리 계약에서만 선택할 수 있습니다" />
        </div>
      </div>

      <label className="grid gap-1 text-sm">
        <span className="font-semibold cd-text-muted">매입 계정과목</span>
        <select className="cd-select" value={state.accountCode} onChange={(e) => onChange({ ...state, accountCode: e.target.value })}>
          <option value="">미지정</option>
          {accounts.map((a) => (
            <option key={a.accountCode} value={a.accountCode}>{a.accountCode} {a.name}</option>
          ))}
        </select>
        <span className="text-[11px] cd-text-faint">재무 전표·장부의 계정과목(비용·자산)입니다. 매입 계산서 분개의 참고 계정으로 씁니다.</span>
      </label>
      <label className="grid gap-1 text-sm">
        <span className="font-semibold cd-text-muted">메모</span>
        <textarea className="cd-input min-h-[70px]" value={state.memo} onChange={(e) => onChange({ ...state, memo: e.target.value })} />
      </label>
    </div>
  );
}

/** 유형·분류가 바뀌면 켤 수 없는 플래그를 끈다. */
function applyFlagRules(state: PurchaseFormState): PurchaseFormState {
  const avail = flagAvailability(state.contractType, state.contractCategory);
  const related = relatedContractMode(state.contractType, state.contractCategory);
  return {
    ...state,
    isUnitPrice: avail.unitPrice && state.isUnitPrice,
    hasExtraSpend: avail.extraSpend && state.hasExtraSpend,
    isMetered: avail.metered && state.isMetered,
    ...(related === "hidden" ? { relatedContractQuery: "", relatedContractId: "", relatedContractLabel: "" } : {}),
  };
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
