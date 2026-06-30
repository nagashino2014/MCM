"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { IndustryOptionsEditorButton, useContractIndustryOptions } from "@/components/contracts/IndustryOptionsEditor";
import {
  ORDERING_SUBJECT_OPTIONS,
  ORDERING_SUBJECT_SITE_DIRECT,
  ORDERING_SUBJECT_PARENT_CORP,
  ORDERING_SUBJECT_CONSIGNED_OPERATOR,
  findFacilityByBusinessRegistrationNo,
  validateOrderingTargetFacility,
} from "@/lib/ieps/ordering-subject";

export interface ContractChangePayload {
  amounts: Array<{ stageLabel: string; previousAmount: string; nextAmount: string }>;
  servicePeriod: { previous: string; next: string };
  paymentTerms: Array<{ stageLabel: string; previous: string; next: string }>;
  serviceCategory: {
    previousType: string;
    previousSubtype: string;
    previousIndustry: string;
    nextType: string;
    nextSubtype: string;
    nextIndustry: string;
    changed: boolean;
    previousPaymentMethod: string;
    nextPaymentMethod: string;
    targetFacilities: FacilitySearchItem[];
    orderingSubjectType: string;
  };
  closing: { completionDate: string; permitAcquiredAt: string; etc: string };
  termination: { terminatedAt: string; terminationReason: string; suspendedAt: string; suspensionReason: string };
  outsourcing: { outsourcingTitle: string; counterpartyName: string; serviceType: string; contractDate: string; endedAt: string; amount: string; memo: string };
  meta: { changedAt: string; enteredAt: string; memo: string };
}

interface ContractChangeModalProps {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  counterpartyBusinessRegistrationNo?: string | null;
  contractDate: string | null;
  initialMilestones: Array<{ stageLabel: string; amount: number; paymentTerms: string }>;
  initialServiceType: string;
  initialServiceSubtype: string;
  initialIndustryCategory: string;
  initialPaymentMethod: string;
  initialTargetFacilities: FacilitySearchItem[];
  initialOrderingSubjectType?: string | null;
  initialEndedAt: string | null;
  initialCurrentAmount: number | null;
  onClose: () => void;
  onSaved: () => void;
}

type TabKey = "amount" | "period" | "terms" | "service" | "outsourcing" | "lifecycle" | "closing";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "amount", label: "금액" },
  { key: "period", label: "용역기간" },
  { key: "terms", label: "지급조건" },
  { key: "service", label: "용역분류" },
  { key: "outsourcing", label: "외주 용역" },
  { key: "lifecycle", label: "계약중지/해지" },
  { key: "closing", label: "준공일 및 기타" },
];

const DEFAULT_OUTSOURCING_TYPES = ["도면 작성", "산업안전 관련", "측정/분석", "디자인", "번역"];
const DEFAULT_TERMINATION_REASONS = ["사업장 폐쇄", "허가대상 제외", "대금 미지급"];
const DEFAULT_SUSPENSION_REASONS = ["사업추진 유보", "가동 지연", "관련허가 지연", "대금 미지급"];
const PAYMENT_METHOD_OPTIONS = ["현금", "어음 : 1개월 이하", "어음 : 2개월 이하", "어음 : 2개월 이상"];

interface FacilitySearchItem {
  facilityId: string;
  companyName: string;
  businessRegistrationNo: string | null;
  siteAddress: string | null;
  integratedPermitTarget?: string | null;
}

