"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadKsicMap, lookupKsicName } from "@/lib/ieps/ksic-lookup";
import { Pencil, Save, X, MapPin, Phone, Hash, Building2, FileText, Layers, ClipboardList, Trash2, Plus, History, Upload, Tags, Briefcase, FolderTree, ArrowRight, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import "@/components/cdash/cdash.css";
import type { AnnualReportSnapshot, FacilityDetail, PermitDetail, ProductOutput } from "@/lib/ieps/types-facility";
import { cleanProductName, dedupeIndustries, formatAddress, formatBusinessRegistrationNo, formatCompanyName, formatNumber, parseIndustriesFromValue } from "@/lib/ieps/formatters";
import {
  FACILITY_HISTORY_EVENT_LABELS,
  type FacilityHistoryEventType,
} from "@/lib/ieps/facility-legacy";
import {
  FACILITY_COMPANY_SIZE_LABELS,
  FACILITY_COMPANY_SIZE_ORDER,
  FACILITY_SERVICE_COLORS,
  FACILITY_SERVICE_LABELS,
  FACILITY_SERVICE_ORDER,
  type FacilityAlias,
  type FacilityCompanySize,
  type FacilityManualProduct,
  type FacilityServiceCategory,
} from "@/lib/ieps/facility-service";
import type {
  FacilityGroupCompanyRole,
  FacilityGroupMembershipRelationType,
  FacilityGroupTree,
} from "@/lib/ieps/facility-group";
import type { FacilityOperatingRelationType } from "@/lib/ieps/facility-operating-entity";
import { FacilityOrdersModal } from "@/components/facilities/FacilityOrdersModal";

const GROUP_COMPANY_ROLE_LABELS: Record<FacilityGroupCompanyRole, string> = {
  group_representative: "그룹 대표기업",
  affiliate: "그룹 소속 법인",
  other: "기타 법인",
};

const MEMBERSHIP_RELATION_LABELS: Record<FacilityGroupMembershipRelationType, string> = {
  site: "사업장 연결(기존)",
  operating_company: "운영 법인",
  owner_company: "소유 법인",
  other: "기타 관계",
};

const EDITABLE_MEMBERSHIP_RELATION_TYPES: FacilityGroupMembershipRelationType[] = [
  "operating_company",
  "owner_company",
  "other",
];

const OPERATING_RELATION_LABELS: Record<FacilityOperatingRelationType, string> = {
  operating_entity: "운영 주체",
  owner_entity: "소유 주체",
  manager_entity: "관리 주체",
  other: "기타 관계",
};

// 이력 추가 폼의 유형 체크박스(복수 선택). 인수/합병은 별도 체크박스로 분리 배치한다.
const HISTORY_TYPE_CHECKBOX_OPTIONS: FacilityHistoryEventType[] = [
  "company_name_change",
  "business_registration_no_change",
  "group_change",
  "site_address_change",
  "closure",
];

interface Props {
  facilityId: string | null;
  canEdit: boolean;
  onUpdated: () => void;
  onDeleted: () => void;
}

interface FacilityHistoryItem {
  id: number;
  facilityId: string;
  eventType: FacilityHistoryEventType;
  eventTypes: FacilityHistoryEventType[];
  eventDate: string | null;
  previousCompanyName: string | null;
  newCompanyName: string | null;
  previousBusinessRegistrationNo: string | null;
  newBusinessRegistrationNo: string | null;
  previousGroupName: string | null;
  newGroupName: string | null;
  previousSiteAddress: string | null;
  newSiteAddress: string | null;
  acquirerCompanyName: string | null;
  mergerTargetCompanyNames: string[];
  relatedCompanyName: string | null;
  sourceFacilityId: string | null;
  memo: string | null;
  source: string;
  createdAt: string;
}

interface FacilityContactDepartment {
  id: number;
  facilityId?: string;
  departmentName: string;
  phoneNumber: string | null;
  faxNumber: string | null;
  duties: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface FacilityContactPerson {
  id: number;
  facilityId?: string;
  departmentId: number | null;
  personName: string;
  title: string | null;
  officePhone: string | null;
  mobilePhone: string | null;
  email: string | null;
  duties: string | null;
  status: string;
  appointedAt: string | null;
  transferredAt: string | null;
  resignedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface FacilityContactLog {
  id: number;
  facilityId?: string;
  departmentId: number | null;
  personId: number | null;
  eventType: string;
  eventDate: string | null;
  memo: string | null;
  createdAt?: string;
}

interface FacilityContactMainNumber {
  facilityId?: string;
  phoneNumber: string | null;
  note: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export function FacilityDetailPanel({ facilityId, canEdit, onUpdated, onDeleted }: Props) {
  const [detail, setDetail] = useState<FacilityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyAnchor, setHistoryAnchor] = useState<{ top: number; left: number } | null>(null);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);

  const reload = useCallback(async () => {
    if (!facilityId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/facilities/" + facilityId, { cache: "no-store" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      const json = (await res.json()) as FacilityDetail;
      setDetail(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [facilityId]);

  useEffect(() => {
    setEditing(false);
    reload();
  }, [reload]);

  if (!facilityId) {
    return (
      <section className="cd-card rounded-3xl p-10 text-center cd-text-faint text-sm cd-reveal delay-2">
        좌측 목록에서 사업장을 선택하세요.
      </section>
    );
  }
  if (loading) {
    return (
      <section className="cd-card rounded-3xl p-10 text-center cd-text-faint text-sm cd-reveal delay-2">
        로딩 중…
      </section>
    );
  }
  if (error) {
    return (
      <section className="cd-card rounded-3xl p-10 text-center cd-error-text text-sm font-bold cd-reveal delay-2">
        조회 실패: {error}
      </section>
    );
  }
  if (!detail) {
    return (
      <section className="cd-card rounded-3xl p-10 text-center cd-text-faint text-sm cd-reveal delay-2">
        해당 사업장을 찾을 수 없습니다.
      </section>
    );
  }
  const hasIntegratedService =
    detail.serviceCategories.length === 0 || detail.serviceCategories.includes("integrated");

  return (
    <section className="cd-card rounded-3xl p-6 cd-reveal delay-2 flex flex-col gap-5 min-h-0 overflow-y-auto scrollbar-hide">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <LogoPreview path={detail.logoPath} label={detail.companyName} />
          <div className="min-w-0">
            <div className="text-[10px] font-bold cd-text-faint uppercase tracking-wide">
              FACILITY · {detail.source.toUpperCase()}
            </div>
            <h2 className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2 text-2xl font-bold cd-text">
              <span className="min-w-0 truncate">{formatCompanyName(detail.companyName)}</span>
              {detail.isClosed && (
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold leading-4 text-white"
                  style={{ backgroundColor: "#FF7979" }}
                >
                  폐업사업장
                </span>
              )}
            </h2>
            <div className="text-xs cd-text-faint mt-1">
              facility_id: <span className="font-mono">{detail.facilityId}</span>
            </div>
          </div>
        </div>
        {!editing && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOrdersOpen(true)}
              className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold cd-text-muted flex items-center gap-1"
            >
              <FolderTree className="w-3.5 h-3.5" /> 수주
            </button>
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const popoverWidth = Math.min(820, window.innerWidth - 32);
                    const popoverHeight = Math.min(820, window.innerHeight - 24);
                    const belowTop = rect.bottom + 8;
                    const aboveTop = rect.top - popoverHeight - 8;
                    const top =
                      belowTop + popoverHeight <= window.innerHeight - 16
                        ? belowTop
                        : Math.max(16, aboveTop);
                    setHistoryAnchor({
                      top,
                      left: Math.max(16, Math.min(rect.left, window.innerWidth - popoverWidth - 16)),
                    });
                    setHistoryOpen(true);
                  }}
                  className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold cd-text-muted flex items-center gap-1"
                >
                  <History className="w-3.5 h-3.5" /> 이력
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold cd-text-muted flex items-center gap-1"
                >
                  <Pencil className="w-3.5 h-3.5" /> 편집
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setDeleteConfirmOpen(true)}
                  className="rounded-xl px-3 py-2 text-xs font-bold cd-error-text cd-error-bg hover:cd-error-bg border border-red-200 flex items-center gap-1 disabled:opacity-60"
                >
                  <Trash2 className="w-3.5 h-3.5" /> 삭제
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {ordersOpen && (
        <FacilityOrdersModal
          facilityId={detail.facilityId}
          facilityName={formatCompanyName(detail.companyName) ?? detail.companyName}
          onClose={() => setOrdersOpen(false)}
        />
      )}

      {deleteConfirmOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4">
          <div className="cd-card rounded-3xl p-5 w-full max-w-md">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-lg font-bold cd-text">사업장 휴지통 이동</h3>
                <p className="text-sm cd-text-muted mt-2">
                  <span className="font-bold cd-text">{formatCompanyName(detail.companyName)}</span> 사업장을 휴지통으로 이동합니다.
                  관련 허가/생산품/연간보고 데이터는 보존되며, 목록에서는 제외됩니다.
                </p>
              </div>
              <button type="button" onClick={() => setDeleteConfirmOpen(false)} className="cd-btn cd-btn-ghost rounded-full p-2">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteConfirmOpen(false)} className="cd-btn cd-btn-ghost rounded-xl px-4 py-2 text-sm font-bold">
                취소
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    const res = await fetch("/api/facilities/" + detail.facilityId, {
                      method: "DELETE",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ deleteReason: "사용자 요청" }),
                    });
                    if (!res.ok) {
                      const body = await res.json().catch(() => ({}));
                      throw new Error(body?.error ?? "HTTP " + res.status);
                    }
                    setDeleteConfirmOpen(false);
                    onDeleted();
                  } catch (err) {
                    alert("삭제 실패: " + (err as Error).message);
                  } finally {
                    setDeleting(false);
                  }
                }}
                className="rounded-xl px-4 py-2 text-sm font-bold text-white cd-fill-error hover:opacity-90 disabled:opacity-60"
              >
                휴지통으로 이동
              </button>
            </div>
          </div>
        </div>
      )}

      {!editing ? (
        <ReadView detail={detail} onOpenContacts={() => setContactsOpen(true)} />
      ) : (
        <EditView
          detail={detail}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
            onUpdated();
          }}
        />
      )}
      <BusinessCertificatesSection
        detail={detail}
        canEdit={canEdit}
        onChanged={() => {
          reload();
          onUpdated();
        }}
      />

      {hasIntegratedService ? (
        <>
          <PermitsSection detail={detail} canEdit={canEdit} onChanged={() => { reload(); onUpdated(); }} />
          <AnnualReportSection
            facilityId={detail.facilityId}
            annualReport={detail.annualReport}
            canEdit={canEdit}
            onChanged={() => {
              reload();
              onUpdated();
            }}
          />
        </>
      ) : (
        <ManualProductsSection products={detail.manualProducts} />
      )}
      {historyOpen && (
        <FacilityHistoryModal
          facility={detail}
          canEdit={canEdit}
          anchor={historyAnchor}
          onClose={() => setHistoryOpen(false)}
          onChanged={() => {
            reload();
            onUpdated();
          }}
        />
      )}
      {contactsOpen && (
        <FacilityContactsModal
          facility={detail}
          canEdit={canEdit}
          onClose={() => setContactsOpen(false)}
        />
      )}
    </section>
  );
}

function formatGroupLabel(groupInfo: FacilityDetail["groupInfo"]): string {
  if (!groupInfo) return "";
  const company = formatCompanyName(groupInfo.company.companyName) ?? groupInfo.company.companyName;
  return `${groupInfo.group.groupName} · ${company} (${MEMBERSHIP_RELATION_LABELS[groupInfo.membership.relationType]})`;
}

