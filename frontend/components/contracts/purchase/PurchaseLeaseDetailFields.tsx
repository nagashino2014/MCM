"use client";

import { ExternalLink, FileText, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { AutoDateInput } from "@/components/ui/AutoDateInput";
import { AmountInput } from "@/components/ui/AmountInput";
import { FileDropZone } from "@/components/ui/FileDropZone";
import { VEHICLE_OWNERSHIP_LABELS, type VehicleOwnership } from "@/lib/assets/types";
import { COPIER_LOCATIONS, COPIER_MAKERS, LEASE_SPECIAL_TERMS_MAX, PURIFIER_LOCATIONS, PURIFIER_MAKERS } from "@/lib/contracts/purchase/options";
import {
  emptyDevice,
  emptyRealEstate,
  emptyVehicle,
  typeDetailKeyFor,
  type DeviceRentalDetail,
  type PurchaseTypeDetails,
  type RealEstateDetail,
  type VehicleDetail,
} from "@/lib/contracts/purchase/type-details";

/**
 * 임대 계약 분류 탭(333, 2026-11-03 사용자 요청) — 부동산 임대 / 차량 렌트 / 복합기 렌트 / 비데·정수기 렌트.
 * 차량 렌트는 자산관리 차량 추가 모달(components/assets/AssetBoard.tsx VehicleDetailModal)의 항목을 그대로 두고,
 * 차량 등록증은 이 탭에서 올린다(렌트 계약서 PDF 는 계약서 PDF 탭).
 */
export function PurchaseLeaseDetailFields({
  category,
  value,
  onChange,
  registrationFile,
  onRegistrationFile,
  existingRegistration,
  linkedAssetId,
}: {
  category: string;
  value: PurchaseTypeDetails;
  onChange: (next: PurchaseTypeDetails) => void;
  /** 차량 등록증(신규 모달은 저장 뒤 올리므로 파일을 들고 있다). */
  registrationFile?: File | null;
  onRegistrationFile?: (file: File | null) => void;
  /** 이미 올라간 등록증(변경계약 모달). */
  existingRegistration?: { name: string; path: string } | null;
  linkedAssetId?: string | null;
}) {
  const key = typeDetailKeyFor("lease", category);
  if (key === "realEstate") return <RealEstateFields value={value.realEstate ?? emptyRealEstate()} onChange={(realEstate) => onChange({ realEstate })} />;
  if (key === "vehicle")
    return (
      <VehicleFields
        value={value.vehicle ?? emptyVehicle()}
        onChange={(vehicle) => onChange({ vehicle })}
        registrationFile={registrationFile ?? null}
        onRegistrationFile={onRegistrationFile}
        existingRegistration={existingRegistration ?? null}
        linkedAssetId={linkedAssetId ?? null}
      />
    );
  if (key === "copier")
    return <DeviceFields label="복합기" makers={COPIER_MAKERS} locations={COPIER_LOCATIONS} value={value.copier ?? emptyDevice()} onChange={(copier) => onChange({ copier })} />;
  if (key === "waterPurifier")
    return <DeviceFields label="기기" makers={PURIFIER_MAKERS} locations={PURIFIER_LOCATIONS} value={value.waterPurifier ?? emptyDevice()} onChange={(waterPurifier) => onChange({ waterPurifier })} />;
  return <p className="text-xs cd-text-faint">이 분류에는 추가 상세 항목이 없습니다.</p>;
}

function Field({ label, children, hint, span }: { label: string; children: React.ReactNode; hint?: string; span?: boolean }) {
  return (
    <label className={"grid gap-1 text-sm content-start " + (span ? "col-span-2" : "")}>
      <span className="font-semibold cd-text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] cd-text-faint">{hint}</span>}
    </label>
  );
}

const numStr = (v: number | null) => (v == null ? "" : String(v));
const toNum = (v: string): number | null => (v === "" ? null : Number(v));