export default function ContractChangeModal(props: ContractChangeModalProps) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>("amount");
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState({ changedAt: new Date().toISOString().slice(0, 10), enteredAt: new Date().toISOString().slice(0, 10), memo: "" });
  // 계약일은 원칙적으로 변경계약 대상이 아니지만, 신규 입력 시 오기재한 경우
  // 바로잡을 수 있도록 편집을 허용한다. 초기값과 달라진 경우에만 서버로 전송한다.
  const [contractDate, setContractDate] = useState(props.contractDate ?? "");
  const outsourcingFileRef = useRef<File | null>(null);
  const [outsourcingFileName, setOutsourcingFileName] = useState("");
  const [outsourcingTypes, setOutsourcingTypes] = useState(DEFAULT_OUTSOURCING_TYPES);
  const [terminationReasons, setTerminationReasons] = useState(DEFAULT_TERMINATION_REASONS);
  const [suspensionReasons, setSuspensionReasons] = useState(DEFAULT_SUSPENSION_REASONS);
  const [facilityQuery, setFacilityQuery] = useState("");
  const [facilityOptions, setFacilityOptions] = useState<FacilitySearchItem[]>([]);
  const { industryOptions, setIndustryOptions } = useContractIndustryOptions();

  const [amounts, setAmounts] = useState(
    props.initialMilestones.map((m) => ({
      stageLabel: m.stageLabel,
      previousAmount: String(m.amount ?? ""),
      nextAmount: "",
    }))
  );
  const [servicePeriod, setServicePeriod] = useState({
    previous: props.initialEndedAt ?? "",
    next: "",
  });
  const [paymentTerms, setPaymentTerms] = useState(
    props.initialMilestones.map((m) => ({
      stageLabel: m.stageLabel,
      previous: m.paymentTerms ?? "",
      next: "",
    }))
  );
  const [serviceCategory, setServiceCategory] = useState({
    previousType: props.initialServiceType ?? "",
    previousSubtype: props.initialServiceSubtype ?? "",
    previousIndustry: props.initialIndustryCategory ?? "",
    nextType: "",
    nextSubtype: "",
    nextIndustry: "",
    changed: false,
    previousPaymentMethod: props.initialPaymentMethod ?? "",
    nextPaymentMethod: "",
    targetFacilities: props.initialTargetFacilities ?? [],
    orderingSubjectType: props.initialOrderingSubjectType ?? ORDERING_SUBJECT_OPTIONS[0].value,
  });
  const [closing, setClosing] = useState({ completionDate: "", permitAcquiredAt: "", etc: "" });
  const [amendmentFile, setAmendmentFile] = useState<File | null>(null);
  const [outsourcing, setOutsourcing] = useState({
    outsourcingTitle: "",
    counterpartyName: "",
    serviceType: DEFAULT_OUTSOURCING_TYPES[0],
    contractDate: "",
    endedAt: "",
    amount: "",
    memo: "",
  });
  const [lifecycle, setLifecycle] = useState({
    terminatedAt: "",
    terminationReason: DEFAULT_TERMINATION_REASONS[0],
    suspendedAt: "",
    suspensionReason: DEFAULT_SUSPENSION_REASONS[0],
  });

  const newCurrentAmount = useMemo(() => {
    const totalNext = amounts.reduce((acc, item) => acc + (Number(item.nextAmount) || 0), 0);
    if (totalNext > 0) return totalNext;
    return null;
  }, [amounts]);

  const previousAmountTotal = useMemo(
    () => amounts.reduce((acc, item) => acc + (Number(item.previousAmount) || 0), 0),
    [amounts]
  );

  useEffect(() => {
    const q = facilityQuery.trim();
    if (q.length < 2) {
      setFacilityOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          q,
          limit: "10",
          sort: "name",
        });
        const res = await fetch(`/api/facilities?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as { items?: FacilitySearchItem[] };
        setFacilityOptions(json.items ?? []);
      } catch {
        if (!controller.signal.aborted) setFacilityOptions([]);
      }
    }, 160);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [facilityQuery]);

  // 발주 주체 = 대상사업장 본인: 계약상대 업체 사업자번호와 일치하는 사업장을
  // 자동으로 찾아 대상사업장으로 채운다. (신규 계약 입력 모달과 동일 동작)
  useEffect(() => {
    if (serviceCategory.orderingSubjectType !== ORDERING_SUBJECT_SITE_DIRECT) return;
    const brn = (props.counterpartyBusinessRegistrationNo ?? "").replace(/[^0-9]/g, "");
    if (!brn) return;
    const alreadyMatched =
      serviceCategory.targetFacilities.length === 1 &&
      (serviceCategory.targetFacilities[0].businessRegistrationNo ?? "").replace(/[^0-9]/g, "") === brn;
    if (alreadyMatched) return;
    const controller = new AbortController();
    (async () => {
      try {
        const match = await findFacilityByBusinessRegistrationNo(
          props.counterpartyBusinessRegistrationNo,
          controller.signal
        );
        if (match) {
          setServiceCategory((prev) => ({ ...prev, targetFacilities: [match] }));
        } else {
          setServiceCategory((prev) => ({ ...prev, targetFacilities: [] }));
          toast.show("계약상대 업체와 일치하는 사업장을 찾지 못했습니다. 대상사업장을 직접 확인하세요.", "error");
        }
      } catch {
        if (!controller.signal.aborted) {
          /* 네트워크 오류는 무시 */
        }
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceCategory.orderingSubjectType, props.counterpartyBusinessRegistrationNo]);

  // 발주 주체 구분별 대상사업장 추가(소속 법인·모회사 / 위탁운영사는 검증 후 추가).
  const addTargetFacility = async (facility: FacilitySearchItem) => {
    if (
      serviceCategory.orderingSubjectType === ORDERING_SUBJECT_PARENT_CORP ||
      serviceCategory.orderingSubjectType === ORDERING_SUBJECT_CONSIGNED_OPERATOR
    ) {
      try {
        const res = await fetch(`/api/facilities/${encodeURIComponent(facility.facilityId)}`, { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const facilityDetail = await res.json();
        const result = validateOrderingTargetFacility(
          serviceCategory.orderingSubjectType,
          facilityDetail,
          props.counterpartyBusinessRegistrationNo
        );
        if (!result.ok) {
          toast.show(result.message ?? "대상사업장 검증에 실패했습니다.", "error");
          return;
        }
      } catch (err) {
        toast.show("대상사업장 검증 실패: " + (err as Error).message, "error");
        return;
      }
    }
    setServiceCategory((prev) => ({ ...prev, targetFacilities: [...prev.targetFacilities, facility] }));
    setFacilityQuery("");
  };

  const submit = async () => {
    setSaving(true);
    try {
      let nextServiceCategory = serviceCategory;
      if (
        serviceCategory.orderingSubjectType === ORDERING_SUBJECT_SITE_DIRECT &&
        serviceCategory.targetFacilities.length === 0
      ) {
        const match = await findFacilityByBusinessRegistrationNo(props.counterpartyBusinessRegistrationNo);
        if (!match) {
          toast.show("계약상대 업체와 일치하는 사업장을 찾지 못했습니다. 사업장 마스터의 사업자번호를 확인하세요.", "error");
          setSaving(false);
          return;
        }
        nextServiceCategory = { ...serviceCategory, targetFacilities: [match] };
        setServiceCategory(nextServiceCategory);
      }

      const payload: ContractChangePayload = {
        amounts,
        servicePeriod,
        paymentTerms,
        serviceCategory: nextServiceCategory,
        closing,
        termination: lifecycle,
        outsourcing,
        meta,
      };
      const changedFields: string[] = [];
      const initialFacilityKey = props.initialTargetFacilities.map((item) => item.facilityId).sort().join("|");
      const nextFacilityKey = nextServiceCategory.targetFacilities.map((item) => item.facilityId).sort().join("|");
      if (amounts.some((a) => a.nextAmount !== "")) changedFields.push("amounts");
      if (servicePeriod.next) changedFields.push("servicePeriod");
      if (paymentTerms.some((t) => t.next !== "")) changedFields.push("paymentTerms");
      if (nextServiceCategory.changed || nextServiceCategory.nextType || nextServiceCategory.nextSubtype || nextServiceCategory.nextIndustry) changedFields.push("serviceCategory");
      if (nextServiceCategory.nextPaymentMethod) changedFields.push("paymentMethod");
      if (initialFacilityKey !== nextFacilityKey) changedFields.push("targetFacilities");
      const initialOrderingSubjectType = props.initialOrderingSubjectType ?? "";
      const orderingSubjectChanged = nextServiceCategory.orderingSubjectType !== initialOrderingSubjectType;
      if (orderingSubjectChanged) changedFields.push("orderingSubjectType");
      if (closing.completionDate || closing.permitAcquiredAt || closing.etc) changedFields.push("closing");
      if (lifecycle.terminatedAt || lifecycle.suspendedAt) changedFields.push("termination");
      if (outsourcing.outsourcingTitle) changedFields.push("outsourcing");
      const contractDateChanged = contractDate !== (props.contractDate ?? "");
      if (contractDateChanged) changedFields.push("contractDate");

      // 변경계약 저장 요청 본문. 계약 테이블을 갱신하는 필드는 "실제로 새 값이
      // 입력된 항목만" 포함한다. 빈 값/ null 을 보내면 서버(changes route)가
      // 기존 값을 null 로 덮어써 데이터가 유실되므로, 미입력 항목은 키 자체를 생략한다.
      const requestBody: Record<string, unknown> = {
        changedAt: meta.changedAt,
        previousAmount: previousAmountTotal || null,
        deltaAmount: newCurrentAmount != null && previousAmountTotal ? newCurrentAmount - previousAmountTotal : null,
        changedServicePeriod: servicePeriod.next || null,
        changedPaymentTerms: paymentTerms
          .filter((t) => t.next)
          .map((t) => `${t.stageLabel}: ${t.next}`)
          .join("\n") || null,
        detail: closing.etc || meta.memo || null,
        payload,
        changedFields,
      };
      if (newCurrentAmount != null) requestBody.newCurrentAmount = newCurrentAmount;
      if (contractDateChanged) requestBody.newContractDate = contractDate || null;
      const nextEndedAt = lifecycle.terminatedAt || closing.completionDate || servicePeriod.next;
      if (nextEndedAt) requestBody.newEndedAt = nextEndedAt;
      if (nextServiceCategory.nextType.trim()) requestBody.newServiceType = nextServiceCategory.nextType.trim();
      if (nextServiceCategory.nextSubtype.trim()) requestBody.newServiceSubtype = nextServiceCategory.nextSubtype.trim();
      if (nextServiceCategory.nextIndustry.trim()) requestBody.newIndustryCategory = nextServiceCategory.nextIndustry.trim();
      if (nextServiceCategory.nextPaymentMethod.trim()) requestBody.newPaymentMethod = nextServiceCategory.nextPaymentMethod.trim();
      if (initialFacilityKey !== nextFacilityKey) {
        requestBody.newFacilityIds = nextServiceCategory.targetFacilities.map((item) => item.facilityId);
      }
      if (orderingSubjectChanged) {
        requestBody.newOrderingSubjectType = nextServiceCategory.orderingSubjectType;
      }
      if (lifecycle.terminatedAt) {
        requestBody.contractTerminatedAt = lifecycle.terminatedAt;
        requestBody.contractTerminationReason = lifecycle.terminationReason;
      }
      if (lifecycle.suspendedAt) {
        requestBody.contractSuspendedAt = lifecycle.suspendedAt;
        requestBody.contractSuspensionReason = lifecycle.suspensionReason;
      }

      const res = await fetch(`/api/contracts/${encodeURIComponent(props.contractId)}/changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }

      // After the change event is recorded, optionally attach an amendment
      // PDF. Failure here is a soft error — the change event itself is
      // already saved, so we only surface a warning and let the user retry
      // the upload from the detail panel.
      if (amendmentFile) {
        try {
          const created = (await res.json().catch(() => ({}))) as { changeId?: string };
          const docForm = new FormData();
          docForm.set("documentType", "amendment");
          docForm.set("documentDate", meta.changedAt);
          if (created.changeId) docForm.set("changeEventId", created.changeId);
          docForm.set("file", amendmentFile);
          const docRes = await fetch(
            `/api/contracts/${encodeURIComponent(props.contractId)}/documents`,
            { method: "POST", body: docForm }
          );
          if (!docRes.ok) {
            const body = await docRes.json().catch(() => ({}));
            throw new Error(body?.error ?? "HTTP " + docRes.status);
          }
        } catch (uploadErr) {
          toast.show("변경계약서 PDF 업로드 실패: " + (uploadErr as Error).message, "error");
        }
      }

      if (outsourcing.outsourcingTitle.trim()) {
        const outsourcingForm = new FormData();
        outsourcingForm.set("outsourcingTitle", outsourcing.outsourcingTitle);
        outsourcingForm.set("counterpartyName", outsourcing.counterpartyName);
        outsourcingForm.set("serviceType", outsourcing.serviceType);
        outsourcingForm.set("contractDate", outsourcing.contractDate);
        outsourcingForm.set("endedAt", outsourcing.endedAt);
        outsourcingForm.set("amount", outsourcing.amount);
        outsourcingForm.set("memo", outsourcing.memo);
        const file = outsourcingFileRef.current;
        if (file) outsourcingForm.set("file", file);
        const outsourcingRes = await fetch(`/api/contracts/${encodeURIComponent(props.contractId)}/outsourcing`, {
          method: "POST",
          body: outsourcingForm,
        });
        if (!outsourcingRes.ok) {
          const body = await outsourcingRes.json().catch(() => ({}));
          throw new Error(body?.error ?? "외주 용역 저장 실패");
        }
      }

      toast.show("변경계약이 저장되었습니다.", "success");
      props.onSaved();
    } catch (err) {
      toast.show("저장 실패: " + (err as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-950/20 flex items-center justify-center p-4">
      <div className="cd-card rounded-3xl w-[min(880px,calc(100vw-32px))] max-h-[min(840px,calc(100vh-32px))] shadow-2xl flex flex-col overflow-hidden">
        <div className="p-5 border-b cd-border-c flex items-start justify-between gap-4">
          <div>
            <h3 className="text-xl font-bold cd-text">{props.contractTitle}</h3>
            <p className="text-xs cd-text-faint mt-1">{props.counterpartyName} · 계약일 {props.contractDate ?? "-"}</p>
          </div>
          <button type="button" onClick={props.onClose} className="cd-text-faint hover:opacity-70">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pt-3 grid grid-cols-3 gap-2 text-xs">
          <label className="grid gap-1">
            <span className="font-bold cd-text-faint">계약일</span>
            <input type="date" value={contractDate} onChange={(e) => setContractDate(e.target.value)} className="cd-input" />
          </label>
          <label className="grid gap-1">
            <span className="font-bold cd-text-faint">입력일</span>
            <input type="date" value={meta.enteredAt} onChange={(e) => setMeta({ ...meta, enteredAt: e.target.value })} className="cd-input" />
          </label>
          <label className="grid gap-1">
            <span className="font-bold cd-text-faint">변경일</span>
            <input type="date" value={meta.changedAt} onChange={(e) => setMeta({ ...meta, changedAt: e.target.value })} className="cd-input" />
          </label>
        </div>

        <div className="px-5 mt-4 flex gap-1 border-b cd-border-c">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={
                "px-3 py-2 text-xs font-bold rounded-t-lg " +
                (activeTab === tab.key
                  ? "cd-fill-primary text-white shadow-sm"
                  : "cd-surface-bg cd-text-muted hover:bg-[color:var(--cd-surface)]")
              }
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-5 h-[440px] overflow-y-auto scrollbar-hide">
          {activeTab === "amount" && (
            <div className="grid gap-2">
              <div className="grid grid-cols-[1fr_140px_140px] gap-2 text-[11px] font-bold cd-text-faint">
                <span>단계</span>
                <span className="text-right">기존 금액</span>
                <span className="text-right">변경 금액</span>
              </div>
              {amounts.map((row, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_140px_140px] gap-2 items-center">
                  <input type="text" className="cd-input" value={row.stageLabel}
                    onChange={(e) => updateAt(amounts, setAmounts, idx, { stageLabel: e.target.value })} />
                  <input className="cd-input tabular-nums text-right" inputMode="numeric" value={formatThousands(row.previousAmount)}
                    onChange={(e) => updateAt(amounts, setAmounts, idx, { previousAmount: stripDigits(e.target.value) })} />
                  <input className="cd-input tabular-nums text-right" inputMode="numeric" value={formatThousands(row.nextAmount)}
                    onChange={(e) => updateAt(amounts, setAmounts, idx, { nextAmount: stripDigits(e.target.value) })} />
                </div>
              ))}
              <div className="flex justify-end gap-2 mt-2">
                <button type="button" onClick={() => setAmounts([...amounts, { stageLabel: `${amounts.length + 1}차`, previousAmount: "", nextAmount: "" }])}
                  className="cd-btn cd-btn-ghost rounded-lg px-3 py-1.5 text-[11px] font-bold cd-text-muted">+ 단계 추가</button>
                <button type="button" onClick={() => setAmounts(amounts.slice(0, -1))} disabled={amounts.length === 0}
                  className="cd-btn cd-btn-ghost rounded-lg px-3 py-1.5 text-[11px] font-bold cd-text-muted disabled:opacity-50">- 단계 삭제</button>
              </div>
              <p className="text-[11px] cd-text-faint mt-2">
                기존 합계 {previousAmountTotal.toLocaleString()} → 변경 합계 {(newCurrentAmount ?? 0).toLocaleString()}
              </p>
            </div>
          )}

          {activeTab === "period" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm">
                <span className="font-bold cd-text-muted">기존 준공기한</span>
                <input type="date" className="cd-input" value={servicePeriod.previous}
                  onChange={(e) => setServicePeriod({ ...servicePeriod, previous: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-bold cd-text-muted">변경 준공기한</span>
                <input type="date" className="cd-input" value={servicePeriod.next}
                  onChange={(e) => setServicePeriod({ ...servicePeriod, next: e.target.value })} />
              </label>
            </div>
          )}

          {activeTab === "terms" && (
            <div className="grid gap-2">
              <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 text-[11px] font-bold cd-text-faint">
                <span>단계</span>
                <span>기존 지급조건</span>
                <span>변경 지급조건</span>
              </div>
              {paymentTerms.map((row, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_1fr_1fr] gap-2 items-center">
                  <input type="text" className="cd-input" value={row.stageLabel}
                    onChange={(e) => updateAt(paymentTerms, setPaymentTerms, idx, { stageLabel: e.target.value })} />
                  <input type="text" className="cd-input" value={row.previous}
                    onChange={(e) => updateAt(paymentTerms, setPaymentTerms, idx, { previous: e.target.value })} />
                  <input type="text" className="cd-input" value={row.next}
                    onChange={(e) => updateAt(paymentTerms, setPaymentTerms, idx, { next: e.target.value })} />
                </div>
              ))}
            </div>
          )}

          {activeTab === "service" && (
            <div className="grid gap-3">
              <p className="text-[11px] cd-text-faint">변경할 항목만 입력하세요. 입력한 항목만 계약 정보에 반영되며, 비워 둔 항목은 기존 값이 유지됩니다.</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm">
                  <span className="font-bold cd-text-muted">기존 대분류</span>
                  <input type="text" disabled className="cd-input disabled:opacity-60"
                    value={serviceCategory.previousType} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-bold cd-text-muted">기존 세분류</span>
                  <input type="text" disabled className="cd-input disabled:opacity-60"
                    value={serviceCategory.previousSubtype} />
                </label>
                <label className="grid gap-1 text-sm col-span-2">
                  <span className="font-bold cd-text-muted">기존 업종</span>
                  <input type="text" disabled className="cd-input disabled:opacity-60"
                    value={serviceCategory.previousIndustry} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-bold cd-text-muted">변경 대분류</span>
                  <input type="text" className="cd-input"
                    value={serviceCategory.nextType}
                    onChange={(e) => setServiceCategory({ ...serviceCategory, nextType: e.target.value })} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-bold cd-text-muted">변경 세분류</span>
                  <input type="text" className="cd-input"
                    value={serviceCategory.nextSubtype}
                    onChange={(e) => setServiceCategory({ ...serviceCategory, nextSubtype: e.target.value })} />
                </label>
                <div className="grid gap-1 text-sm col-span-2">
                  <span className="font-bold cd-text-muted">변경 업종</span>
                  <div className="flex items-center gap-2">
                    <select className="cd-select min-w-0 flex-1"
                      value={serviceCategory.nextIndustry}
                      onChange={(e) => setServiceCategory({ ...serviceCategory, nextIndustry: e.target.value })}>
                      <option value="">업종 선택</option>
                      {industryOptions.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                    <IndustryOptionsEditorButton options={industryOptions} onOptionsChange={setIndustryOptions} />
                  </div>
                </div>
                <label className="grid gap-1 text-sm">
                  <span className="font-bold cd-text-muted">기존 대금 지급 방식</span>
                  <input type="text" disabled className="cd-input disabled:opacity-60" value={serviceCategory.previousPaymentMethod} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-bold cd-text-muted">변경 대금 지급 방식</span>
                  <select
                    className="cd-select"
                    value={serviceCategory.nextPaymentMethod}
                    onChange={(e) => setServiceCategory({ ...serviceCategory, nextPaymentMethod: e.target.value })}
                  >
                    <option value="">변경 없음</option>
                    {PAYMENT_METHOD_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-bold cd-text-muted">발주 주체 구분</span>
                  <select
                    className="cd-select"
                    value={serviceCategory.orderingSubjectType}
                    onChange={(e) =>
                      setServiceCategory({ ...serviceCategory, orderingSubjectType: e.target.value, targetFacilities: [] })
                    }
                  >
                    {ORDERING_SUBJECT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <span className="text-[11px] cd-text-faint">대상사업장 기준, 실제 계약 체결 주체와의 관계</span>
                </label>
                <div className="grid gap-1 text-sm col-span-2 relative">
                  <span className="font-bold cd-text-muted">{`대상사업장(${props.initialServiceType || "용역"})`}</span>
                  <input
                    className="cd-input disabled:opacity-60"
                    placeholder={
                      serviceCategory.orderingSubjectType === ORDERING_SUBJECT_SITE_DIRECT
                        ? "계약상대 업체 기준 자동 입력"
                        : "사업장명, 주소, 사업자번호 검색"
                    }
                    disabled={serviceCategory.orderingSubjectType === ORDERING_SUBJECT_SITE_DIRECT}
                    value={facilityQuery}
                    onChange={(e) => setFacilityQuery(e.target.value)}
                  />
                  {serviceCategory.targetFacilities.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {serviceCategory.targetFacilities.map((facility) => (
                        <span key={facility.facilityId} className="inline-flex items-center gap-1 rounded-full cd-tint-primary px-2.5 py-1 text-xs cd-text-primary">
                          {facility.companyName}
                          <button
                            type="button"
                            className="cd-text-primary hover:text-[color:var(--cd-primary)]"
                            onClick={() =>
                              setServiceCategory({
                                ...serviceCategory,
                                targetFacilities: serviceCategory.targetFacilities.filter((item) => item.facilityId !== facility.facilityId),
                              })
                            }
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  {serviceCategory.orderingSubjectType !== ORDERING_SUBJECT_SITE_DIRECT && facilityOptions.length > 0 && (
                    <div className="absolute z-10 top-[70px] left-0 right-0 rounded-xl border cd-border-c cd-card-bg shadow-lg max-h-56 overflow-y-auto">
                      {facilityOptions
                        .filter((facility) => !serviceCategory.targetFacilities.some((selected) => selected.facilityId === facility.facilityId))
                        .map((facility) => (
                          <button
                            key={facility.facilityId}
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-[color:var(--cd-surface)]"
                            onClick={() => addTargetFacility(facility)}
                          >
                            <span className="cd-text">{facility.companyName}</span>
                            <span className="ml-2 text-xs cd-text-faint">{facility.businessRegistrationNo ?? ""}</span>
                            {facility.siteAddress && <p className="text-xs cd-text-faint mt-0.5 truncate">{facility.siteAddress}</p>}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "outsourcing" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm col-span-2">
                <span className="font-bold cd-text-muted">외주 계약명</span>
                <input className="cd-input" value={outsourcing.outsourcingTitle}
                  onChange={(e) => setOutsourcing({ ...outsourcing, outsourcingTitle: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm col-span-2">
                <span className="font-bold cd-text-muted">계약상대 업체</span>
                <input className="cd-input" value={outsourcing.counterpartyName}
                  onChange={(e) => setOutsourcing({ ...outsourcing, counterpartyName: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-bold cd-text-muted">용역분류</span>
                <select className="cd-select max-w-[220px]" value={outsourcing.serviceType}
                  onChange={(e) => setOutsourcing({ ...outsourcing, serviceType: e.target.value })}>
                  {outsourcingTypes.map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </label>
              <div className="flex items-end justify-start gap-2">
                <button type="button" className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs cd-text-muted"
                  onClick={() => {
                    const next = prompt("추가할 외주 용역 분류명을 입력하세요.");
                    if (!next?.trim()) return;
                    setOutsourcingTypes((prev) => prev.includes(next.trim()) ? prev : [...prev, next.trim()]);
                    setOutsourcing({ ...outsourcing, serviceType: next.trim() });
                  }}>
                  분류 추가
                </button>
                <button type="button" className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs text-rose-600"
                  onClick={() => {
                    if (outsourcingTypes.length <= 1) return;
                    const next = outsourcingTypes.filter((type) => type !== outsourcing.serviceType);
                    setOutsourcingTypes(next);
                    setOutsourcing({ ...outsourcing, serviceType: next[0] ?? "" });
                  }}>
                  삭제
                </button>
              </div>
              <label className="grid gap-1 text-sm">
                <span className="font-bold cd-text-muted">계약금액</span>
                <input className="cd-input tabular-nums" inputMode="numeric" value={formatThousands(outsourcing.amount)}
                  onChange={(e) => setOutsourcing({ ...outsourcing, amount: stripDigits(e.target.value) })} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-bold cd-text-muted">계약일</span>
                <input type="date" className="cd-input" value={outsourcing.contractDate}
                  onChange={(e) => setOutsourcing({ ...outsourcing, contractDate: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-bold cd-text-muted">준공일</span>
                <input type="date" className="cd-input" value={outsourcing.endedAt}
                  onChange={(e) => setOutsourcing({ ...outsourcing, endedAt: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm col-span-2">
                <span className="font-bold cd-text-muted">메모</span>
                <textarea className="cd-input min-h-[80px]" value={outsourcing.memo}
                  onChange={(e) => setOutsourcing({ ...outsourcing, memo: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm col-span-2">
                <span className="font-bold cd-text-muted">외주 계약서 PDF</span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:cd-fill-primary file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    outsourcingFileRef.current = file;
                    setOutsourcingFileName(file?.name ?? "");
                  }}
                />
                {outsourcingFileName && <span className="text-[11px] cd-text-faint">선택됨: {outsourcingFileName}</span>}
              </label>
            </div>
          )}

          {activeTab === "lifecycle" && (
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm">
                <span className="font-bold cd-text-muted">계약해지일</span>
                <input type="date" className="cd-input" value={lifecycle.terminatedAt}
                  onChange={(e) => setLifecycle({ ...lifecycle, terminatedAt: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-bold cd-text-muted">해지 사유</span>
                <select className="cd-select" value={lifecycle.terminationReason}
                  onChange={(e) => setLifecycle({ ...lifecycle, terminationReason: e.target.value })}>
                  {terminationReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              <ListEditorButtons
                label="해지 사유"
                options={terminationReasons}
                value={lifecycle.terminationReason}
                onOptions={setTerminationReasons}
                onValue={(terminationReason) => setLifecycle({ ...lifecycle, terminationReason })}
              />
              <label className="grid gap-1 text-sm">
                <span className="font-bold cd-text-muted">계약중지일</span>
                <input type="date" className="cd-input" value={lifecycle.suspendedAt}
                  onChange={(e) => setLifecycle({ ...lifecycle, suspendedAt: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-bold cd-text-muted">계약 중지 사유</span>
                <select className="cd-select" value={lifecycle.suspensionReason}
                  onChange={(e) => setLifecycle({ ...lifecycle, suspensionReason: e.target.value })}>
                  {suspensionReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              <ListEditorButtons
                label="중지 사유"
                options={suspensionReasons}
                value={lifecycle.suspensionReason}
                onOptions={setSuspensionReasons}
                onValue={(suspensionReason) => setLifecycle({ ...lifecycle, suspensionReason })}
              />
            </div>
          )}

          {activeTab === "closing" && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1 text-sm">
                  <span className="font-bold cd-text-muted">준공일</span>
                  <input type="date" className="cd-input" value={closing.completionDate}
                    onChange={(e) => setClosing({ ...closing, completionDate: e.target.value })} />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-bold cd-text-muted">허가 취득일</span>
                  <input type="date" className="cd-input" value={closing.permitAcquiredAt}
                    onChange={(e) => setClosing({ ...closing, permitAcquiredAt: e.target.value })} />
                </label>
              </div>
              <label className="grid gap-1 text-sm">
                <span className="font-bold cd-text-muted">기타 변경사항</span>
                <textarea className="cd-input min-h-[80px]"
                  value={closing.etc} onChange={(e) => setClosing({ ...closing, etc: e.target.value })} />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="font-bold cd-text-muted">변경계약서 PDF (선택)</span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:cd-fill-primary file:px-3 file:py-2 file:text-xs file:font-bold file:text-white"
                  onChange={(e) => setAmendmentFile(e.target.files?.[0] ?? null)}
                />
                <span className="text-[11px] cd-text-faint">
                  업로드 시 원 계약 폴더에 동일 형식(<code>(YYYY-MM-DD)계약명 변경계약서.pdf</code>)으로 저장됩니다.
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="p-5 border-t cd-border-c flex justify-between items-center gap-2">
          <p className="text-[11px] cd-text-faint">변경계약서 PDF는 &quot;준공일 및 기타&quot; 탭에서 첨부할 수 있습니다.</p>
          <div className="flex gap-2">
            <button type="button" onClick={props.onClose} className="cd-btn cd-btn-ghost rounded-xl px-4 py-2 text-sm font-bold cd-text-muted">
              닫기
            </button>
            <button type="button" onClick={submit} disabled={saving} className="rounded-xl px-4 py-2 text-sm font-bold text-white cd-fill-primary shadow-sm disabled:opacity-60">
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function updateAt<T>(list: T[], setter: (next: T[]) => void, idx: number, patch: Partial<T>) {
  const next = list.slice();
  next[idx] = { ...next[idx], ...patch };
  setter(next);
}

function formatThousands(value: string): string {
  const digits = stripDigits(value);
  if (!digits) return "";
  return Number(digits).toLocaleString("en-US");
}

function stripDigits(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

function ListEditorButtons({
  label,
  options,
  value,
  onOptions,
  onValue,
}: {
  label: string;
  options: string[];
  value: string;
  onOptions: (next: string[]) => void;
  onValue: (next: string) => void;
}) {
  return (
    <div className="col-span-2 flex justify-end gap-2">
      <button
        type="button"
        className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs cd-text-muted"
        onClick={() => {
          const next = prompt(`추가할 ${label}를 입력하세요.`);
          if (!next?.trim()) return;
          const trimmed = next.trim();
          onOptions(options.includes(trimmed) ? options : [...options, trimmed]);
          onValue(trimmed);
        }}
      >
        목록 추가
      </button>
      <button
        type="button"
        className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs text-rose-600"
        onClick={() => {
          if (options.length <= 1) return;
          const next = options.filter((item) => item !== value);
          onOptions(next);
          onValue(next[0] ?? "");
        }}
      >
        선택 삭제
      </button>
    </div>
  );
}