function FacilityHistoryModal({
  facility,
  canEdit,
  anchor,
  onClose,
  onChanged,
}: {
  facility: FacilityDetail;
  canEdit: boolean;
  anchor: { top: number; left: number } | null;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { theme } = useCdashTheme();
  const [items, setItems] = useState<FacilityHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedTypes, setSelectedTypes] = useState<Set<FacilityHistoryEventType>>(new Set());
  const [eventDate, setEventDate] = useState("");
  const [previousCompanyName, setPreviousCompanyName] = useState("");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [previousBusinessRegistrationNo, setPreviousBusinessRegistrationNo] = useState("");
  const [newBusinessRegistrationNo, setNewBusinessRegistrationNo] = useState("");
  const [previousGroupName, setPreviousGroupName] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [previousSiteAddress, setPreviousSiteAddress] = useState("");
  const [newSiteAddress, setNewSiteAddress] = useState("");
  const [acquirerCompanyName, setAcquirerCompanyName] = useState("");
  const [mergerTargets, setMergerTargets] = useState<string[]>([""]);
  const [memo, setMemo] = useState("");
  const [mounted, setMounted] = useState(false);
  const [editingHistoryId, setEditingHistoryId] = useState<number | null>(null);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  // 모달 진입 시점에 적용되어 있던 계열/그룹(이전 값)을 1회 캡처한다.
  const [initialGroupLabel] = useState(() => formatGroupLabel(facility.groupInfo));

  // 사업장에 이미 존재하는 현재 값(이전 값 자동표시용).
  const currentCompanyName = formatCompanyName(facility.companyName) ?? facility.companyName ?? "";
  const currentBrn =
    formatBusinessRegistrationNo(facility.businessRegistrationNo) ?? facility.businessRegistrationNo ?? "";
  const currentSiteAddress = facility.siteAddress ?? "";

  const toggleType = (type: FacilityHistoryEventType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };
  const hasType = (type: FacilityHistoryEventType) => selectedTypes.has(type);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/facilities/" + facility.facilityId + "/history", {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      const json = (await res.json()) as { items: FacilityHistoryItem[] };
      setItems(json.items || []);
    } catch (err) {
      alert("이력 조회 실패: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [facility.facilityId]);

  useEffect(() => {
    setMounted(true);
    reload();
    // 신규 이력 입력 폼의 "이전" 값들을 현재 사업장 데이터로 초기화한다.
    setPreviousGroupName((prev) => (prev ? prev : initialGroupLabel));
    setPreviousCompanyName((prev) => (prev ? prev : currentCompanyName));
    setPreviousBusinessRegistrationNo((prev) => (prev ? prev : currentBrn));
    setPreviousSiteAddress((prev) => (prev ? prev : currentSiteAddress));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload]);

  const resetForm = () => {
    setEditingHistoryId(null);
    setSelectedTypes(new Set());
    setEventDate("");
    // 이전 값들은 현재 사업장 데이터를 자동으로 채운다(읽기 전용 표시).
    setPreviousCompanyName(currentCompanyName);
    setNewCompanyName("");
    setPreviousBusinessRegistrationNo(currentBrn);
    setNewBusinessRegistrationNo("");
    setPreviousGroupName(initialGroupLabel);
    setNewGroupName("");
    setPreviousSiteAddress(currentSiteAddress);
    setNewSiteAddress("");
    setAcquirerCompanyName("");
    setMergerTargets([""]);
    setMemo("");
  };

  const startEdit = (item: FacilityHistoryItem) => {
    setEditingHistoryId(item.id);
    setSelectedTypes(new Set(item.eventTypes?.length ? item.eventTypes : [item.eventType]));
    setEventDate(item.eventDate ?? "");
    setPreviousCompanyName(item.previousCompanyName ?? currentCompanyName);
    setNewCompanyName(item.newCompanyName ?? "");
    setPreviousBusinessRegistrationNo(item.previousBusinessRegistrationNo ?? currentBrn);
    setNewBusinessRegistrationNo(item.newBusinessRegistrationNo ?? "");
    setPreviousGroupName(item.previousGroupName ?? initialGroupLabel);
    setNewGroupName(item.newGroupName ?? "");
    setPreviousSiteAddress(item.previousSiteAddress ?? currentSiteAddress);
    setNewSiteAddress(item.newSiteAddress ?? "");
    setAcquirerCompanyName(item.acquirerCompanyName ?? "");
    setMergerTargets(item.mergerTargetCompanyNames?.length ? [...item.mergerTargetCompanyNames] : [""]);
    setMemo(item.memo ?? "");
  };

  const deleteHistory = async (item: FacilityHistoryItem) => {
    if (!window.confirm("이 사업장 이력 항목을 삭제할까요?")) return;
    try {
      const res = await fetch(
        "/api/facilities/" + facility.facilityId + "/history/" + item.id,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      if (editingHistoryId === item.id) resetForm();
      reload();
    } catch (err) {
      alert("이력 삭제 실패: " + (err as Error).message);
    }
  };

  const save = async () => {
    const cleanedMergerTargets = mergerTargets.map((target) => target.trim()).filter(Boolean);
    // 최소 한 가지 이력 유형(또는 인수/합병) 선택 필요 + 항목별 필수 입력값 검증.
    if (selectedTypes.size === 0) {
      alert("이력 유형을 한 가지 이상 선택하세요.");
      return;
    }
    if (hasType("company_name_change") && !newCompanyName.trim()) {
      alert("변경 상호를 입력하세요.");
      return;
    }
    if (hasType("business_registration_no_change") && !newBusinessRegistrationNo.trim()) {
      alert("변경 사업자번호를 입력하세요.");
      return;
    }
    if (hasType("group_change") && !newGroupName.trim()) {
      alert("변경 계열/그룹을 그룹 정보 모달에서 설정하세요.");
      return;
    }
    if (hasType("site_address_change") && !newSiteAddress.trim()) {
      alert("변경 소재지를 입력하세요.");
      return;
    }
    if (hasType("acquisition") && !acquirerCompanyName.trim()) {
      alert("인수 주체 기업명을 입력하세요.");
      return;
    }
    if (hasType("merger") && cleanedMergerTargets.length === 0) {
      alert("합병 대상 기업명을 한 곳 이상 입력하세요.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        "/api/facilities/" +
          facility.facilityId +
          "/history" +
          (editingHistoryId ? "/" + editingHistoryId : ""),
        {
          method: editingHistoryId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            eventTypes: Array.from(selectedTypes),
            eventDate: eventDate || null,
            previousCompanyName: hasType("company_name_change") ? previousCompanyName || null : null,
            newCompanyName: hasType("company_name_change") ? newCompanyName.trim() || null : null,
            previousBusinessRegistrationNo: hasType("business_registration_no_change")
              ? previousBusinessRegistrationNo || null
              : null,
            newBusinessRegistrationNo: hasType("business_registration_no_change")
              ? newBusinessRegistrationNo.trim() || null
              : null,
            previousGroupName: hasType("group_change") ? previousGroupName || null : null,
            newGroupName: hasType("group_change") ? newGroupName.trim() || null : null,
            previousSiteAddress: hasType("site_address_change") ? previousSiteAddress || null : null,
            newSiteAddress: hasType("site_address_change") ? newSiteAddress.trim() || null : null,
            acquirerCompanyName: hasType("acquisition") ? acquirerCompanyName.trim() || null : null,
            mergerTargetCompanyNames: hasType("merger") ? cleanedMergerTargets : [],
            memo: memo || null,
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      resetForm();
      reload();
      // 신규 이력 저장 시 사업장 본 레코드(상호/사업자번호/소재지)가 갱신될 수 있으므로 상세 패널을 새로고침한다.
      if (!editingHistoryId) onChanged?.();
    } catch (err) {
      alert("이력 저장 실패: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const top = anchor?.top ?? 96;
  const left = anchor?.left ?? 24;
  const modal = (
    <div
      className="cdash-vars cd-fields-white fixed z-50 w-[min(820px,calc(100vw-32px))] max-h-[min(820px,calc(100vh-24px))] overflow-y-auto scrollbar-hide rounded-3xl shadow-2xl"
      style={{ top, left }}
      data-theme={theme}
    >
      <div className="cd-card rounded-3xl p-6 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold cd-text flex items-center gap-2">
              <History className="w-5 h-5 cd-text-primary" /> 사업장 이력
            </h3>
            <p className="text-xs cd-text-faint mt-1">
              {formatCompanyName(facility.companyName)} · facility_id:{" "}
              <span className="font-mono">{facility.facilityId}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold cd-text-muted"
          >
            닫기
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {loading && <div className="text-sm cd-text-faint py-8 text-center">이력 조회 중…</div>}
          {!loading && items.length === 0 && (
            <div className="text-sm cd-text-faint py-8 text-center">
              등록된 사업장 이력이 없습니다.
            </div>
          )}
          {items.map((item) => (
            <div
              key={item.id}
              className={cn(
                "cd-surface-bg border rounded-xl p-3",
                editingHistoryId === item.id ? "border-[color:var(--cd-primary)]" : "cd-border-c"
              )}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex flex-wrap items-center gap-1">
                  {(item.eventTypes?.length ? item.eventTypes : [item.eventType]).map((type) => (
                    <span
                      key={type}
                      className="rounded-md cd-tint-primary cd-text-primary px-2 py-0.5 text-[11px] font-bold"
                    >
                      {FACILITY_HISTORY_EVENT_LABELS[type]}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-[11px] cd-text-faint">
                    {item.eventDate ?? item.createdAt.slice(0, 10)} · {item.source}
                  </div>
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(item)}
                        className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[10px] font-bold cd-text-muted"
                      >
                        편집
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteHistory(item)}
                        className="rounded-lg px-2 py-1 text-[10px] font-bold cd-error-text cd-error-bg border border-red-200"
                      >
                        삭제
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-xs cd-text-muted">
                <HistoryDiff label="상호" before={item.previousCompanyName} after={item.newCompanyName} />
                <HistoryDiff
                  label="사업자번호"
                  before={item.previousBusinessRegistrationNo}
                  after={item.newBusinessRegistrationNo}
                />
                <HistoryDiff label="계열/그룹" before={item.previousGroupName} after={item.newGroupName} />
                <HistoryDiff label="소재지" before={item.previousSiteAddress} after={item.newSiteAddress} />
                {item.acquirerCompanyName && (
                  <div>인수 주체: <b>{item.acquirerCompanyName}</b></div>
                )}
                {item.mergerTargetCompanyNames?.length > 0 && (
                  <div>합병 대상: <b>{item.mergerTargetCompanyNames.join(", ")}</b></div>
                )}
                {item.relatedCompanyName && (
                  <div>관련 업체: <b>{item.relatedCompanyName}</b></div>
                )}
              </div>
              {item.memo && <div className="text-xs cd-text-faint mt-2">{item.memo}</div>}
            </div>
          ))}
        </div>

        {canEdit && (
          <div className="border-t cd-border-c/70 pt-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold cd-text-muted">
                {editingHistoryId ? "이력 편집" : "이력 추가"}
              </h4>
              {editingHistoryId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[10px] font-bold cd-text-muted"
                >
                  새 이력 입력
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2 flex flex-col gap-1.5">
                <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">
                  이력 유형 (복수 선택)
                </span>
                <div className="flex flex-wrap gap-2 rounded-xl border cd-border-c cd-surface-bg p-2">
                  {HISTORY_TYPE_CHECKBOX_OPTIONS.map((type) => (
                    <label
                      key={type}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold cursor-pointer border select-none",
                        hasType(type)
                          ? "cd-tint-primary border-[color:var(--cd-primary)] cd-text-primary"
                          : "cd-card-bg cd-border-c cd-text-muted"
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={hasType(type)}
                        onChange={() => toggleType(type)}
                        className="accent-primary"
                      />
                      {FACILITY_HISTORY_EVENT_LABELS[type]}
                    </label>
                  ))}
                </div>
              </div>

              <FieldInput label="발생일" value={eventDate} onChange={setEventDate} />
              <div className="hidden sm:block" />

              <ReadonlyField label="이전 상호" value={previousCompanyName} />
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">변경 상호</span>
                <input
                  className="cd-input disabled:bg-[color:var(--cd-surface)] disabled:text-[color:var(--cd-faint)]"
                  value={newCompanyName}
                  disabled={!hasType("company_name_change")}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  placeholder={hasType("company_name_change") ? "변경 상호 입력" : "상호 변경 체크 시 입력"}
                />
              </div>

              <ReadonlyField label="이전 사업자번호" value={previousBusinessRegistrationNo} />
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">변경 사업자번호</span>
                <input
                  className="cd-input disabled:bg-[color:var(--cd-surface)] disabled:text-[color:var(--cd-faint)]"
                  value={newBusinessRegistrationNo}
                  disabled={!hasType("business_registration_no_change")}
                  onChange={(e) => setNewBusinessRegistrationNo(e.target.value)}
                  placeholder={
                    hasType("business_registration_no_change") ? "변경 사업자번호 입력" : "사업자번호 변경 체크 시 입력"
                  }
                />
              </div>

              <ReadonlyField label="이전 계열/그룹" value={previousGroupName} emptyText="연결된 계열/그룹 없음" />
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">변경 계열/그룹</span>
                <button
                  type="button"
                  disabled={!hasType("group_change")}
                  onClick={() => setGroupModalOpen(true)}
                  className="cd-input flex items-center justify-between gap-2 text-left hover:bg-[color:var(--cd-surface)] disabled:bg-[color:var(--cd-surface)] disabled:hover:bg-[color:var(--cd-surface)]"
                  title="그룹 정보 모달에서 계열/그룹을 재설정합니다."
                >
                  <span className={cn("truncate", newGroupName ? "cd-text font-bold" : "cd-text-faint")}>
                    {hasType("group_change")
                      ? newGroupName || "그룹 정보에서 재설정…"
                      : "계열/그룹 변경 체크 시 설정"}
                  </span>
                  <Briefcase className="w-4 h-4 cd-text-faint shrink-0" />
                </button>
              </div>

              <ReadonlyField label="이전 소재지" value={previousSiteAddress} />
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">변경 소재지</span>
                <input
                  className="cd-input disabled:bg-[color:var(--cd-surface)] disabled:text-[color:var(--cd-faint)]"
                  value={newSiteAddress}
                  disabled={!hasType("site_address_change")}
                  onChange={(e) => setNewSiteAddress(e.target.value)}
                  placeholder={hasType("site_address_change") ? "변경 소재지 입력" : "소재지 변경 체크 시 입력"}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">인수 / 합병</span>
                <div className="flex flex-col gap-2 rounded-xl border cd-border-c cd-surface-bg p-2.5">
                  <label className="flex items-center gap-1.5 text-xs font-bold cd-text-muted cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={hasType("acquisition")}
                      onChange={() => toggleType("acquisition")}
                      className="accent-primary"
                    />
                    인수
                  </label>
                  <label className="flex items-center gap-1.5 text-xs font-bold cd-text-muted cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={hasType("merger")}
                      onChange={() => toggleType("merger")}
                      className="accent-primary"
                    />
                    합병
                  </label>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {!hasType("acquisition") && !hasType("merger") && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">
                      인수 주체 / 합병 대상
                    </span>
                    <div className="cd-input cd-surface-bg cd-text-faint">인수 또는 합병 체크 시 입력</div>
                  </div>
                )}
                {hasType("acquisition") && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">인수 주체</span>
                    <CompanyKeywordInput
                      value={acquirerCompanyName}
                      onChange={setAcquirerCompanyName}
                      placeholder="인수 주체 기업명 검색"
                    />
                  </div>
                )}
                {hasType("merger") && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">합병 대상</span>
                    {mergerTargets.map((target, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_auto] gap-1.5 items-start">
                        <CompanyKeywordInput
                          value={target}
                          onChange={(v) =>
                            setMergerTargets((prev) => prev.map((item, itemIdx) => (itemIdx === idx ? v : item)))
                          }
                          placeholder={"합병 대상 " + (idx + 1) + " 검색"}
                        />
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => setMergerTargets((prev) => [...prev, ""])}
                            className="rounded-lg border cd-border-c cd-card-bg px-2 py-2 cd-text-muted hover:bg-[color:var(--cd-surface)]"
                            title="합병 대상 추가"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setMergerTargets((prev) =>
                                prev.length <= 1 ? [""] : prev.filter((_, itemIdx) => itemIdx !== idx)
                              )
                            }
                            className="rounded-lg border border-red-100 cd-error-bg px-2 py-2 cd-error-text hover:cd-error-bg"
                            title="합병 대상 삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="sm:col-span-2 flex flex-col gap-1.5">
                <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">
                  메모
                </span>
                <textarea className="cd-textarea" value={memo} onChange={(e) => setMemo(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-xl px-4 py-2 text-sm font-bold text-white cd-fill-primary disabled:opacity-60"
              >
                {saving ? "저장 중…" : editingHistoryId ? "이력 수정" : "이력 저장"}
              </button>
            </div>
          </div>
        )}
      </div>
      {groupModalOpen && (
        <GroupManagementModal
          facility={facility}
          onClose={() => setGroupModalOpen(false)}
          onChanged={(groupLabel) => {
            setGroupModalOpen(false);
            // 그룹 재설정은 group-membership API로 이미 사업장에 반영된 상태.
            // 이력 폼에는 변경 후 계열/그룹을 채우고, 유형에 계열/그룹 변경을 추가한다.
            if (groupLabel) {
              setNewGroupName(groupLabel);
              setSelectedTypes((prev) => new Set(prev).add("group_change"));
            }
            onChanged?.();
          }}
        />
      )}
    </div>
  );
  return mounted ? createPortal(modal, document.body) : null;
}

interface CompanyKeywordResult {
  facilityId: string;
  companyName: string;
  businessRegistrationNo: string | null;
}

// 사업장 마스터를 키워드로 검색해 기업명을 선택/입력하는 입력창(인수 주체·합병 대상용).
function CompanyKeywordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [results, setResults] = useState<CompanyKeywordResult[]>([]);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const q = value.trim();
    if (!focused || q.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: "8", sort: "name" });
        const res = await fetch("/api/facilities?" + params.toString(), {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as { items?: CompanyKeywordResult[] };
        setResults(json.items ?? []);
        setOpen(true);
      } catch {
        if (!controller.signal.aborted) setResults([]);
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, focused]);

  return (
    <div className="relative">
      <input
        className="cd-input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() =>
          setTimeout(() => {
            setOpen(false);
            setFocused(false);
          }, 150)
        }
      />
      {open && results.length > 0 && (
        <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto rounded-xl border cd-border-c cd-card-bg shadow-lg">
          {results.map((item) => (
            <button
              key={item.facilityId}
              type="button"
              className="block w-full text-left px-3 py-2 text-xs hover:bg-[color:var(--cd-surface)]"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(formatCompanyName(item.companyName) ?? item.companyName);
                setOpen(false);
              }}
            >
              <b className="cd-text">{formatCompanyName(item.companyName) ?? item.companyName}</b>
              {item.businessRegistrationNo && (
                <span className="cd-text-faint ml-2">{item.businessRegistrationNo}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function HistoryDiff({
  label,
  before,
  after,
}: {
  label: string;
  before: string | null;
  after: string | null;
}) {
  if (!before && !after) return null;
  return (
    <div>
      {label}: <span className="cd-text-faint">{before ?? "—"}</span>
      <span className="mx-1 cd-text-faint">→</span>
      <b>{after ?? "—"}</b>
    </div>
  );
}

// 이력 폼의 "이전" 값(읽기 전용) 표시 필드.
function ReadonlyField({
  label,
  value,
  emptyText = "—",
}: {
  label: string;
  value: string;
  emptyText?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">{label}</span>
      <div className="cd-input cd-surface-bg/70 cd-text-muted truncate" title={value || emptyText}>
        {value || emptyText}
      </div>
    </div>
  );
}

function ServiceTags({ categories }: { categories: FacilityServiceCategory[] }) {
  const display = categories.length ? categories : ["integrated" as FacilityServiceCategory];
  return (
    <>
      {display.map((category) => (
        <span
          key={category}
          className="rounded-full px-2 py-0.5 text-[10px] font-bold cd-text border cd-border-c"
          style={{ background: FACILITY_SERVICE_COLORS[category] }}
        >
          {FACILITY_SERVICE_LABELS[category]}
        </span>
      ))}
    </>
  );
}

function LogoPreview({ path, label }: { path: string | null; label: string }) {
  return path ? (
    <img
      src={path}
      alt={label + " 로고"}
      className="w-14 h-14 rounded-2xl object-contain cd-surface-bg border cd-border-c p-1"
    />
  ) : (
    <div className="w-14 h-14 rounded-2xl cd-surface-bg border cd-border-c flex items-center justify-center">
      <Building2 className="w-6 h-6 cd-text-faint" />
    </div>
  );
}

function GroupInfoCard({ detail }: { detail: FacilityDetail }) {
  const groupInfo = detail.groupInfo;
  return (
    <div className="flex flex-col gap-1 border cd-border-c rounded-xl p-3 sm:col-span-2">
      <span className="text-[10px] font-bold cd-text-faint uppercase tracking-wide flex items-center gap-1">
        <Briefcase className="w-3 h-3" /> 그룹 정보
      </span>
      {groupInfo ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs cd-text-muted">
          <div>
            그룹명: <b>{groupInfo.group.groupName}</b>
          </div>
          <div>
            연결 법인: <b>{formatCompanyName(groupInfo.company.companyName)}</b>
          </div>
          <div>그룹 내 역할: <b>{GROUP_COMPANY_ROLE_LABELS[groupInfo.company.groupRole]}</b></div>
          <div>사업장 관계: <b>{MEMBERSHIP_RELATION_LABELS[groupInfo.membership.relationType]}</b></div>
          {groupInfo.division && <div>부문: <b>{groupInfo.division.divisionName}</b></div>}
          <div>사업자번호: <b>{formatBusinessRegistrationNo(groupInfo.company.businessRegistrationNo) ?? "—"}</b></div>
          <div className="sm:col-span-2">
            소재지: <b>{formatAddress(groupInfo.company.address) ?? "—"}</b>
          </div>
          <div>전화번호: <b>{groupInfo.company.phoneNumber ?? "—"}</b></div>
        </div>
      ) : (
        <div className="text-sm cd-text-faint">그룹 정보 없음</div>
      )}
    </div>
  );
}

function OperatingEntityCard({ detail }: { detail: FacilityDetail }) {
  const info = detail.operatingEntityInfo;
  return (
    <div className="flex flex-col gap-1 border cd-border-c rounded-xl p-3 sm:col-span-2">
      <span className="text-[10px] font-bold cd-text-faint uppercase tracking-wide flex items-center gap-1">
        <Briefcase className="w-3 h-3" /> 운영 주체
      </span>
      {info ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs cd-text-muted">
          <div>
            운영 주체명: <b>{formatCompanyName(info.counterparty.companyName)}</b>
          </div>
          <div>
            관계: <b>{OPERATING_RELATION_LABELS[info.relation.relationType]}</b>
          </div>
          <div>사업자번호: <b>{formatBusinessRegistrationNo(info.counterparty.businessRegistrationNo) ?? "—"}</b></div>
          <div>전화번호: <b>{info.counterparty.phoneNumber ?? "—"}</b></div>
          <div className="sm:col-span-2">
            소재지: <b>{formatAddress(info.counterparty.siteAddress) ?? "—"}</b>
          </div>
        </div>
      ) : (
        <div className="text-sm cd-text-faint">운영 주체 정보 없음</div>
      )}
    </div>
  );
}

function PhoneContactField({
  value,
  onOpenContacts,
}: {
  value: string | null;
  onOpenContacts: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 border cd-border-c rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold cd-text-faint uppercase tracking-wide flex items-center gap-1">
          <Phone className="w-3 h-3" /> 전화번호
        </span>
        <button
          type="button"
          onClick={onOpenContacts}
          className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[10px] font-bold cd-text-muted"
        >
          연락처/담당자 관리
        </button>
      </div>
      <div className="text-sm font-semibold cd-text whitespace-pre-line">{value || "—"}</div>
    </div>
  );
}

function FacilityContactsModal({
  facility,
  canEdit,
  onClose,
}: {
  facility: FacilityDetail;
  canEdit: boolean;
  onClose: () => void;
}) {
  const { theme } = useCdashTheme();
  const [departments, setDepartments] = useState<FacilityContactDepartment[]>([]);
  const [people, setPeople] = useState<FacilityContactPerson[]>([]);
  const [logs, setLogs] = useState<FacilityContactLog[]>([]);
  const [mainNumber, setMainNumber] = useState<FacilityContactMainNumber | null>(null);
  const [mainNumberForm, setMainNumberForm] = useState({ phoneNumber: "", note: "" });
  const [mainNumberEditing, setMainNumberEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"department" | "person">("department");
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | null>(null);
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [departmentForm, setDepartmentForm] = useState({
    departmentName: "",
    phoneNumber: "",
    faxNumber: "",
    duties: "",
  });
  const [personForm, setPersonForm] = useState({
    personName: "",
    title: "",
    departmentId: "",
    officePhone: "",
    mobilePhone: "",
    email: "",
    duties: "",
    status: "active",
    appointedAt: "",
    transferredAt: "",
    resignedAt: "",
  });

  // 명함 촬영(이미지 선택) → Claude vision 파싱 → 담당자 신규 폼 프리필 (M2)
  const cardInputRef = useRef<HTMLInputElement>(null);
  const [cardParsing, setCardParsing] = useState(false);
  const handleCardFile = async (file: File | null) => {
    if (!file) return;
    setCardParsing(true);
    try {
      const fd = new FormData();
      fd.set("file", file, file.name || "card.jpg");
      const res = await fetch("/api/facilities/business-card/parse", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      const f = (data.fields ?? {}) as Record<string, string | null>;
      if (data.warning) alert(String(data.warning));
      setTab("person");
      setSelectedPersonId(null);
      setPersonForm({
        personName: f.personName ?? "",
        title: f.title ?? "",
        departmentId: "",
        officePhone: f.officePhone ?? "",
        mobilePhone: f.mobilePhone ?? "",
        email: f.email ?? "",
        duties: "",
        status: "active",
        appointedAt: "",
        transferredAt: "",
        resignedAt: "",
      });
      setEditing(true);
    } catch (err) {
      alert("명함 인식 실패: " + (err as Error).message);
    } finally {
      setCardParsing(false);
      if (cardInputRef.current) cardInputRef.current.value = "";
    }
  };

  const selectedDepartment = departments.find((department) => department.id === selectedDepartmentId) ?? null;
  const selectedPerson = people.find((person) => person.id === selectedPersonId) ?? null;
  const departmentPeople = selectedDepartment
    ? people.filter((person) => person.departmentId === selectedDepartment.id)
    : [];
  const visibleLogs = logs.filter((log) =>
    tab === "department"
      ? log.departmentId === selectedDepartmentId
      : log.personId === selectedPersonId
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/facilities/" + facility.facilityId + "/contacts", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const body = (await res.json()) as {
        mainNumber: FacilityContactMainNumber | null;
        departments: FacilityContactDepartment[];
        people: FacilityContactPerson[];
        logs: FacilityContactLog[];
      };
      setMainNumber(body.mainNumber ?? null);
      setMainNumberForm({
        phoneNumber: body.mainNumber?.phoneNumber ?? "",
        note: body.mainNumber?.note ?? "",
      });
      setDepartments(body.departments ?? []);
      setPeople(body.people ?? []);
      setLogs(body.logs ?? []);
      setSelectedDepartmentId(body.departments?.[0]?.id ?? null);
      setSelectedPersonId(body.people?.[0]?.id ?? null);
    } catch (err) {
      alert("연락처 조회 실패: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [facility.facilityId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const departmentName = (id: number | null) =>
    departments.find((department) => department.id === id)?.departmentName ?? "미지정";

  const persist = async (
    nextDepartments = departments,
    nextPeople = people,
    nextLogs = logs,
    nextMainNumber = mainNumber
  ) => {
    setSaving(true);
    try {
      const res = await fetch("/api/facilities/" + facility.facilityId + "/contacts", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mainNumber: nextMainNumber,
          departments: nextDepartments,
          people: nextPeople,
          logs: nextLogs,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      setEditing(false);
      setMainNumberEditing(false);
      await reload();
    } catch (err) {
      alert("연락처 저장 실패: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const startNewDepartment = () => {
    setTab("department");
    setSelectedDepartmentId(null);
    setDepartmentForm({ departmentName: "", phoneNumber: "", faxNumber: "", duties: "" });
    setEditing(true);
  };

  const startEditDepartment = () => {
    if (!selectedDepartment) return;
    setDepartmentForm({
      departmentName: selectedDepartment.departmentName,
      phoneNumber: selectedDepartment.phoneNumber ?? "",
      faxNumber: selectedDepartment.faxNumber ?? "",
      duties: selectedDepartment.duties ?? "",
    });
    setEditing(true);
  };

  const saveDepartment = async () => {
    const name = departmentForm.departmentName.trim();
    if (!name) return alert("부서명을 입력하세요.");
    const now = new Date().toISOString();
    const nextDepartment: FacilityContactDepartment = {
      id: selectedDepartmentId ?? -Date.now(),
      departmentName: name,
      phoneNumber: departmentForm.phoneNumber.trim() || null,
      faxNumber: departmentForm.faxNumber.trim() || null,
      duties: departmentForm.duties.trim() || null,
      updatedAt: now,
    };
    const nextDepartments = selectedDepartmentId
      ? departments.map((department) =>
          department.id === selectedDepartmentId ? { ...department, ...nextDepartment } : department
        )
      : [...departments, nextDepartment];
    const nextLogs = [
      ...logs,
      {
        id: -Date.now() - 1,
        departmentId: nextDepartment.id,
        personId: null,
        eventType: selectedDepartmentId ? "department_update" : "department_create",
        eventDate: now.slice(0, 10),
        memo: selectedDepartmentId ? "부서 정보가 수정되었습니다." : "부서가 신규 등록되었습니다.",
      },
    ];
    setSelectedDepartmentId(nextDepartment.id);
    await persist(nextDepartments, people, nextLogs);
  };

  const deleteDepartment = async () => {
    if (!selectedDepartment || !window.confirm("선택한 부서 등록 정보를 삭제할까요?")) return;
    const nextPeople = people.map((person) =>
      person.departmentId === selectedDepartment.id ? { ...person, departmentId: null } : person
    );
    await persist(
      departments.filter((department) => department.id !== selectedDepartment.id),
      nextPeople,
      logs.filter((log) => log.departmentId !== selectedDepartment.id)
    );
  };

  const startNewPerson = (departmentId = selectedDepartmentId) => {
    setTab("person");
    setSelectedPersonId(null);
    setPersonForm({
      personName: "",
      title: "",
      departmentId: departmentId != null ? String(departmentId) : "",
      officePhone: "",
      mobilePhone: "",
      email: "",
      duties: "",
      status: "active",
      appointedAt: "",
      transferredAt: "",
      resignedAt: "",
    });
    setEditing(true);
  };

  const startEditPerson = () => {
    if (!selectedPerson) return;
    setPersonForm({
      personName: selectedPerson.personName,
      title: selectedPerson.title ?? "",
      departmentId: selectedPerson.departmentId != null ? String(selectedPerson.departmentId) : "",
      officePhone: selectedPerson.officePhone ?? "",
      mobilePhone: selectedPerson.mobilePhone ?? "",
      email: selectedPerson.email ?? "",
      duties: selectedPerson.duties ?? "",
      status: selectedPerson.status ?? "active",
      appointedAt: selectedPerson.appointedAt ?? "",
      transferredAt: selectedPerson.transferredAt ?? "",
      resignedAt: selectedPerson.resignedAt ?? "",
    });
    setEditing(true);
  };

  const savePerson = async () => {
    const name = personForm.personName.trim();
    if (!name) return alert("담당자 성명을 입력하세요.");
    const now = new Date().toISOString();
    const nextPerson: FacilityContactPerson = {
      id: selectedPersonId ?? -Date.now(),
      departmentId: personForm.departmentId ? Number(personForm.departmentId) : null,
      personName: name,
      title: personForm.title.trim() || null,
      officePhone: personForm.officePhone.trim() || null,
      mobilePhone: personForm.mobilePhone.trim() || null,
      email: personForm.email.trim() || null,
      duties: personForm.duties.trim() || null,
      status: personForm.status,
      appointedAt: personForm.appointedAt || null,
      transferredAt: personForm.transferredAt || null,
      resignedAt: personForm.resignedAt || null,
      updatedAt: now,
    };
    const nextPeople = selectedPersonId
      ? people.map((person) => (person.id === selectedPersonId ? { ...person, ...nextPerson } : person))
      : [...people, nextPerson];
    const nextLogs = [
      ...logs,
      {
        id: -Date.now() - 2,
        departmentId: nextPerson.departmentId,
        personId: nextPerson.id,
        eventType: selectedPersonId ? "person_update" : "person_appoint",
        eventDate: (personForm.appointedAt || now.slice(0, 10)),
        memo: selectedPersonId ? "담당자 정보가 수정되었습니다." : "담당자가 신규 선임되었습니다.",
      },
    ];
    setSelectedPersonId(nextPerson.id);
    await persist(departments, nextPeople, nextLogs);
  };

  const saveMainNumber = async () => {
    const nextMainNumber = {
      phoneNumber: mainNumberForm.phoneNumber.trim() || null,
      note: mainNumberForm.note.trim() || null,
    };
    setMainNumber(nextMainNumber);
    await persist(departments, people, logs, nextMainNumber);
  };

  const deletePerson = async () => {
    if (!selectedPerson || !window.confirm("선택한 담당자 등록 정보를 삭제할까요?")) return;
    await persist(
      departments,
      people.filter((person) => person.id !== selectedPerson.id),
      logs.filter((log) => log.personId !== selectedPerson.id)
    );
  };

  const modal = (
    <div className="cdash-vars cd-fields-white fixed inset-0 z-50 bg-stone-950/20 flex items-center justify-center p-4" data-theme={theme}>
      <div className="cd-card rounded-3xl p-5 w-[min(1120px,calc(100vw-32px))] max-h-[min(840px,calc(100vh-32px))] overflow-y-auto scrollbar-hide shadow-2xl">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-xl font-bold cd-text">연락처/담당자 관리</h3>
            <p className="text-xs cd-text-faint mt-1">
              {formatCompanyName(facility.companyName)} · 기존 파싱 전화번호: {facility.phoneNumber ?? "—"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canEdit && (
              <>
                <input
                  ref={cardInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleCardFile(e.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  disabled={cardParsing}
                  onClick={() => cardInputRef.current?.click()}
                  className="cd-btn cd-btn-soft rounded-xl px-3 py-2 text-xs font-bold"
                >
                  {cardParsing ? "명함 인식 중…" : "명함 촬영"}
                </button>
              </>
            )}
            <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold cd-text-muted">
              닫기
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
          <section className="cd-surface-bg border cd-border-c rounded-2xl p-3">
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button type="button" onClick={() => setTab("department")} className={cn("rounded-xl px-3 py-2 text-xs font-bold", tab === "department" ? "cd-fill-primary text-white" : "cd-btn cd-btn-ghost cd-text-muted")}>
                부서별
              </button>
              <button type="button" onClick={() => setTab("person")} className={cn("rounded-xl px-3 py-2 text-xs font-bold", tab === "person" ? "cd-fill-primary text-white" : "cd-btn cd-btn-ghost cd-text-muted")}>
                담당자별
              </button>
            </div>
            {loading && <div className="text-sm cd-text-faint text-center py-8">연락처 조회 중…</div>}
            {!loading && tab === "department" && (
              <div className="flex flex-col gap-2 max-h-[600px] overflow-y-auto scrollbar-hide">
                {departments.length === 0 && <div className="text-sm cd-text-faint text-center py-8">등록된 부서가 없습니다.</div>}
                {departments.map((department) => {
                  const count = people.filter((person) => person.departmentId === department.id).length;
                  return (
                    <button
                      key={department.id}
                      type="button"
                      onClick={() => {
                        setTab("department");
                        setSelectedDepartmentId(department.id);
                        setEditing(false);
                      }}
                      className={cn("text-left rounded-xl border p-3", selectedDepartmentId === department.id ? "border-[color:var(--cd-primary)] cd-tint-primary" : "cd-border-c cd-surface-bg")}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold cd-text truncate">{department.departmentName}</span>
                        <span className="text-[10px] font-bold cd-text-faint cd-surface-bg rounded-full px-2 py-0.5">{count}건</span>
                      </div>
                      <div className="text-[11px] cd-text-faint mt-1">{department.phoneNumber ?? "전화번호 없음"}</div>
                    </button>
                  );
                })}
              </div>
            )}
            {!loading && tab === "person" && (
              <div className="flex flex-col gap-2 max-h-[600px] overflow-y-auto scrollbar-hide">
                {people.length === 0 && <div className="text-sm cd-text-faint text-center py-8">등록된 담당자가 없습니다.</div>}
                {people.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => {
                      setTab("person");
                      setSelectedPersonId(person.id);
                      setEditing(false);
                    }}
                    className={cn("text-left rounded-xl border p-3", selectedPersonId === person.id ? "border-[color:var(--cd-primary)] cd-tint-primary" : "cd-border-c cd-surface-bg")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold cd-text truncate">{person.personName}</span>
                      <span className="text-[10px] cd-text-faint truncate">{departmentName(person.departmentId)}</span>
                    </div>
                    <div className="text-[11px] cd-text-faint mt-1">{person.title ?? "직함 미입력"}</div>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-3 pt-3 border-t cd-border-c">
              <div className="rounded-2xl cd-surface-bg border cd-border-c p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div>
                    <div className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">
                      대표번호
                    </div>
                    {!mainNumberEditing && (
                      <div className="text-sm font-bold cd-text mt-1">
                        {mainNumber?.phoneNumber ?? facility.phoneNumber ?? "—"}
                      </div>
                    )}
                  </div>
                  {canEdit && !mainNumberEditing && (
                    <button
                      type="button"
                      onClick={() => {
                        setMainNumberForm({
                          phoneNumber: mainNumber?.phoneNumber ?? facility.phoneNumber ?? "",
                          note: mainNumber?.note ?? "",
                        });
                        setMainNumberEditing(true);
                      }}
                      className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[11px] font-bold cd-text-muted"
                    >
                      {mainNumber?.phoneNumber ? "수정" : "등록"}
                    </button>
                  )}
                </div>
                {mainNumberEditing ? (
                  <div className="flex flex-col gap-2">
                    <input
                      className="cd-input"
                      value={mainNumberForm.phoneNumber}
                      onChange={(e) => setMainNumberForm((prev) => ({ ...prev, phoneNumber: e.target.value }))}
                      placeholder="대표번호"
                    />
                    <input
                      className="cd-input"
                      value={mainNumberForm.note}
                      onChange={(e) => setMainNumberForm((prev) => ({ ...prev, note: e.target.value }))}
                      placeholder="메모"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setMainNumberForm({
                            phoneNumber: mainNumber?.phoneNumber ?? "",
                            note: mainNumber?.note ?? "",
                          });
                          setMainNumberEditing(false);
                        }}
                        className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[11px] font-bold cd-text-muted"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={saveMainNumber}
                        disabled={saving}
                        className="rounded-lg px-2 py-1 text-[11px] font-bold text-white cd-fill-primary disabled:opacity-50"
                      >
                        저장
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {mainNumber?.note && <div className="text-[11px] cd-text-faint mt-1">{mainNumber.note}</div>}
                    {!mainNumber?.phoneNumber && facility.phoneNumber && (
                      <div className="text-[10px] cd-text-faint mt-1">현재 파싱 전화번호를 참고값으로 표시 중</div>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>

          <section className="cd-surface-bg border cd-border-c rounded-2xl p-4 min-h-[620px]">
            {tab === "department" ? (
              <DepartmentContactPane
                canEdit={canEdit}
                editing={editing}
                department={selectedDepartment}
                form={departmentForm}
                people={departmentPeople}
                logs={visibleLogs}
                onFormChange={setDepartmentForm}
                onNew={startNewDepartment}
                onEdit={startEditDepartment}
                onDelete={deleteDepartment}
                onCancel={() => setEditing(false)}
                onSave={saveDepartment}
                onSelectPerson={(personId) => {
                  setTab("person");
                  setSelectedPersonId(personId);
                  setEditing(false);
                }}
                onAddPerson={() => startNewPerson(selectedDepartmentId)}
                saving={saving}
              />
            ) : (
              <PersonContactPane
                canEdit={canEdit}
                editing={editing}
                person={selectedPerson}
                departments={departments}
                form={personForm}
                logs={visibleLogs}
                onFormChange={setPersonForm}
                onNew={() => startNewPerson()}
                onEdit={startEditPerson}
                onDelete={deletePerson}
                onCancel={() => setEditing(false)}
                onSave={savePerson}
                saving={saving}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function DepartmentContactPane({
  canEdit,
  editing,
  department,
  form,
  people,
  logs,
  onFormChange,
  onNew,
  onEdit,
  onDelete,
  onCancel,
  onSave,
  onSelectPerson,
  onAddPerson,
  saving,
}: {
  canEdit: boolean;
  editing: boolean;
  department: FacilityContactDepartment | null;
  form: { departmentName: string; phoneNumber: string; faxNumber: string; duties: string };
  people: FacilityContactPerson[];
  logs: FacilityContactLog[];
  onFormChange: (next: { departmentName: string; phoneNumber: string; faxNumber: string; duties: string }) => void;
  onNew: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
  onSelectPerson: (personId: number) => void;
  onAddPerson: () => void;
  saving: boolean;
}) {
  if (!department && !editing) {
    return (
      <EmptyContactPane title="부서를 선택하세요" canEdit={canEdit} onNew={onNew} />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <ContactPaneHeader title={editing ? "부서 정보 입력" : department?.departmentName ?? "신규 부서"} canEdit={canEdit} editing={editing} onNew={onNew} onEdit={onEdit} />
      {editing ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ContactInput label="부서명" value={form.departmentName} onChange={(v) => onFormChange({ ...form, departmentName: v })} />
          <ContactInput label="전화번호" value={form.phoneNumber} onChange={(v) => onFormChange({ ...form, phoneNumber: v })} />
          <ContactInput label="팩스번호" value={form.faxNumber} onChange={(v) => onFormChange({ ...form, faxNumber: v })} />
          <div className="sm:col-span-2">
            <ContactTextarea label="담당업무" value={form.duties} onChange={(v) => onFormChange({ ...form, duties: v })} />
          </div>
          <ContactEditActions canEdit={canEdit} saving={saving} onDelete={onDelete} onCancel={onCancel} onSave={onSave} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <ContactValue label="부서명" value={department?.departmentName} />
            <ContactValue label="전화번호" value={department?.phoneNumber} />
            <ContactValue label="팩스번호" value={department?.faxNumber} />
            <ContactValue label="담당업무" value={department?.duties} full />
          </div>
          <div className="rounded-2xl cd-surface-bg border cd-border-c p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h4 className="text-sm font-bold cd-text">소속 직원</h4>
              {canEdit && (
                <button type="button" onClick={onAddPerson} className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[11px] font-bold cd-text-muted">
                  담당자 추가
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {people.length === 0 && <div className="text-sm cd-text-faint py-4 text-center">등록된 담당 직원이 없습니다.</div>}
              {people.map((person) => (
                <button key={person.id} type="button" onClick={() => onSelectPerson(person.id)} className="text-left rounded-xl cd-surface-bg border cd-border-c p-2">
                  <span className="text-sm font-bold cd-text">{person.personName}</span>
                  <span className="text-xs cd-text-faint ml-2">{person.title ?? "직함 미입력"}</span>
                </button>
              ))}
            </div>
          </div>
          <ContactLogBox logs={logs} />
        </>
      )}
    </div>
  );
}

function PersonContactPane({
  canEdit,
  editing,
  person,
  departments,
  form,
  logs,
  onFormChange,
  onNew,
  onEdit,
  onDelete,
  onCancel,
  onSave,
  saving,
}: {
  canEdit: boolean;
  editing: boolean;
  person: FacilityContactPerson | null;
  departments: FacilityContactDepartment[];
  form: {
    personName: string;
    title: string;
    departmentId: string;
    officePhone: string;
    mobilePhone: string;
    email: string;
    duties: string;
    status: string;
    appointedAt: string;
    transferredAt: string;
    resignedAt: string;
  };
  logs: FacilityContactLog[];
  onFormChange: (next: typeof form) => void;
  onNew: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const departmentName =
    departments.find((department) => department.id === person?.departmentId)?.departmentName ?? "미지정";
  if (!person && !editing) {
    return <EmptyContactPane title="담당자를 선택하세요" canEdit={canEdit} onNew={onNew} />;
  }
  return (
    <div className="flex flex-col gap-4">
      <ContactPaneHeader title={editing ? "담당자 정보 입력" : person?.personName ?? "신규 담당자"} canEdit={canEdit} editing={editing} onNew={onNew} onEdit={onEdit} />
      {editing ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <ContactInput label="담당자 성명" value={form.personName} onChange={(v) => onFormChange({ ...form, personName: v })} />
          <ContactInput label="직함" value={form.title} onChange={(v) => onFormChange({ ...form, title: v })} />
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">소속 부서</span>
            <select className="cd-select" value={form.departmentId} onChange={(e) => onFormChange({ ...form, departmentId: e.target.value })}>
              <option value="">미지정</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>{department.departmentName}</option>
              ))}
            </select>
          </div>
          <ContactInput label="전화번호(회사)" value={form.officePhone} onChange={(v) => onFormChange({ ...form, officePhone: v })} />
          <ContactInput label="전화번호(HP)" value={form.mobilePhone} onChange={(v) => onFormChange({ ...form, mobilePhone: v })} />
          <ContactInput label="이메일주소" value={form.email} onChange={(v) => onFormChange({ ...form, email: v })} />
          <ContactInput label="신규 선임일" value={form.appointedAt} onChange={(v) => onFormChange({ ...form, appointedAt: v })} />
          <ContactInput label="부서 변경일" value={form.transferredAt} onChange={(v) => onFormChange({ ...form, transferredAt: v })} />
          <ContactInput label="퇴사일" value={form.resignedAt} onChange={(v) => onFormChange({ ...form, resignedAt: v })} />
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">상태</span>
            <select className="cd-select" value={form.status} onChange={(e) => onFormChange({ ...form, status: e.target.value })}>
              <option value="active">재직</option>
              <option value="transferred">부서 변경</option>
              <option value="resigned">퇴사</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <ContactTextarea label="담당 업무" value={form.duties} onChange={(v) => onFormChange({ ...form, duties: v })} />
          </div>
          <ContactEditActions canEdit={canEdit} saving={saving} onDelete={onDelete} onCancel={onCancel} onSave={onSave} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <ContactValue label="담당자 성명" value={person?.personName} />
            <ContactValue label="직함" value={person?.title} />
            <ContactValue label="소속 부서" value={departmentName} />
            <ContactValue label="전화번호(회사)" value={person?.officePhone} />
            <ContactValue label="전화번호(HP)" value={person?.mobilePhone} />
            <ContactValue label="이메일주소" value={person?.email} />
            <ContactValue label="담당 업무" value={person?.duties} full />
          </div>
          <div className="rounded-2xl cd-surface-bg border cd-border-c p-3">
            <h4 className="text-sm font-bold cd-text mb-2">담당자 이력</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
              <ContactValue label="신규 선임" value={person?.appointedAt} />
              <ContactValue label="부서 변경" value={person?.transferredAt} />
              <ContactValue label="퇴사" value={person?.resignedAt} />
            </div>
          </div>
          <ContactLogBox logs={logs} />
        </>
      )}
    </div>
  );
}

function EmptyContactPane({ title, canEdit, onNew }: { title: string; canEdit: boolean; onNew: () => void }) {
  return (
    <div className="h-full min-h-[520px] flex flex-col items-center justify-center text-center gap-3">
      <div className="text-sm cd-text-faint">{title}</div>
      {canEdit && (
        <button type="button" onClick={onNew} className="rounded-xl px-4 py-2 text-sm font-bold text-white cd-fill-primary">
          신규 등록
        </button>
      )}
    </div>
  );
}

function ContactPaneHeader({
  title,
  canEdit,
  editing,
  onNew,
  onEdit,
}: {
  title: string;
  canEdit: boolean;
  editing: boolean;
  onNew: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-lg font-bold cd-text">{title}</h4>
      {canEdit && !editing && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={onNew} className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold cd-text-muted">
            신규
          </button>
          <button type="button" onClick={onEdit} className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold cd-text-muted">
            수정
          </button>
        </div>
      )}
    </div>
  );
}

function ContactEditActions({
  canEdit,
  saving,
  onDelete,
  onCancel,
  onSave,
}: {
  canEdit: boolean;
  saving: boolean;
  onDelete: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  if (!canEdit) return null;
  return (
    <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
      <button type="button" onClick={onDelete} className="rounded-xl px-3 py-2 text-xs font-bold cd-error-text cd-error-bg border border-red-200">
        삭제
      </button>
      <button type="button" onClick={onCancel} className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold cd-text-muted">
        취소
      </button>
      <button type="button" onClick={onSave} disabled={saving} className="rounded-xl px-3 py-2 text-xs font-bold text-white cd-fill-primary disabled:opacity-50">
        {saving ? "저장 중…" : "저장"}
      </button>
    </div>
  );
}

function ContactInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">{label}</span>
      <input className="cd-input" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ContactTextarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">{label}</span>
      <textarea className="cd-textarea" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ContactValue({ label, value, full }: { label: string; value: string | null | undefined; full?: boolean }) {
  return (
    <div className={cn("rounded-xl cd-surface-bg border cd-border-c p-3", full && "sm:col-span-2")}>
      <div className="text-[10px] font-bold cd-text-faint uppercase tracking-wide">{label}</div>
      <div className="text-sm font-semibold cd-text mt-1 whitespace-pre-line">{value || "—"}</div>
    </div>
  );
}

function ContactLogBox({ logs }: { logs: FacilityContactLog[] }) {
  return (
    <div className="rounded-2xl cd-surface-bg border cd-border-c p-3">
      <h4 className="text-sm font-bold cd-text mb-2">변동 이력 로그</h4>
      <div className="max-h-44 overflow-y-auto scrollbar-hide flex flex-col gap-2">
        {logs.length === 0 && <div className="text-sm cd-text-faint py-4 text-center">등록된 변동 이력이 없습니다.</div>}
        {logs.map((log) => (
          <div key={log.id} className="rounded-xl cd-surface-bg border cd-border-c p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <b className="cd-text">{contactEventLabel(log.eventType)}</b>
              <span className="cd-text-faint">{log.eventDate ?? log.createdAt?.slice(0, 10) ?? "—"}</span>
            </div>
            {log.memo && <div className="cd-text-faint mt-1">{log.memo}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function contactEventLabel(eventType: string): string {
  if (eventType === "person_appoint") return "신규 선임";
  if (eventType === "person_update") return "담당자 정보 변경";
  if (eventType === "department_create") return "부서 신규 등록";
  if (eventType === "department_update") return "부서 정보 변경";
  return "메모";
}

function ManualProductsSection({ products }: { products: FacilityManualProduct[] }) {
  return (
    <section className="cd-surface-bg border cd-border-c rounded-2xl p-4">
      <h3 className="text-sm font-bold cd-text flex items-center gap-2">
        <ClipboardList className="w-4 h-4 cd-text-primary" /> 주요 생산품
      </h3>
      <p className="text-[11px] cd-text-faint mt-1">
        통합허가 파싱 대상이 아닌 용역 사업장을 위한 수동 입력 정보입니다.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {products.length === 0 && <div className="text-sm cd-text-faint py-4 text-center">등록된 생산품이 없습니다.</div>}
        {products.map((product, idx) => (
          <div key={product.id ?? idx} className="grid grid-cols-[1fr_auto] gap-2 text-xs cd-surface-bg border cd-border-c rounded-xl p-2">
            <div>
              <b className="cd-text">{product.productName}</b>
              {product.note && <div className="cd-text-faint mt-0.5">{product.note}</div>}
            </div>
            <div className="cd-text-muted">
              {[product.amount != null ? formatNumber(product.amount) : null, product.unit].filter(Boolean).join(" ") || "—"}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReadView({
  detail,
  onOpenContacts,
}: {
  detail: FacilityDetail;
  onOpenContacts: () => void;
}) {
  const industries =
    detail.industries && detail.industries.length > 0
      ? dedupeIndustries(detail.industries)
      : [{ code: detail.industryCode, name: detail.industryName }];
  const primaryAlias = detail.aliases.find((alias) => alias.isPrimary) ?? detail.aliases[0];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="sm:col-span-2 cd-surface-bg border cd-border-c rounded-xl p-3">
        <div className="min-w-0">
          {primaryAlias && (
            <div className="text-xs cd-text-faint truncate">
              별칭: <b>{primaryAlias.alias}</b>
              {detail.aliases.length > 1 ? ` 외 ${detail.aliases.length - 1}개` : ""}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 mt-2">
            <ServiceTags categories={detail.serviceCategories} />
            {detail.companySize && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold cd-card-bg border cd-border-c cd-text-muted">
                {FACILITY_COMPANY_SIZE_LABELS[detail.companySize]}
              </span>
            )}
          </div>
        </div>
      </div>
      <DetailField icon={Hash} label="사업자등록번호" value={formatBusinessRegistrationNo(detail.businessRegistrationNo)} />
      <DetailField icon={Building2} label="대표자명" value={detail.representativeName ?? null} />
      <PhoneContactField value={detail.phoneNumber} onOpenContacts={onOpenContacts} />
      <DetailField
        icon={MapPin}
        label={detail.additionalSiteAddresses.length > 0 ? "소재지 (대표)" : "소재지"}
        value={detail.siteAddress}
        secondary={
          detail.regionSido
            ? "지역: " + detail.regionSido + (detail.regionSigungu ? " " + detail.regionSigungu : "")
            : null
        }
      />
      {detail.additionalSiteAddresses.map((addr, idx) => (
        <DetailField
          key={"add-site-" + idx}
          icon={MapPin}
          label={"추가 소재지 " + (idx + 1)}
          value={addr}
        />
      ))}
      <div className="flex flex-col gap-1 border cd-border-c rounded-xl p-3">
        <span className="text-[10px] font-bold cd-text-faint uppercase tracking-wide flex items-center gap-1">
          <FileText className="w-3 h-3" /> 업종
        </span>
        <div className="flex flex-col gap-1">
          {industries.length > 0 ? (
            industries.map((industry, idx) => (
              <div key={idx} className="grid grid-cols-[90px_1fr] gap-1 text-xs">
                <span className="font-mono rounded px-2 py-1 cd-text-muted">
                  {industry.code ?? "—"}
                </span>
                <span className="rounded px-2 py-1 cd-text">
                  {industry.name ?? "업종명 없음"}
                </span>
              </div>
            ))
          ) : (
            <span className="text-sm cd-text-faint">—</span>
          )}
        </div>
      </div>
      <DetailField icon={Layers} label="허가 건수" value={String(detail.permits.length)} />
      <DetailField
        icon={FileText}
        label="사업자등록증 업태"
        value={detail.businessCertificateBusinessType ?? null}
        multiline
      />
      <DetailField
        icon={FileText}
        label="사업자등록증 종목"
        value={detail.businessCertificateBusinessItem ?? null}
        multiline
      />
      <DetailField
        icon={Hash}
        label="법인등록번호"
        value={detail.businessCertificateCorporateRegistrationNo ?? null}
      />
      <OperatingEntityCard detail={detail} />
      <GroupInfoCard detail={detail} />
    </div>
  );
}

function BusinessCertificatesSection({
  detail,
  canEdit,
  onChanged,
}: {
  detail: FacilityDetail;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const certificates = detail.businessCertificates ?? [];
  const current = certificates.find((item) => item.isCurrent);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(`/api/facilities/${encodeURIComponent(detail.facilityId)}/business-certificates`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      onChanged();
    } catch (err) {
      alert("사업자등록증 업로드 실패: " + (err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className="rounded-2xl border cd-border-c p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="text-sm font-black cd-text flex items-center gap-2">
            <FileText className="w-4 h-4 cd-text-primary" />
            사업자등록증
          </h3>
          <p className="text-xs cd-text-faint mt-1">
            PDF 원본은 S3에 보관되며, 갱신 업로드 시 OCR 파싱 결과로 업태·종목·법인등록번호를 업데이트합니다.
          </p>
        </div>
        {canEdit && (
          <label className="rounded-xl px-3 py-2 text-xs font-bold text-white cd-fill-primary cursor-pointer inline-flex items-center gap-1">
            <Upload className="w-3.5 h-3.5" />
            {uploading ? "업로드 중..." : current ? "갱신본 업로드" : "등록증 업로드"}
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={uploading}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) upload(file);
              }}
            />
          </label>
        )}
      </div>

      {certificates.length === 0 ? (
        <p className="text-sm cd-text-faint">등록된 사업자등록증이 없습니다.</p>
      ) : (
        <div className="grid gap-2">
          {certificates.map((item) => (
            <div key={item.certificateId} className="rounded-xl border cd-border-c cd-surface-bg p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold cd-text truncate">{item.displayName}</p>
                  {item.isCurrent && (
                    <span className="rounded-full cd-tint-primary px-2 py-0.5 text-[10px] font-bold cd-text-primary">현재본</span>
                  )}
                  <span className="rounded-full cd-surface-bg px-2 py-0.5 text-[10px] font-bold cd-text-faint">v{item.versionNo}</span>
                </div>
                <p className="text-xs cd-text-faint mt-1">
                  갱신일: {item.createdAt.slice(0, 10)} · 업태 {item.businessType ?? "-"} · 종목 {item.businessItem ?? "-"} · 법인등록번호 {item.corporateRegistrationNo ?? "-"}
                </p>
                <p className="text-[11px] cd-text-faint mt-1">
                  등록자: {item.createdByName ?? item.createdByEmail ?? "-"}
                </p>
              </div>
              {item.publicPath && (
                <a
                  href={item.publicPath}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold cd-text-muted cd-surface-bg hover:bg-[color:var(--cd-surface)]"
                >
                  PDF 보기
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function EditView({
  detail,
  onCancel,
  onSaved,
}: {
  detail: FacilityDetail;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [companyName, setCompanyName] = useState(formatCompanyName(detail.companyName) ?? "");
  const [businessRegistrationNo, setBrn] = useState(formatBusinessRegistrationNo(detail.businessRegistrationNo) ?? "");
  const [representativeName, setRepresentativeName] = useState(detail.representativeName ?? "");
  const [siteAddress, setSiteAddress] = useState(detail.siteAddress ?? "");
  const [hasMultipleSites, setHasMultipleSites] = useState(
    (detail.additionalSiteAddresses?.length ?? 0) > 0
  );
  const [additionalSiteAddresses, setAdditionalSiteAddresses] = useState<string[]>(
    detail.additionalSiteAddresses?.length ? [...detail.additionalSiteAddresses] : [""]
  );
  const [phoneNumber, setPhoneNumber] = useState(detail.phoneNumber ?? "");
  const scalarIndustries = parseIndustriesFromValue(detail.industryCode, detail.industryName);
  const displayedIndustries = dedupeIndustries(detail.industries ?? []);
  const initialIndustries = displayedIndustries.length
    ? displayedIndustries
    : scalarIndustries.length
    ? scalarIndustries
    : [];
  const [industries, setIndustries] = useState(
    initialIndustries.length
      ? initialIndustries.map((industry) => ({
          code: industry.code ?? "",
          name: industry.name ?? "",
          autoName: false,
        }))
      : [{ code: "", name: "", autoName: false }]
  );
  // 표준산업분류(KSIC) 코드→업종명 자동완성용 맵 (편집 폼 진입 시 1회 로드)
  const [ksicMap, setKsicMap] = useState<Map<string, string> | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadKsicMap()
      .then((m) => { if (!cancelled) setKsicMap(m); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const [certificateKinds, setCertificateKinds] = useState(() => {
    const types = (detail.businessCertificateBusinessType ?? "").split(/\n+/);
    const items = (detail.businessCertificateBusinessItem ?? "").split(/\n+/);
    const max = Math.max(types.length, items.length);
    const rows = Array.from({ length: max }, (_, idx) => ({
      businessType: (types[idx] ?? "").trim(),
      businessItem: (items[idx] ?? "").trim(),
    })).filter((row) => row.businessType || row.businessItem);
    return rows.length ? rows : [{ businessType: "", businessItem: "" }];
  });
  const [certificateCorporateNo, setCertificateCorporateNo] = useState(
    detail.businessCertificateCorporateRegistrationNo ?? ""
  );
  const [logoPath, setLogoPath] = useState(detail.logoPath ?? "");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [aliases, setAliases] = useState(
    detail.aliases.length
      ? detail.aliases.map((alias) => ({
          alias: alias.alias,
          aliasType: alias.aliasType ?? "",
          note: alias.note ?? "",
          isPrimary: alias.isPrimary,
        }))
      : [{ alias: "", aliasType: "site", note: "", isPrimary: true }]
  );
  const [serviceCategories, setServiceCategories] = useState<FacilityServiceCategory[]>(
    detail.serviceCategories.length ? detail.serviceCategories : ["integrated"]
  );
  const [companySize, setCompanySize] = useState<FacilityCompanySize | "">(detail.companySize ?? "");
  const [manualProducts, setManualProducts] = useState(
    detail.manualProducts.length
      ? detail.manualProducts.map((product) => ({
          productName: product.productName,
          amount: product.amount != null ? String(product.amount) : "",
          unit: product.unit ?? "",
          note: product.note ?? "",
        }))
      : [{ productName: "", amount: "", unit: "", note: "" }]
  );
  const [groupOpen, setGroupOpen] = useState(false);
  const [operatingOpen, setOperatingOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasIntegratedService = serviceCategories.includes("integrated");

  useEffect(() => {
    if (!logoFile) {
      setLogoPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(logoFile);
    setLogoPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [logoFile]);

  const uploadLogo = async (file: File): Promise<string> => {
    const form = new FormData();
    form.set("file", file);
    const res = await fetch("/api/uploads/logo", { method: "POST", body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error ?? "HTTP " + res.status);
    }
    const body = (await res.json()) as { path: string };
    return body.path;
  };

  const handleSave = async () => {
    setPending(true);
    setError(null);
    const normalizedIndustries = industries
      .map((industry) => ({
        code: industry.code.trim(),
        name: industry.name.trim(),
      }))
      .filter((industry) => industry.code || industry.name);
    const normalizedCertificateKinds = certificateKinds
      .map((row) => ({
        businessType: row.businessType.trim(),
        businessItem: row.businessItem.trim(),
      }))
      .filter((row) => row.businessType || row.businessItem);
    try {
      const nextLogoPath = logoFile ? await uploadLogo(logoFile) : logoPath;
      const res = await fetch("/api/facilities/" + detail.facilityId, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyName: formatCompanyName(companyName) ?? companyName,
          businessRegistrationNo: formatBusinessRegistrationNo(businessRegistrationNo) || null,
          representativeName: representativeName || null,
          siteAddress: siteAddress.trim() || null,
          additionalSiteAddresses: hasMultipleSites
            ? additionalSiteAddresses.map((addr) => addr.trim()).filter(Boolean)
            : [],
          phoneNumber: phoneNumber || null,
          industryCode: normalizedIndustries.map((industry) => industry.code).join("\n") || null,
          industryName: normalizedIndustries.map((industry) => industry.name).join("\n") || null,
          businessCertificateBusinessType:
            normalizedCertificateKinds.map((row) => row.businessType).join("\n") || null,
          businessCertificateBusinessItem:
            normalizedCertificateKinds.map((row) => row.businessItem).join("\n") || null,
          businessCertificateCorporateRegistrationNo: certificateCorporateNo || null,
          logoPath: nextLogoPath || null,
          companySize: companySize || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      const saveAliases = fetch("/api/facilities/" + detail.facilityId + "/aliases", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ aliases }),
      });
      const saveServices = fetch("/api/facilities/" + detail.facilityId + "/service-categories", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          serviceCategories,
          companySize: companySize || null,
        }),
      });
      const saveManualProducts = fetch("/api/facilities/" + detail.facilityId + "/manual-products", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ products: manualProducts }),
      });
      const followups = await Promise.all([saveAliases, saveServices, saveManualProducts]);
      const failed = followups.find((item) => !item.ok);
      if (failed) {
        const body = await failed.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + failed.status);
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <FieldInput label="상호" value={companyName} onChange={setCompanyName} />
      <FieldInput label="사업자등록번호" value={businessRegistrationNo} onChange={setBrn} />
      <FieldInput label="대표자명" value={representativeName} onChange={setRepresentativeName} multiline />
      <FieldInput
        label={hasMultipleSites ? "소재지 (대표)" : "소재지"}
        value={siteAddress}
        onChange={setSiteAddress}
        full
      />
      <div className="sm:col-span-2 flex flex-col gap-2">
        <label className="flex items-center gap-1.5 text-xs font-bold cd-text-muted select-none">
          <input
            type="checkbox"
            checked={hasMultipleSites}
            onChange={(e) => {
              const checked = e.target.checked;
              setHasMultipleSites(checked);
              if (checked && additionalSiteAddresses.length === 0) {
                setAdditionalSiteAddresses([""]);
              }
            }}
          />
          복수 사업장 (동일 사업자등록번호로 소재지가 2개 이상)
        </label>
        {hasMultipleSites && (
          <div className="flex flex-col gap-2 cd-surface-bg border cd-border-c rounded-xl p-3">
            <div className="text-[11px] font-bold cd-text-faint">
              대표 소재지 외 추가 운영 소재지를 입력합니다. (지역·중복 검증·계약 매칭은 대표 소재지 기준)
            </div>
            {additionalSiteAddresses.map((addr, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_auto] gap-2 items-center">
                <input
                  className="cd-input"
                  value={addr}
                  onChange={(e) =>
                    setAdditionalSiteAddresses((prev) =>
                      prev.map((item, itemIdx) => (itemIdx === idx ? e.target.value : item))
                    )
                  }
                  placeholder={"추가 소재지 " + (idx + 1)}
                />
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="rounded-lg border cd-border-c cd-card-bg px-2 py-2 cd-text-muted hover:bg-[color:var(--cd-surface)]"
                    onClick={() => setAdditionalSiteAddresses((prev) => [...prev, ""])}
                    title="추가 소재지 행 추가"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-red-100 cd-error-bg px-2 py-2 cd-error-text hover:cd-error-bg"
                    onClick={() =>
                      setAdditionalSiteAddresses((prev) =>
                        prev.length <= 1 ? [""] : prev.filter((_, itemIdx) => itemIdx !== idx)
                      )
                    }
                    title="추가 소재지 행 삭제"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <FieldInput label="전화번호" value={phoneNumber} onChange={setPhoneNumber} />
      <div className="sm:col-span-2 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">
            업종
          </span>
          <button
            type="button"
            onClick={() => setIndustries((prev) => [...prev, { code: "", name: "", autoName: false }])}
            className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[11px] font-bold cd-text-muted flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> 업종 추가
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {industries.map((industry, idx) => (
            <div
              key={idx}
              className="grid grid-cols-1 sm:grid-cols-[130px_1fr_auto] gap-2 cd-surface-bg border cd-border-c rounded-xl p-2"
            >
              <input
                className="cd-input"
                value={industry.code}
                onChange={(e) => {
                  const code = e.target.value;
                  // 코드가 KSIC와 일치하면 업종명 자동완성 — 비어있거나 앞서 자동입력된 값일 때만 덮어씀
                  const matched = lookupKsicName(ksicMap, code);
                  setIndustries((prev) =>
                    prev.map((item, itemIdx) => {
                      if (itemIdx !== idx) return item;
                      if (matched && (item.name.trim() === "" || item.autoName)) {
                        return { ...item, code, name: matched, autoName: true };
                      }
                      return { ...item, code };
                    })
                  );
                }}
                placeholder="업종 코드"
              />
              <input
                className="cd-input"
                value={industry.name}
                onChange={(e) =>
                  setIndustries((prev) =>
                    prev.map((item, itemIdx) =>
                      itemIdx === idx ? { ...item, name: e.target.value, autoName: false } : item
                    )
                  )
                }
                placeholder="업종명"
              />
              <button
                type="button"
                onClick={() =>
                  setIndustries((prev) =>
                    prev.length > 1 ? prev.filter((_, itemIdx) => itemIdx !== idx) : [{ code: "", name: "", autoName: false }]
                  )
                }
                className="rounded-lg px-2 py-1 text-[11px] font-bold cd-error-text cd-error-bg hover:cd-error-bg border border-red-200 flex items-center justify-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> 삭제
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="sm:col-span-2 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">
            사업자등록증 기반 업종
          </span>
          <button
            type="button"
            onClick={() => setCertificateKinds((prev) => [...prev, { businessType: "", businessItem: "" }])}
            className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[11px] font-bold cd-text-muted flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> 항목 추가
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {certificateKinds.map((row, idx) => (
            <div
              key={idx}
              className="grid grid-cols-1 sm:grid-cols-[180px_1fr_auto] gap-2 cd-surface-bg border cd-border-c rounded-xl p-2"
            >
              <input
                className="cd-input"
                value={row.businessType}
                onChange={(e) =>
                  setCertificateKinds((prev) =>
                    prev.map((item, itemIdx) =>
                      itemIdx === idx ? { ...item, businessType: e.target.value } : item
                    )
                  )
                }
                placeholder="사업자등록증 업태"
              />
              <input
                className="cd-input"
                value={row.businessItem}
                onChange={(e) =>
                  setCertificateKinds((prev) =>
                    prev.map((item, itemIdx) =>
                      itemIdx === idx ? { ...item, businessItem: e.target.value } : item
                    )
                  )
                }
                placeholder="사업자등록증 종목"
              />
              <button
                type="button"
                onClick={() =>
                  setCertificateKinds((prev) =>
                    prev.length > 1
                      ? prev.filter((_, itemIdx) => itemIdx !== idx)
                      : [{ businessType: "", businessItem: "" }]
                  )
                }
                className="rounded-lg px-2 py-1 text-[11px] font-bold cd-error-text cd-error-bg hover:cd-error-bg border border-red-200 flex items-center justify-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> 삭제
              </button>
            </div>
          ))}
        </div>
      </div>
      <FieldInput
        label="법인등록번호"
        value={certificateCorporateNo}
        onChange={setCertificateCorporateNo}
      />
      <div className="sm:col-span-2 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-3 cd-surface-bg border cd-border-c rounded-xl p-3">
        <LogoPreview path={logoPreviewUrl || logoPath || null} label={companyName} />
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="cd-btn cd-btn-ghost rounded-lg px-3 py-2 text-[11px] font-bold cd-text-muted flex items-center gap-1 cursor-pointer">
              <Upload className="w-3 h-3" /> 사업장 로고 파일 선택
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setLogoFile(file);
                }}
              />
            </label>
            {(logoPath || logoFile) && (
              <button
                type="button"
                onClick={() => {
                  setLogoPath("");
                  setLogoFile(null);
                }}
                className="rounded-lg px-3 py-2 text-[11px] font-bold cd-error-text cd-error-bg border border-red-200"
              >
                로고 제거
              </button>
            )}
          </div>
          <div className="rounded-xl cd-surface-bg border cd-border-c px-3 py-2 text-[11px] cd-text-faint">
            {logoFile
              ? `${logoFile.name} 선택됨 · 저장 시 업로드됩니다.`
              : logoPath
              ? "등록된 로고 파일이 있습니다."
              : "등록된 로고 파일이 없습니다."}
          </div>
        </div>
      </div>

      <div className="sm:col-span-2 flex flex-col gap-2 cd-surface-bg border cd-border-c rounded-xl p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide flex items-center gap-1">
            <Tags className="w-3 h-3" /> 사업장 별칭
          </span>
          <button
            type="button"
            onClick={() => setAliases((prev) => [...prev, { alias: "", aliasType: "site", note: "", isPrimary: false }])}
            className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[11px] font-bold cd-text-muted"
          >
            별칭 추가
          </button>
        </div>
        {aliases.map((alias, idx) => (
          <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_100px_1fr_auto] gap-2">
            <input className="cd-input" value={alias.alias} onChange={(e) => setAliases((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, alias: e.target.value } : item))} placeholder="사업체 사용 명칭" />
            <input className="cd-input" value={alias.aliasType} onChange={(e) => setAliases((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, aliasType: e.target.value } : item))} placeholder="유형" />
            <input className="cd-input" value={alias.note} onChange={(e) => setAliases((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, note: e.target.value } : item))} placeholder="메모" />
            <button type="button" onClick={() => setAliases((prev) => prev.filter((_, itemIdx) => itemIdx !== idx))} className="rounded-lg px-2 py-1 text-[11px] font-bold cd-error-text cd-error-bg border border-red-200">
              삭제
            </button>
          </div>
        ))}
      </div>

      <div className="sm:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3 cd-surface-bg border cd-border-c rounded-xl p-3">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">대상 용역 카테고리</span>
          <div className="flex flex-wrap gap-2">
            {FACILITY_SERVICE_ORDER.map((category) => (
              <label key={category} className="flex items-center gap-1.5 text-xs font-bold cd-text-muted">
                <input
                  type="checkbox"
                  checked={serviceCategories.includes(category)}
                  onChange={(e) =>
                    setServiceCategories((prev) =>
                      e.target.checked ? [...prev, category] : prev.filter((item) => item !== category)
                    )
                  }
                />
                <span className="rounded-full px-2 py-0.5" style={{ background: FACILITY_SERVICE_COLORS[category] }}>
                  {FACILITY_SERVICE_LABELS[category]}
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">사업장 분류</span>
          <select className="cd-select" value={companySize} onChange={(e) => setCompanySize(e.target.value as FacilityCompanySize | "")}>
            <option value="">미지정</option>
            {FACILITY_COMPANY_SIZE_ORDER.map((size) => (
              <option key={size} value={size}>{FACILITY_COMPANY_SIZE_LABELS[size]}</option>
            ))}
          </select>
        </div>
      </div>

      {!hasIntegratedService && (
        <div className="sm:col-span-2 flex flex-col gap-2 cd-surface-bg border cd-border-c rounded-xl p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">수동 주요 생산품</span>
            <button type="button" onClick={() => setManualProducts((prev) => [...prev, { productName: "", amount: "", unit: "", note: "" }])} className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[11px] font-bold cd-text-muted">
              생산품 추가
            </button>
          </div>
          {manualProducts.map((product, idx) => (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_100px_90px_1fr_auto] gap-2">
              <input className="cd-input" value={product.productName} onChange={(e) => setManualProducts((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, productName: e.target.value } : item))} placeholder="생산품" />
              <input className="cd-input" value={product.amount} onChange={(e) => setManualProducts((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, amount: e.target.value } : item))} placeholder="생산량" />
              <input className="cd-input" value={product.unit} onChange={(e) => setManualProducts((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, unit: e.target.value } : item))} placeholder="단위" />
              <input className="cd-input" value={product.note} onChange={(e) => setManualProducts((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, note: e.target.value } : item))} placeholder="비고" />
              <button type="button" onClick={() => setManualProducts((prev) => prev.filter((_, itemIdx) => itemIdx !== idx))} className="rounded-lg px-2 py-1 text-[11px] font-bold cd-error-text cd-error-bg border border-red-200">
                삭제
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="sm:col-span-2 cd-surface-bg border cd-border-c rounded-xl p-3 flex items-center justify-between gap-3">
        <div className="text-xs cd-text-muted">
          <b className="cd-text">그룹 정보</b>
          <div>
            {detail.groupInfo
              ? `${detail.groupInfo.group.groupName} · ${detail.groupInfo.company.companyName} (${MEMBERSHIP_RELATION_LABELS[detail.groupInfo.membership.relationType]})`
              : "연결된 그룹 정보 없음"}
          </div>
        </div>
        <button type="button" onClick={() => setGroupOpen(true)} className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold cd-text-muted">
          그룹 관리
        </button>
      </div>

      {groupOpen && (
        <GroupManagementModal
          facility={detail}
          onClose={() => setGroupOpen(false)}
          onChanged={() => {
            setGroupOpen(false);
            onSaved();
          }}
        />
      )}

      <div className="sm:col-span-2 cd-surface-bg border cd-border-c rounded-xl p-3 flex items-center justify-between gap-3">
        <div className="text-xs cd-text-muted">
          <b className="cd-text">운영 주체</b>
          <div>
            {detail.operatingEntityInfo
              ? `${detail.operatingEntityInfo.counterparty.companyName} · ${OPERATING_RELATION_LABELS[detail.operatingEntityInfo.relation.relationType]}`
              : "연결된 운영 주체 없음"}
          </div>
        </div>
        <button type="button" onClick={() => setOperatingOpen(true)} className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold cd-text-muted">
          운영 주체 관리
        </button>
      </div>

      {operatingOpen && (
        <OperatingEntityModal
          facility={detail}
          onClose={() => setOperatingOpen(false)}
          onChanged={() => {
            setOperatingOpen(false);
            onSaved();
          }}
        />
      )}

      {error && (
        <div className="sm:col-span-2 text-xs font-bold cd-error-text cd-error-bg border border-red-200 rounded-xl px-3 py-2">
          {error}
        </div>
      )}

      <div className="sm:col-span-2 flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold cd-text-muted flex items-center gap-1"
        >
          <X className="w-3.5 h-3.5" /> 취소
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="rounded-xl px-3 py-2 text-xs font-bold text-white cd-fill-primary shadow-sm flex items-center gap-1 disabled:opacity-60"
        >
          <Save className="w-3.5 h-3.5" />
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>
  );
}

interface OperatingEntitySearchResult {
  facilityId: string;
  companyName: string;
  businessRegistrationNo: string | null;
  siteAddress: string | null;
}

interface OperatingEntityLinkCandidate {
  facilityId?: string;
  companyName: string;
  businessRegistrationNo: string | null;
  siteAddress: string | null;
  phoneNumber?: string | null;
}

function OperatingEntityModal({
  facility,
  onClose,
  onChanged,
}: {
  facility: FacilityDetail;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { theme } = useCdashTheme();
  const existing = facility.operatingEntityInfo;
  const [relationType, setRelationType] = useState<FacilityOperatingRelationType>(
    existing?.relation.relationType ?? "operating_entity"
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OperatingEntitySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<OperatingEntitySearchResult | null>(null);
  const [pendingLink, setPendingLink] = useState<OperatingEntityLinkCandidate | null>(
    existing
      ? {
          facilityId: existing.counterparty.facilityId,
          companyName: existing.counterparty.companyName,
          businessRegistrationNo: existing.counterparty.businessRegistrationNo,
          siteAddress: existing.counterparty.siteAddress,
          phoneNumber: existing.counterparty.phoneNumber,
        }
      : null
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q, limit: "20", sort: "name" });
        const res = await fetch("/api/facilities?" + params.toString(), {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const body = (await res.json()) as { items?: OperatingEntitySearchResult[] };
        setResults(body.items ?? []);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const stageSelected = () => {
    if (!selected) return;
    setPendingLink({
      facilityId: selected.facilityId,
      companyName: formatCompanyName(selected.companyName) ?? selected.companyName,
      businessRegistrationNo: selected.businessRegistrationNo,
      siteAddress: selected.siteAddress,
    });
  };

  const saveLink = async () => {
    if (!pendingLink) return;
    setSaving(true);
    try {
      const payload = pendingLink.facilityId
        ? { relatedFacilityId: pendingLink.facilityId, relationType }
        : {
            entityName: pendingLink.companyName,
            businessRegistrationNo: pendingLink.businessRegistrationNo,
            address: pendingLink.siteAddress,
            phoneNumber: pendingLink.phoneNumber ?? null,
            relationType,
          };
      const res = await fetch("/api/facilities/" + facility.facilityId + "/operating-entity", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      onChanged();
    } catch (err) {
      alert("연결 정보 저장 실패: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const clearOperatingEntity = async () => {
    if (!existing || !window.confirm("현재 사업장에 연결된 운영 주체 정보를 해제할까요? 법인 마스터는 삭제되지 않습니다.")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/facilities/" + facility.facilityId + "/operating-entity", { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      onChanged();
    } catch (err) {
      alert("운영 주체 연결 해제 실패: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const facilityLabel = formatCompanyName(facility.companyName) ?? facility.companyName;
  const trimmedQuery = query.trim();

  const modal = (
    <div className="cdash-vars cd-fields-white fixed inset-0 z-50 bg-stone-950/20 flex items-center justify-center p-4" data-theme={theme}>
      <div className="cd-card rounded-3xl p-5 w-[min(720px,calc(100vw-32px))] max-h-[min(780px,calc(100vh-32px))] overflow-y-auto scrollbar-hide shadow-2xl">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-xl font-bold cd-text">운영 주체 관리</h3>
            <p className="text-xs cd-text-faint mt-1">
              허가 대상 사업장과 실제 계약 상대 법인을 분리해 관리합니다.
            </p>
          </div>
          <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold cd-text-muted">
            닫기
          </button>
        </div>

        <section className="cd-surface-bg border cd-border-c rounded-2xl p-4 flex flex-col gap-3">
          <h4 className="text-sm font-bold cd-text">기존 법인 연결</h4>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 cd-text-faint pointer-events-none" />
            <input
              className="cd-input pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="법인명·사업자번호로 사업장 검색"
            />
          </div>

          {trimmedQuery && (
            <div className="flex flex-wrap gap-1.5">
              {searching && <span className="text-xs cd-text-faint py-1">검색 중…</span>}
              {!searching && results.length === 0 && (
                <span className="text-xs cd-text-faint py-1">검색 결과가 없습니다.</span>
              )}
              {results.map((item) => {
                const isActive = selected?.facilityId === item.facilityId;
                return (
                  <button
                    key={item.facilityId}
                    type="button"
                    onClick={() => setSelected(item)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-bold transition",
                      isActive
                        ? "border-[color:var(--cd-primary)] cd-tint-primary cd-text-primary"
                        : "cd-border-c cd-card-bg cd-text-muted hover:border-[color:var(--cd-primary)]"
                    )}
                  >
                    {formatCompanyName(item.companyName) ?? item.companyName}
                    {item.businessRegistrationNo ? (
                      <span className="ml-1 font-normal cd-text-faint">· {item.businessRegistrationNo}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}

          <select
            className="cd-select"
            value={relationType}
            onChange={(e) => setRelationType(e.target.value as FacilityOperatingRelationType)}
          >
            <option value="operating_entity">운영 주체</option>
            <option value="owner_entity">소유 주체</option>
            <option value="manager_entity">관리 주체</option>
            <option value="other">기타 관계</option>
          </select>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={stageSelected}
              disabled={saving || !selected}
              className="rounded-xl px-3 py-2 text-xs font-bold cd-text-primary cd-tint-primary border border-[color:var(--cd-primary)] disabled:opacity-50"
            >
              선택 법인 연결
            </button>
            <button
              type="button"
              onClick={saveLink}
              disabled={saving || !pendingLink}
              className="rounded-xl px-3 py-2 text-xs font-bold text-white cd-fill-primary disabled:opacity-50"
            >
              {saving ? "저장 중…" : "법인 정보 저장"}
            </button>
          </div>

          {pendingLink && (
            <div className="flex items-center justify-center gap-3 py-3">
              <span className="rounded-full border border-[color:var(--cd-primary)] cd-tint-primary px-3 py-1.5 text-xs font-bold cd-text-primary max-w-[40%] truncate">
                {pendingLink.companyName}
              </span>
              <div className="flex flex-col items-center gap-0.5">
                <ArrowRight className="w-5 h-5 cd-text-faint" />
                <span className="text-[10px] font-bold cd-text-faint">
                  {OPERATING_RELATION_LABELS[relationType]}
                </span>
              </div>
              <span className="rounded-full border cd-border-c cd-card-bg px-3 py-1.5 text-xs font-bold cd-text-muted max-w-[40%] truncate">
                {facilityLabel}
              </span>
            </div>
          )}

          {existing && (
            <button
              type="button"
              onClick={clearOperatingEntity}
              disabled={saving}
              className="rounded-xl px-3 py-2 text-xs font-bold text-amber-800 cd-warn-bg border border-amber-200 disabled:opacity-50"
            >
              현재 운영 주체 연결 해제
            </button>
          )}
        </section>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export function GroupManagementModal({
  facility,
  onClose,
  onChanged,
}: {
  facility: FacilityDetail;
  onClose: () => void;
  onChanged: (groupLabel?: string) => void;
}) {
  const { theme } = useCdashTheme();
  const [groups, setGroups] = useState<FacilityGroupTree[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState(facility.groupInfo?.group.groupId ?? "");
  const [selectedDivisionId, setSelectedDivisionId] = useState(facility.groupInfo?.division?.divisionId ?? "");
  const [selectedCompanyId, setSelectedCompanyId] = useState(facility.groupInfo?.company.companyId ?? "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [divisionName, setDivisionName] = useState("");
  const [companyRole, setCompanyRole] = useState<FacilityGroupCompanyRole>("affiliate");
  const [relationType, setRelationType] = useState<FacilityGroupMembershipRelationType>(
    facility.groupInfo?.membership.relationType === "site"
      ? "operating_company"
      : facility.groupInfo?.membership.relationType ?? "operating_company"
  );
  const selectedGroup = groups.find((group) => group.groupId === selectedGroupId);
  const selectedDivision = selectedGroup?.divisions.find((division) => division.divisionId === selectedDivisionId) ?? null;
  const selectedCompany = selectedGroup?.companies.find((company) => company.companyId === selectedCompanyId);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/facility-groups", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const body = (await res.json()) as { items: FacilityGroupTree[] };
      setGroups(body.items ?? []);
    } catch (err) {
      alert("그룹 조회 실패: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const createGroup = async () => {
    if (!groupName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/facility-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupName }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const body = (await res.json()) as { groupId: string };
      setSelectedGroupId(body.groupId);
      setSelectedDivisionId("");
      setGroupName("");
      await reload();
    } catch (err) {
      alert("그룹 생성 실패: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const renameSelectedGroup = async () => {
    if (!selectedGroupId) return;
    const nextName = window.prompt("수정할 그룹명을 입력하세요.", selectedGroup?.groupName ?? "");
    if (!nextName?.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/facility-groups/" + selectedGroupId, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupName: nextName }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      await reload();
    } catch (err) {
      alert("그룹 수정 실패: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteSelectedGroup = async () => {
    if (!selectedGroupId || !window.confirm("선택한 그룹과 하위 연결 정보를 삭제할까요?")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/facility-groups/" + selectedGroupId, { method: "DELETE" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      setSelectedGroupId("");
      setSelectedDivisionId("");
      setSelectedCompanyId("");
      await reload();
    } catch (err) {
      alert("그룹 삭제 실패: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const createDivision = async () => {
    if (!selectedGroupId || !divisionName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/facility-groups/" + selectedGroupId + "/divisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ divisionName }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const body = (await res.json()) as { divisionId: string };
      setSelectedDivisionId(body.divisionId);
      setDivisionName("");
      await reload();
    } catch (err) {
      alert("부문 생성 실패: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveMembership = async () => {
    if (!selectedGroupId || !selectedCompanyId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/facilities/" + facility.facilityId + "/group-membership", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupId: selectedGroupId,
          companyId: selectedCompanyId,
          relationType,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      const label =
        selectedGroup && selectedCompany
          ? `${selectedGroup.groupName} · ${formatCompanyName(selectedCompany.companyName) ?? selectedCompany.companyName} (${MEMBERSHIP_RELATION_LABELS[relationType]})`
          : undefined;
      onChanged(label);
    } catch (err) {
      alert("그룹 연결 저장 실패: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveGroupDivisionMembership = async () => {
    if (!selectedGroupId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/facilities/" + facility.facilityId + "/group-membership", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupId: selectedGroupId,
          divisionId: selectedDivisionId || null,
          companyRole,
          relationType: "site",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      const body = (await res.json()) as { companyId?: string };
      if (body.companyId) setSelectedCompanyId(body.companyId);
      const label = selectedGroup
        ? `${selectedGroup.groupName}${selectedDivision ? " · " + selectedDivision.divisionName : ""} (사업장 연결)`
        : undefined;
      await reload();
      onChanged(label);
    } catch (err) {
      alert("그룹/부문 설정 저장 실패: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const clearMembership = async () => {
    if (!facility.groupInfo || !window.confirm("현재 사업장에 연결된 운영 법인 정보를 해제할까요? 그룹과 법인 마스터는 삭제되지 않습니다.")) return;
    setSaving(true);
    try {
      const res = await fetch("/api/facilities/" + facility.facilityId + "/group-membership", {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      setSelectedCompanyId("");
      onChanged();
    } catch (err) {
      alert("사업장 운영 법인 연결 해제 실패: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const modal = (
    <div className="cdash-vars cd-fields-white fixed inset-0 z-50 bg-stone-950/20 flex items-center justify-center p-4" data-theme={theme}>
      <div className="cd-card rounded-3xl p-5 w-[min(1120px,calc(100vw-32px))] max-h-[min(820px,calc(100vh-32px))] overflow-y-auto scrollbar-hide shadow-2xl">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-xl font-bold cd-text">그룹 관리</h3>
            <p className="text-xs cd-text-faint mt-1">
              그룹, 부문, 그룹 소속 법인을 관리하고 현재 사업장과의 관계를 연결합니다.
            </p>
          </div>
          <button type="button" onClick={onClose} className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold cd-text-muted">
            닫기
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          <section className="cd-surface-bg border cd-border-c rounded-2xl p-3">
            <h4 className="text-sm font-bold cd-text mb-2">그룹 트리</h4>
            {loading && <div className="text-sm cd-text-faint py-6 text-center">불러오는 중…</div>}
            <div className="flex flex-col gap-2 max-h-[520px] overflow-y-auto scrollbar-hide">
              {groups.map((group) => (
                <button
                  key={group.groupId}
                  type="button"
                  onClick={() => {
                    setSelectedGroupId(group.groupId);
                    setSelectedCompanyId(group.companies[0]?.companyId ?? "");
                    setSelectedDivisionId("");
                  }}
                  className={cn("text-left rounded-xl border p-3", selectedGroupId === group.groupId ? "border-[color:var(--cd-primary)] cd-tint-primary" : "cd-border-c cd-card-bg")}
                >
                  <div className="text-sm font-bold cd-text">{group.groupName}</div>
                  <div className="text-[11px] cd-text-faint mt-1">
                    등록 법인 {group.companies.length}개 · 부문 {group.divisions.length}개
                  </div>
                  <div className="mt-2 flex flex-col gap-1">
                    {group.divisions.map((division) => (
                      <div key={division.divisionId} className="text-[11px] cd-text-muted">
                        {division.divisionName} ({division.companies.length})
                      </div>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <MetricCard label="등록 법인 규모" value={(selectedGroup?.companies.length ?? 0).toLocaleString() + "개"} />
              <MetricCard label="총 매출액" value={selectedGroup?.totalRevenue ? formatNumber(selectedGroup.totalRevenue) ?? "컨셉" : "컨셉"} />
              <MetricCard label="임직원 수" value={selectedGroup?.employeeCount ? selectedGroup.employeeCount.toLocaleString() + "명" : "컨셉"} />
              <MetricCard label="거래 사업장 수" value="현재 0 · 경험 0" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="cd-surface-bg border cd-border-c rounded-2xl p-3 flex flex-col gap-2">
                <h4 className="text-sm font-bold cd-text">그룹 신규 입력</h4>
                <input className="cd-input h-9" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="예: 한화그룹" />
                <button type="button" onClick={createGroup} disabled={saving} className="rounded-xl px-3 py-2 text-xs font-bold text-white cd-fill-primary disabled:opacity-50">
                  그룹 저장
                </button>
              </div>

              <div className="cd-surface-bg border cd-border-c rounded-2xl p-3 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-bold cd-text">부문 신규 입력</h4>
                  <span className="max-w-[55%] truncate rounded-full cd-tint-primary px-2 py-0.5 text-[10px] font-bold cd-text-primary">
                    {selectedGroup?.groupName ?? "그룹 미선택"}
                  </span>
                </div>
                <input className="cd-input h-9" value={divisionName} onChange={(e) => setDivisionName(e.target.value)} placeholder="예: 화학 부문" />
                <button type="button" onClick={createDivision} disabled={saving || !selectedGroupId} className="rounded-xl px-3 py-2 text-xs font-bold text-white cd-fill-primary disabled:opacity-50">
                  부문 저장
                </button>
              </div>

              <div className="cd-surface-bg border cd-border-c rounded-2xl p-3 flex md:row-span-2 min-h-[268px] flex-col gap-3">
                <h4 className="text-sm font-bold cd-text">그룹/부문 적용</h4>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-bold cd-text-faint">선택 그룹</span>
                  <input
                    className="cd-input h-9"
                    value={selectedGroup?.groupName ?? ""}
                    readOnly
                    placeholder="그룹 트리에서 그룹 선택"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <span className="text-[11px] font-bold cd-text-faint">부문 선택</span>
                  <select
                    className="cd-select min-h-[88px] flex-1"
                    size={Math.min(Math.max((selectedGroup?.divisions.length ?? 0) + 1, 3), 5)}
                    value={selectedDivisionId}
                    onChange={(e) => setSelectedDivisionId(e.target.value)}
                    disabled={!selectedGroup}
                  >
                    <option value="">부문 없음</option>
                    {selectedGroup?.divisions.map((division) => (
                      <option key={division.divisionId} value={division.divisionId}>
                        {division.divisionName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedGroup && (
                    <span className="rounded-full cd-tint-primary px-2.5 py-1 text-[11px] font-bold cd-text-primary">
                      {selectedGroup.groupName}
                    </span>
                  )}
                  <span className="rounded-full cd-card-bg border cd-border-c px-2.5 py-1 text-[11px] font-bold cd-text-muted">
                    {selectedDivision?.divisionName ?? "부문 없음"}
                  </span>
                </div>
                <select
                  className="cd-select"
                  value={companyRole}
                  onChange={(e) => setCompanyRole(e.target.value as FacilityGroupCompanyRole)}
                >
                  <option value="group_representative">그룹 대표기업</option>
                  <option value="affiliate">그룹 소속 법인</option>
                  <option value="other">기타 법인</option>
                </select>
                <button
                  type="button"
                  onClick={saveGroupDivisionMembership}
                  disabled={saving || !selectedGroupId}
                  className="mt-auto rounded-xl cd-fill-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                >
                  설정 저장
                </button>
              </div>

              <div className="cd-surface-bg border cd-border-c rounded-2xl p-3 md:col-span-2">
                <h4 className="text-sm font-bold cd-text mb-2">현재 사업장 운영 법인 연결</h4>
                <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_130px] gap-2">
                  <select className="cd-select" value={selectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value)}>
                    <option value="">연결 법인 선택</option>
                    {selectedGroup?.companies.map((company) => (
                      <option key={company.companyId} value={company.companyId}>
                        [{company.groupRole === "group_representative" ? "대표" : company.groupRole === "affiliate" ? "소속" : "기타"}] {company.companyName}
                      </option>
                    ))}
                  </select>
                  <select
                    className="cd-select"
                    value={relationType}
                    onChange={(e) => setRelationType(e.target.value as FacilityGroupMembershipRelationType)}
                  >
                    {EDITABLE_MEMBERSHIP_RELATION_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {MEMBERSHIP_RELATION_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </div>
                {facility.groupInfo && (
                  <div className="mt-2 text-[11px] cd-text-faint">
                    현재 연결: {facility.groupInfo.group.groupName} · {facility.groupInfo.company.companyName} ({MEMBERSHIP_RELATION_LABELS[facility.groupInfo.membership.relationType]})
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <button type="button" onClick={clearMembership} disabled={saving || !facility.groupInfo} className="rounded-lg px-2 py-1 text-[11px] font-bold text-amber-800 cd-warn-bg border border-amber-200 disabled:opacity-50">
                    현재 사업장 연결 해제
                  </button>
                  <button type="button" onClick={renameSelectedGroup} disabled={saving || !selectedGroupId} className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[11px] font-bold cd-text-muted disabled:opacity-50">
                    그룹명 수정
                  </button>
                  <button type="button" onClick={deleteSelectedGroup} disabled={saving || !selectedGroupId} className="rounded-lg px-2 py-1 text-[11px] font-bold cd-error-text cd-error-bg border border-red-200 disabled:opacity-50">
                    그룹 삭제
                  </button>
                  <button type="button" onClick={saveMembership} disabled={saving || !selectedGroupId || !selectedCompanyId} className="ml-auto rounded-lg px-3 py-1 text-[11px] font-bold text-white cd-fill-primary disabled:opacity-50">
                    연결 저장
                  </button>
                </div>
              </div>
            </div>

            <div className="cd-surface-bg border cd-border-c rounded-2xl p-3">
              <h4 className="text-sm font-bold cd-text mb-2">거래 사업장 컨셉 UI</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl cd-card-bg border cd-border-c p-3">
                  <b>현재 거래 사업장</b>
                  <div className="cd-text-faint mt-2">계약 관리 모듈 연동 예정</div>
                </div>
                <div className="rounded-xl cd-card-bg border cd-border-c p-3">
                  <b>거래 경험 사업장</b>
                  <div className="cd-text-faint mt-2">용역 수행 내역 상세 패널 예정</div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl cd-surface-bg border cd-border-c p-3">
      <div className="text-[10px] font-bold cd-text-faint uppercase tracking-wide">{label}</div>
      <div className="text-sm font-bold cd-text mt-1">{value}</div>
    </div>
  );
}

function FieldInput({
  label,
  value,
  onChange,
  full,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  full?: boolean;
  multiline?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", full && "sm:col-span-2")}>
      <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">
        {label}
      </span>
      {multiline ? (
        <textarea
          className="cd-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
        />
      ) : (
        <input
          className="cd-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

function numericInputValue(value: number | null): string {
  return value == null || !Number.isFinite(Number(value)) ? "" : String(value);
}

function productAmountInputValue(value: number | string | null): string {
  return value == null ? "" : String(value);
}

function parseNumericInput(value: unknown): number | null {
  if (value == null || !String(value).trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function DetailField({
  icon: Icon,
  label,
  value,
  secondary,
  multiline,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
  secondary?: string | null;
  multiline?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 border cd-border-c rounded-xl p-3">
      <span className="text-[10px] font-bold cd-text-faint uppercase tracking-wide flex items-center gap-1">
        <Icon className="w-3 h-3" /> {label}
      </span>
      <span
        className={cn(
          "text-sm cd-text",
          multiline ? "whitespace-pre-wrap" : "truncate"
        )}
      >
        {value ?? <span className="cd-text-faint">—</span>}
      </span>
      {secondary && <span className="text-[10px] cd-text-faint">{secondary}</span>}
    </div>
  );
}

function AnnualReportSection({
  facilityId,
  annualReport,
  canEdit,
  onChanged,
}: {
  facilityId: string;
  annualReport: AnnualReportSnapshot | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!annualReport) return null;
  const hasAir = annualReport.airClass != null || annualReport.airAmountTonPerYear != null;
  const hasWater = annualReport.waterClass != null || annualReport.wastewaterM3PerDay != null;
  const hasProducts = annualReport.products.length > 0;
  if (!hasAir && !hasWater && !hasProducts) return null;
  if (editing) {
    return (
      <AnnualReportEditForm
        facilityId={facilityId}
        annualReport={annualReport}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onChanged();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold cd-text-faint uppercase tracking-wide flex items-center gap-1">
          <ClipboardList className="w-3 h-3" /> 연간보고서 (최신 스냅샷)
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[10px] font-bold cd-text-muted"
            >
              편집
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm("연간보고서 최신 스냅샷을 삭제할까요?")) return;
                const res = await fetch("/api/facilities/" + facilityId + "/annual-report", {
                  method: "DELETE",
                });
                if (!res.ok) {
                  const body = await res.json().catch(() => ({}));
                  alert("연간보고서 삭제 실패: " + (body?.error ?? res.status));
                  return;
                }
                onChanged();
              }}
              className="rounded-lg px-2 py-1 text-[10px] font-bold cd-error-text cd-error-bg border border-red-200"
            >
              삭제
            </button>
          </div>
        )}
      </div>
      <div className="cd-warn-bg/40 border border-amber-200/50 rounded-xl p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-[11px] cd-text-muted">
            출처: 연간(점검)보고서 · 사업장당 1건 보존
          </div>
          {annualReport.parsedAt && (
            <div className="text-[10px] cd-text-faint">
              파싱: {annualReport.parsedAt.slice(0, 10)}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          {annualReport.airClass != null && (
            <span className="cd-surface-bg px-2 py-0.5 rounded">
              대기 {annualReport.airClass}종
              {annualReport.airAmountTonPerYear != null
                ? " · " + annualReport.airAmountTonPerYear + " 톤/년"
                : ""}
            </span>
          )}
          {annualReport.waterClass != null && (
            <span className="cd-surface-bg px-2 py-0.5 rounded">
              수질 {annualReport.waterClass}종
              {annualReport.wastewaterM3PerDay != null
                ? " · " + annualReport.wastewaterM3PerDay + " m³/일"
                : ""}
            </span>
          )}
        </div>
        {hasProducts && (
          <div className="text-[11px] cd-text-muted flex flex-col gap-0.5 mt-1">
            <div className="text-[10px] font-bold cd-text-faint uppercase tracking-wide mt-1">
              주요 생산품
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {annualReport.products.map((prod, i) => (
                <ProductTagCard
                  key={i}
                  name={prod.productName}
                  amount={prod.amount}
                  unit={prod.unit}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AnnualReportEditForm({
  facilityId,
  annualReport,
  onCancel,
  onSaved,
}: {
  facilityId: string;
  annualReport: AnnualReportSnapshot;
  onCancel: () => void;
  onSaved: () => void;
}) {
  type EditableAnnualProduct = { productName: string; amount: string; unit: string };
  const [reportYear, setReportYear] = useState(annualReport.reportYear?.toString() ?? "");
  const [airClass, setAirClass] = useState(annualReport.airClass?.toString() ?? "");
  const [airAmount, setAirAmount] = useState(
    annualReport.airAmountTonPerYear?.toString() ?? ""
  );
  const [waterClass, setWaterClass] = useState(annualReport.waterClass?.toString() ?? "");
  const [waterAmount, setWaterAmount] = useState(
    annualReport.wastewaterM3PerDay?.toString() ?? ""
  );
  const [products, setProducts] = useState<EditableAnnualProduct[]>(
    annualReport.products.length
      ? annualReport.products.map((product) => ({
          productName: product.productName ?? "",
          amount: product.amount?.toString() ?? "",
          unit: product.unit ?? "",
        }))
      : [{ productName: "", amount: "", unit: "" }]
  );
  const [pending, setPending] = useState(false);

  const save = async () => {
    setPending(true);
    try {
      const res = await fetch("/api/facilities/" + facilityId + "/annual-report", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reportYear: reportYear || null,
          airClass: airClass || null,
          airAmountTonPerYear: airAmount || null,
          waterClass: waterClass || null,
          wastewaterM3PerDay: waterAmount || null,
          products: products.map((product) => ({
            productName: product.productName,
            amount: product.amount || null,
            unit: product.unit || null,
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      onSaved();
    } catch (err) {
      alert("연간보고서 저장 실패: " + (err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="cd-warn-bg/40 border border-amber-200/50 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold cd-text-faint uppercase tracking-wide flex items-center gap-1">
          <ClipboardList className="w-3 h-3" /> 연간보고서 스냅샷 편집
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <FieldInput label="보고연도" value={reportYear} onChange={setReportYear} />
        <div />
        <FieldInput label="대기 종" value={airClass} onChange={setAirClass} />
        <FieldInput label="대기 발생량(톤/년)" value={airAmount} onChange={setAirAmount} />
        <FieldInput label="수질 종" value={waterClass} onChange={setWaterClass} />
        <FieldInput label="폐수배출량(㎥/일)" value={waterAmount} onChange={setWaterAmount} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">
            주요 생산품
          </span>
          <button
            type="button"
            onClick={() => setProducts([...products, { productName: "", amount: "", unit: "" }])}
            className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[10px] font-bold"
          >
            행 추가
          </button>
        </div>
        {products.map((product, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_90px_70px_32px] gap-2">
            <input
              className="cd-input text-xs"
              placeholder="품목명"
              value={product.productName}
              onChange={(e) => {
                const next = [...products];
                next[idx] = { ...product, productName: e.target.value };
                setProducts(next);
              }}
            />
            <input
              className="cd-input text-xs"
              placeholder="생산량"
              value={product.amount}
              onChange={(e) => {
                const next = [...products];
                next[idx] = { ...product, amount: e.target.value };
                setProducts(next);
              }}
            />
            <input
              className="cd-input text-xs"
              placeholder="단위"
              value={product.unit}
              onChange={(e) => {
                const next = [...products];
                next[idx] = { ...product, unit: e.target.value };
                setProducts(next);
              }}
            />
            <button
              type="button"
              onClick={() => setProducts(products.filter((_, i) => i !== idx))}
              className="rounded-lg cd-error-text cd-error-bg border border-red-200 text-xs font-bold"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold">
          취소
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-xl px-3 py-2 text-xs font-bold text-white cd-fill-primary disabled:opacity-60"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>
  );
}

function PermitsSection({
  detail,
  canEdit,
  onChanged,
}: {
  detail: FacilityDetail;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<PermitDetail | "new" | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold cd-text-faint uppercase tracking-wide">
          허가 / 종 규모 / 생산품
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="cd-btn cd-btn-ghost rounded-xl px-2 py-1 text-[11px] font-bold cd-text-muted flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> 허가 추가
          </button>
        )}
      </div>
      {detail.permits.length === 0 && !editing && (
        <div className="text-xs cd-text-faint text-center py-6">
          등록된 허가 정보가 없습니다.
        </div>
      )}
      {editing && (
        <PermitEditForm
          facilityId={detail.facilityId}
          permit={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
      {detail.permits.map((p) => (
        <div
          key={p.permitId}
          className="cd-surface-bg border cd-border-c rounded-xl p-4 flex flex-col gap-2"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-sm font-bold cd-text">
                {p.decisionNo ?? "(결정번호 없음)"}
              </div>
              <div className="text-[10px] cd-text-faint font-mono">
                {p.permitId}
                {p.sourceAttachmentId ? " · " + p.sourceAttachmentId : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[11px] cd-text-faint">
                {p.permitDate ?? "—"}
                {p.isFirstPermit ? (
                  <span className="ml-2 text-[10px] cd-text-primary font-bold cd-tint-primary px-2 py-0.5 rounded-full">
                    최초허가
                  </span>
                ) : null}
              </div>
              {canEdit && (
                <>
                  <button
                    type="button"
                    onClick={() => setEditing(p)}
                    className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[10px] font-bold cd-text-muted"
                  >
                    편집
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm("이 허가 정보를 삭제할까요?")) return;
                      const res = await fetch("/api/permits/" + p.permitId, { method: "DELETE" });
                      if (!res.ok) {
                        const body = await res.json().catch(() => ({}));
                        alert("허가 삭제 실패: " + (body?.error ?? res.status));
                        return;
                      }
                      onChanged();
                    }}
                    className="rounded-lg px-2 py-1 text-[10px] font-bold cd-error-text cd-error-bg border border-red-200"
                  >
                    삭제
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {p.airClass != null && (
              <span className="cd-surface-bg px-2 py-0.5 rounded">
                대기 {p.airClass}종 · {p.airAmount ?? "—"} 톤/년
              </span>
            )}
            {p.waterClass != null && (
              <span className="cd-surface-bg px-2 py-0.5 rounded">
                수질 {p.waterClass}종 · {p.waterAmount ?? "—"} m³/일
              </span>
            )}
            {p.attachmentFileName && (
              <span className="cd-text-faint ml-auto truncate max-w-[60%]">
                {p.attachmentFileName}
              </span>
            )}
          </div>
          {p.products.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 mt-2">
              {p.products.map((prod, i) => (
                <ProductTagCard
                  key={i}
                  name={prod.productName}
                  amount={prod.productionAmount}
                  unit={prod.productionUnit}
                />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function ProductTagCard({
  name,
  amount,
  unit,
}: {
  name: string | null;
  amount: number | string | null;
  unit: string | null;
}) {
  return (
    <div className="rounded-lg cd-card-bg border cd-border-c px-3 py-2 min-w-0">
      <div className="text-[11px] font-bold cd-text-muted truncate">
        {cleanProductName(name) ?? "(상품명 없음)"}
      </div>
      <div className="mt-1 flex items-baseline justify-end gap-1 text-right">
        <span className="font-mono text-xs font-bold cd-text tabular-nums">
          {formatNumber(amount) ?? "—"}
        </span>
        {unit && <span className="text-[10px] cd-text-faint shrink-0">{unit}</span>}
      </div>
    </div>
  );
}

function PermitEditForm({
  facilityId,
  permit,
  onCancel,
  onSaved,
}: {
  facilityId: string;
  permit: PermitDetail | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  type EditableProductOutput = Omit<ProductOutput, "productionAmount"> & {
    productionAmount: number | string | null;
  };
  const [decisionNo, setDecisionNo] = useState(permit?.decisionNo ?? "");
  const [permitType, setPermitType] = useState(permit?.permitType ?? "");
  const [permitDate, setPermitDate] = useState(permit?.permitDate ?? "");
  const [isFirstPermit, setIsFirstPermit] = useState(Boolean(permit?.isFirstPermit));
  const [airClass, setAirClass] = useState(permit?.airClass?.toString() ?? "");
  const [airAmount, setAirAmount] = useState(permit?.airAmount?.toString() ?? "");
  const [waterClass, setWaterClass] = useState(permit?.waterClass?.toString() ?? "");
  const [waterAmount, setWaterAmount] = useState(permit?.waterAmount?.toString() ?? "");
  const [products, setProducts] = useState<EditableProductOutput[]>(
    permit?.products.length
      ? permit.products.map((product) => ({
          ...product,
          productionAmount: numericInputValue(product.productionAmount),
        }))
      : [{ productName: "", productionAmount: null, productionUnit: "", sourcePage: null, sourceText: null }]
  );
  const [pending, setPending] = useState(false);

  const save = async () => {
    setPending(true);
    try {
      const payload = {
        decisionNo: decisionNo || null,
        permitType: permitType || null,
        permitDate: permitDate || null,
        isFirstPermit,
        airClass: airClass || null,
        airAmount: airAmount || null,
        waterClass: waterClass || null,
        waterAmount: waterAmount || null,
        products: products.map((p) => ({
          productName: cleanProductName(p.productName),
          productionAmount: parseNumericInput(p.productionAmount),
          productionUnit: p.productionUnit,
        })),
      };
      const res = await fetch(
        permit ? "/api/permits/" + permit.permitId : "/api/facilities/" + facilityId + "/permits",
        {
          method: permit ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      onSaved();
    } catch (err) {
      alert("허가 저장 실패: " + (err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="cd-tint-primary border border-[color:var(--cd-primary)] rounded-xl p-4 flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <FieldInput label="결정번호" value={decisionNo} onChange={setDecisionNo} />
        <FieldInput label="허가유형" value={permitType} onChange={setPermitType} />
        <FieldInput label="허가일자" value={permitDate} onChange={setPermitDate} />
        <label className="flex items-center gap-2 text-xs font-bold cd-text-muted pt-6">
          <input type="checkbox" checked={isFirstPermit} onChange={(e) => setIsFirstPermit(e.target.checked)} />
          최초허가
        </label>
        <FieldInput label="대기 종" value={airClass} onChange={setAirClass} />
        <FieldInput label="대기 발생량(톤/년)" value={airAmount} onChange={setAirAmount} />
        <FieldInput label="수질 종" value={waterClass} onChange={setWaterClass} />
        <FieldInput label="폐수배출량(㎥/일)" value={waterAmount} onChange={setWaterAmount} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold cd-text-faint uppercase tracking-wide">생산품</span>
          <button
            type="button"
            onClick={() => setProducts([...products, { productName: "", productionAmount: null, productionUnit: "", sourcePage: null, sourceText: null }])}
            className="cd-btn cd-btn-ghost rounded-lg px-2 py-1 text-[10px] font-bold"
          >
            행 추가
          </button>
        </div>
        {products.map((product, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_90px_70px_32px] gap-2">
            <input
              className="cd-input text-xs"
              placeholder="품목명"
              value={product.productName ?? ""}
              onChange={(e) => {
                const next = [...products];
                next[idx] = { ...product, productName: e.target.value };
                setProducts(next);
              }}
            />
            <input
              className="cd-input text-xs"
              placeholder="생산량"
              value={productAmountInputValue(product.productionAmount)}
              onChange={(e) => {
                const next = [...products];
                next[idx] = { ...product, productionAmount: e.target.value };
                setProducts(next);
              }}
            />
            <input
              className="cd-input text-xs"
              placeholder="단위"
              value={product.productionUnit ?? ""}
              onChange={(e) => {
                const next = [...products];
                next[idx] = { ...product, productionUnit: e.target.value };
                setProducts(next);
              }}
            />
            <button
              type="button"
              onClick={() => setProducts(products.filter((_, i) => i !== idx))}
              className="rounded-lg cd-error-text cd-error-bg border border-red-200 text-xs font-bold"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="cd-btn cd-btn-ghost rounded-xl px-3 py-2 text-xs font-bold">
          취소
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-xl px-3 py-2 text-xs font-bold text-white cd-fill-primary disabled:opacity-60"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>
  );
}