function RealEstateFields({ value, onChange }: { value: RealEstateDetail; onChange: (v: RealEstateDetail) => void }) {
  const set = (patch: Partial<RealEstateDetail>) => onChange({ ...value, ...patch });
  const terms = value.specialTerms;
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="임대계약명" span>
        <input className="cd-input" value={value.leaseTitle} onChange={(e) => set({ leaseTitle: e.target.value })} placeholder="예: 골드타워 1202호 사무실 임대차" />
      </Field>
      <Field label="물건 소재지" span>
        <input className="cd-input" value={value.propertyAddress} onChange={(e) => set({ propertyAddress: e.target.value })} placeholder="주소·동·호수" />
      </Field>
      <Field label="임대기간 시작">
        <AutoDateInput className="cd-input tabular-nums" value={value.leaseFrom} onChange={(leaseFrom) => set({ leaseFrom })} />
      </Field>
      <Field label="임대기간 종료">
        <AutoDateInput className="cd-input tabular-nums" value={value.leaseTo} onChange={(leaseTo) => set({ leaseTo })} />
      </Field>
      <Field label="총 면적(㎡)">
        <input className="cd-input tabular-nums text-right" inputMode="decimal" value={numStr(value.areaTotal)} onChange={(e) => set({ areaTotal: toNum(e.target.value.replace(/[^0-9.]/g, "")) })} />
      </Field>
      <Field label="전용 면적(㎡)">
        <input className="cd-input tabular-nums text-right" inputMode="decimal" value={numStr(value.areaExclusive)} onChange={(e) => set({ areaExclusive: toNum(e.target.value.replace(/[^0-9.]/g, "")) })} />
      </Field>
      <Field label="임대료(원/월)">
        <AmountInput className="cd-input tabular-nums text-right" value={numStr(value.monthlyRent)} onChange={(v) => set({ monthlyRent: toNum(v) })} />
      </Field>
      <Field label="보증금(원)">
        <AmountInput className="cd-input tabular-nums text-right" value={numStr(value.deposit)} onChange={(v) => set({ deposit: toNum(v) })} />
      </Field>
      <div className="col-span-2 grid gap-1 text-sm">
        <span className="font-semibold cd-text-muted">특약사항</span>
        {terms.length === 0 && <span className="text-[11px] cd-text-faint">오른쪽 + 로 특약을 하나씩 추가합니다(최대 {LEASE_SPECIAL_TERMS_MAX}개).</span>}
        {terms.map((t, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[11px] cd-text-faint w-5 shrink-0">{i + 1}.</span>
            <input
              className="cd-input flex-1"
              value={t}
              onChange={(e) => set({ specialTerms: terms.map((x, j) => (j === i ? e.target.value : x)) })}
              placeholder="특약 내용"
            />
            <button type="button" className="rounded-lg p-1.5 cd-text-faint hover:cd-error-text" title="삭제" onClick={() => set({ specialTerms: terms.filter((_, j) => j !== i) })}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <div className="flex justify-end">
          <button
            type="button"
            className="cd-btn cd-btn-ghost cd-btn-sm inline-flex items-center gap-1"
            disabled={terms.length >= LEASE_SPECIAL_TERMS_MAX}
            onClick={() => set({ specialTerms: [...terms, ""] })}
            title={terms.length >= LEASE_SPECIAL_TERMS_MAX ? `최대 ${LEASE_SPECIAL_TERMS_MAX}개` : "특약 추가"}
          >
            <Plus className="w-3.5 h-3.5" /> 특약 추가
          </button>
        </div>
      </div>
    </div>
  );
}

function VehicleFields({
  value,
  onChange,
  registrationFile,
  onRegistrationFile,
  existingRegistration,
  linkedAssetId,
}: {
  value: VehicleDetail;
  onChange: (v: VehicleDetail) => void;
  registrationFile: File | null;
  onRegistrationFile?: (file: File | null) => void;
  existingRegistration: { name: string; path: string } | null;
  linkedAssetId: string | null;
}) {
  const set = (patch: Partial<VehicleDetail>) => onChange({ ...value, ...patch });
  const isOwned = value.ownership === "owned";
  const isRentOrLease = value.ownership === "rent" || value.ownership === "lease";
  return (
    <div className="grid gap-3">
      <p className="text-xs cd-text-muted">
        자산관리의 차량 추가 항목과 같습니다. 저장하면 자산관리에 차량이 함께 등록되고 차량 등록증은 그 차량의 서류로 보관됩니다.
        {linkedAssetId && (
          <Link href={`/assets?asset=${encodeURIComponent(linkedAssetId)}`} className="ml-2 inline-flex items-center gap-1 cd-text-primary hover:underline" target="_blank">
            자산관리에서 보기 <ExternalLink className="w-3 h-3" />
          </Link>
        )}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="차종">
          <input className="cd-input" value={value.name} onChange={(e) => set({ name: e.target.value })} placeholder="니로 / K8" />
        </Field>
        <Field label="차량번호">
          <input className="cd-input" value={value.plateNo} onChange={(e) => set({ plateNo: e.target.value })} placeholder="12가3456" />
        </Field>
        <Field label="소유 유형">
          <select className="cd-select" value={value.ownership} onChange={(e) => set({ ownership: e.target.value as VehicleOwnership })}>
            {(Object.keys(VEHICLE_OWNERSHIP_LABELS) as VehicleOwnership[]).map((o) => (
              <option key={o} value={o}>{VEHICLE_OWNERSHIP_LABELS[o]}</option>
            ))}
          </select>
        </Field>
        <Field label="소유자" hint={isOwned ? "법인 소유는 자산관리에서 자동 입력됩니다." : undefined}>
          <input
            className="cd-input"
            value={value.ownerName}
            disabled={isOwned}
            placeholder={value.ownership === "rent" ? "렌터카 회사 명칭" : value.ownership === "lease" ? "리스사 명칭" : ""}
            onChange={(e) => set({ ownerName: e.target.value })}
          />
        </Field>
        <Field label="취득(계약)일">
          <AutoDateInput className="cd-input tabular-nums" value={value.acquiredAt} onChange={(acquiredAt) => set({ acquiredAt })} />
        </Field>
        <Field label="계약기간(개월)" hint={!isRentOrLease ? "장기 렌트·리스일 때만 입력합니다." : undefined}>
          <input
            className="cd-input tabular-nums text-right"
            inputMode="numeric"
            disabled={!isRentOrLease}
            value={numStr(value.contractMonths)}
            onChange={(e) => set({ contractMonths: toNum(e.target.value.replace(/\D/g, "")) })}
          />
        </Field>
        <Field label="반납(매각)일">
          <AutoDateInput className="cd-input tabular-nums" value={value.returnedAt} onChange={(returnedAt) => set({ returnedAt })} />
        </Field>
        <Field label="취득 가격(원)" hint={!isOwned ? "법인 소유일 때만 입력합니다." : undefined}>
          <AmountInput className="cd-input tabular-nums text-right" disabled={!isOwned} value={numStr(value.acquisitionPrice)} onChange={(v) => set({ acquisitionPrice: toNum(v) })} />
        </Field>
        <Field label="렌트(리스)료(원/월)" hint={!isRentOrLease ? "장기 렌트·리스일 때만 입력합니다." : undefined}>
          <AmountInput className="cd-input tabular-nums text-right" disabled={!isRentOrLease} value={numStr(value.monthlyFee)} onChange={(v) => set({ monthlyFee: toNum(v) })} />
        </Field>
        <Field label="설명(선택)">
          <input className="cd-input" value={value.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
      </div>
      <div className="grid gap-1 text-sm">
        <span className="font-semibold cd-text-muted">차량 등록증 PDF</span>
        {existingRegistration && (
          <a href={existingRegistration.path} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs cd-text-primary hover:underline">
            <FileText className="w-3.5 h-3.5" /> {existingRegistration.name}
            <span className="cd-text-faint">(새 파일을 올리면 교체됩니다)</span>
          </a>
        )}
        {onRegistrationFile ? (
          <FileDropZone value={registrationFile} onChange={onRegistrationFile} hint="차량 등록증 PDF 1개 · 30MB 이하 (렌트 계약서는 계약서 PDF 탭)" />
        ) : (
          <span className="text-[11px] cd-text-faint">등록증은 변경계약 입력에서 올립니다.</span>
        )}
      </div>
    </div>
  );
}

function DeviceFields({
  label,
  makers,
  locations,
  value,
  onChange,
}: {
  label: string;
  makers: readonly string[];
  locations: readonly string[];
  value: DeviceRentalDetail;
  onChange: (v: DeviceRentalDetail) => void;
}) {
  const set = (patch: Partial<DeviceRentalDetail>) => onChange({ ...value, ...patch });
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={`${label} 메이커`}>
        <select className="cd-select" value={value.maker} onChange={(e) => set({ maker: e.target.value })}>
          <option value="">선택</option>
          {makers.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </Field>
      <Field label={`${label} 모델명`}>
        <input className="cd-input" value={value.model} onChange={(e) => set({ model: e.target.value })} />
      </Field>
      <Field label="배치 장소">
        <select className="cd-select" value={value.location} onChange={(e) => set({ location: e.target.value })}>
          <option value="">선택</option>
          {locations.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </Field>
      <Field label="출금일자" hint="매월 출금되는 날(1~31)">
        <span className="flex items-center gap-1.5">
          <span className="text-xs cd-text-muted">매월</span>
          <input
            className="cd-input tabular-nums text-right"
            style={{ width: 80 }}
            inputMode="numeric"
            value={numStr(value.debitDay)}
            onChange={(e) => {
              const n = toNum(e.target.value.replace(/\D/g, ""));
              set({ debitDay: n != null ? Math.min(31, Math.max(1, n)) : null });
            }}
          />
          <span className="text-xs cd-text-muted">일</span>
        </span>
      </Field>
    </div>
  );
}
