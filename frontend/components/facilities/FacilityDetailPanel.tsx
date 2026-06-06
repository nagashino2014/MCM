"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Pencil, Save, X, MapPin, Phone, Hash, Building2, FileText, Layers, ClipboardList, Trash2, Plus, History, Upload, Tags, Briefcase, FolderTree } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnnualReportSnapshot, FacilityDetail, PermitDetail, ProductOutput } from "@/lib/ieps/types-facility";
import { cleanProductName, formatAddress, formatBusinessRegistrationNo, formatCompanyName, formatNumber, parseIndustriesFromValue } from "@/lib/ieps/formatters";
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
import type { FacilityOperatingRelationType, LegalEntity } from "@/lib/ieps/legal-entity";
import { FacilityOrdersModal } from "@/components/facilities/FacilityOrdersModal";

const GROUP_COMPANY_ROLE_LABELS: Record<FacilityGroupCompanyRole, string> = {
  group_representative: "그룹 대표기업",
  affiliate: "그룹 소속 법인",
  other: "기타 법인",
};

const MEMBERSHIP_RELATION_LABELS: Record<FacilityGroupMembershipRelationType, string> = {
  site: "사업장 연결(기존)",
  operating_company: "사업장 운영 법인",
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
  eventDate: string | null;
  previousCompanyName: string | null;
  newCompanyName: string | null;
  previousBusinessRegistrationNo: string | null;
  newBusinessRegistrationNo: string | null;
  previousGroupName: string | null;
  newGroupName: string | null;
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
      <section className="glass-card rounded-3xl p-10 text-center text-stone-500 text-sm reveal delay-2">
        좌측 목록에서 사업장을 선택하세요.
      </section>
    );
  }
  if (loading) {
    return (
      <section className="glass-card rounded-3xl p-10 text-center text-stone-400 text-sm reveal delay-2">
        로딩 중…
      </section>
    );
  }
  if (error) {
    return (
      <section className="glass-card rounded-3xl p-10 text-center text-red-600 text-sm font-bold reveal delay-2">
        조회 실패: {error}
      </section>
    );
  }
  if (!detail) {
    return (
      <section className="glass-card rounded-3xl p-10 text-center text-stone-500 text-sm reveal delay-2">
        해당 사업장을 찾을 수 없습니다.
      </section>
    );
  }
  const hasIntegratedService =
    detail.serviceCategories.length === 0 || detail.serviceCategories.includes("integrated");

  return (
    <section className="glass-panel rounded-3xl p-6 reveal delay-2 flex flex-col gap-5 max-h-[calc(100vh-160px)] overflow-y-auto">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <LogoPreview path={detail.logoPath} label={detail.companyName} />
          <div className="min-w-0">
            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wide">
              FACILITY · {detail.source.toUpperCase()}
            </div>
            <h2 className="text-2xl font-bold text-stone-800 mt-0.5 truncate">
              {formatCompanyName(detail.companyName)}
            </h2>
            <div className="text-xs text-stone-500 mt-1">
              facility_id: <span className="font-mono">{detail.facilityId}</span>
            </div>
          </div>
        </div>
        {!editing && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOrdersOpen(true)}
              className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700 flex items-center gap-1"
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
                  className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700 flex items-center gap-1"
                >
                  <History className="w-3.5 h-3.5" /> 이력
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700 flex items-center gap-1"
                >
                  <Pencil className="w-3.5 h-3.5" /> 편집
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setDeleteConfirmOpen(true)}
                  className="rounded-xl px-3 py-2 text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 flex items-center gap-1 disabled:opacity-60"
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
          <div className="glass-panel rounded-3xl p-5 w-full max-w-md">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-lg font-bold text-stone-800">사업장 휴지통 이동</h3>
                <p className="text-sm text-stone-600 mt-2">
                  <span className="font-bold text-stone-900">{formatCompanyName(detail.companyName)}</span> 사업장을 휴지통으로 이동합니다.
                  관련 허가/생산품/연간보고 데이터는 보존되며, 목록에서는 제외됩니다.
                </p>
              </div>
              <button type="button" onClick={() => setDeleteConfirmOpen(false)} className="glass-button rounded-full p-2">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteConfirmOpen(false)} className="glass-button rounded-xl px-4 py-2 text-sm font-bold">
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
                className="rounded-xl px-4 py-2 text-sm font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60"
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

function FacilityHistoryModal({
  facility,
  canEdit,
  anchor,
  onClose,
}: {
  facility: FacilityDetail;
  canEdit: boolean;
  anchor: { top: number; left: number } | null;
  onClose: () => void;
}) {
  const [items, setItems] = useState<FacilityHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [eventType, setEventType] = useState<FacilityHistoryEventType>("company_name_change");
  const [eventDate, setEventDate] = useState("");
  const [previousCompanyName, setPreviousCompanyName] = useState("");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [previousBusinessRegistrationNo, setPreviousBusinessRegistrationNo] = useState("");
  const [newBusinessRegistrationNo, setNewBusinessRegistrationNo] = useState("");
  const [previousGroupName, setPreviousGroupName] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [relatedCompanyName, setRelatedCompanyName] = useState("");
  const [memo, setMemo] = useState("");
  const [mounted, setMounted] = useState(false);
  const [editingHistoryId, setEditingHistoryId] = useState<number | null>(null);

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
  }, [reload]);

  const resetForm = () => {
    setEditingHistoryId(null);
    setEventType("company_name_change");
    setEventDate("");
    setPreviousCompanyName("");
    setNewCompanyName("");
    setPreviousBusinessRegistrationNo("");
    setNewBusinessRegistrationNo("");
    setPreviousGroupName("");
    setNewGroupName("");
    setRelatedCompanyName("");
    setMemo("");
  };

  const startEdit = (item: FacilityHistoryItem) => {
    setEditingHistoryId(item.id);
    setEventType(item.eventType);
    setEventDate(item.eventDate ?? "");
    setPreviousCompanyName(item.previousCompanyName ?? "");
    setNewCompanyName(item.newCompanyName ?? "");
    setPreviousBusinessRegistrationNo(item.previousBusinessRegistrationNo ?? "");
    setNewBusinessRegistrationNo(item.newBusinessRegistrationNo ?? "");
    setPreviousGroupName(item.previousGroupName ?? "");
    setNewGroupName(item.newGroupName ?? "");
    setRelatedCompanyName(item.relatedCompanyName ?? "");
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
            eventType,
            eventDate: eventDate || null,
            previousCompanyName: previousCompanyName || null,
            newCompanyName: newCompanyName || null,
            previousBusinessRegistrationNo: previousBusinessRegistrationNo || null,
            newBusinessRegistrationNo: newBusinessRegistrationNo || null,
            previousGroupName: previousGroupName || null,
            newGroupName: newGroupName || null,
            relatedCompanyName: relatedCompanyName || null,
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
      className="fixed z-50 w-[min(820px,calc(100vw-32px))] max-h-[min(820px,calc(100vh-24px))] overflow-y-auto scrollbar-hide rounded-3xl shadow-2xl"
      style={{ top, left }}
    >
      <div className="glass-panel rounded-3xl p-6 flex flex-col gap-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-bold text-stone-800 flex items-center gap-2">
              <History className="w-5 h-5 text-primary" /> 사업장 이력
            </h3>
            <p className="text-xs text-stone-500 mt-1">
              {formatCompanyName(facility.companyName)} · facility_id:{" "}
              <span className="font-mono">{facility.facilityId}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700"
          >
            닫기
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {loading && <div className="text-sm text-stone-400 py-8 text-center">이력 조회 중…</div>}
          {!loading && items.length === 0 && (
            <div className="text-sm text-stone-400 py-8 text-center">
              등록된 사업장 이력이 없습니다.
            </div>
          )}
          {items.map((item) => (
            <div
              key={item.id}
              className={cn(
                "bg-white/50 border rounded-xl p-3",
                editingHistoryId === item.id ? "border-primary/40" : "border-white/60"
              )}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-sm font-bold text-stone-800">
                  {FACILITY_HISTORY_EVENT_LABELS[item.eventType]}
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-[11px] text-stone-400">
                    {item.eventDate ?? item.createdAt.slice(0, 10)} · {item.source}
                  </div>
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(item)}
                        className="glass-button rounded-lg px-2 py-1 text-[10px] font-bold text-stone-700"
                      >
                        편집
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteHistory(item)}
                        className="rounded-lg px-2 py-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200"
                      >
                        삭제
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-xs text-stone-600">
                <HistoryDiff label="상호" before={item.previousCompanyName} after={item.newCompanyName} />
                <HistoryDiff
                  label="사업자번호"
                  before={item.previousBusinessRegistrationNo}
                  after={item.newBusinessRegistrationNo}
                />
                <HistoryDiff label="계열/그룹" before={item.previousGroupName} after={item.newGroupName} />
                {item.relatedCompanyName && (
                  <div>관련 업체: <b>{item.relatedCompanyName}</b></div>
                )}
              </div>
              {item.memo && <div className="text-xs text-stone-500 mt-2">{item.memo}</div>}
            </div>
          ))}
        </div>

        {canEdit && (
          <div className="border-t border-stone-200/70 pt-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-stone-700">
                {editingHistoryId ? "이력 편집" : "이력 추가"}
              </h4>
              {editingHistoryId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="glass-button rounded-lg px-2 py-1 text-[10px] font-bold text-stone-700"
                >
                  새 이력 입력
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SelectField
                label="이력 유형"
                value={eventType}
                onChange={(value) => setEventType(value as FacilityHistoryEventType)}
              />
              <FieldInput label="발생일" value={eventDate} onChange={setEventDate} />
              <FieldInput label="이전 상호" value={previousCompanyName} onChange={setPreviousCompanyName} />
              <FieldInput label="변경 상호" value={newCompanyName} onChange={setNewCompanyName} />
              <FieldInput
                label="이전 사업자번호"
                value={previousBusinessRegistrationNo}
                onChange={setPreviousBusinessRegistrationNo}
              />
              <FieldInput
                label="변경 사업자번호"
                value={newBusinessRegistrationNo}
                onChange={setNewBusinessRegistrationNo}
              />
              <FieldInput label="이전 계열/그룹" value={previousGroupName} onChange={setPreviousGroupName} />
              <FieldInput label="변경 계열/그룹" value={newGroupName} onChange={setNewGroupName} />
              <FieldInput label="관련 업체" value={relatedCompanyName} onChange={setRelatedCompanyName} />
              <div className="sm:col-span-2 flex flex-col gap-1.5">
                <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">
                  메모
                </span>
                <textarea className="ui-textarea" value={memo} onChange={(e) => setMemo(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="rounded-xl px-4 py-2 text-sm font-bold text-white bg-primary hover:bg-primary/90 disabled:opacity-60"
              >
                {saving ? "저장 중…" : editingHistoryId ? "이력 수정" : "이력 저장"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
  return mounted ? createPortal(modal, document.body) : null;
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
      {label}: <span className="text-stone-400">{before ?? "—"}</span>
      <span className="mx-1 text-stone-400">→</span>
      <b>{after ?? "—"}</b>
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">
        {label}
      </span>
      <select className="ui-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(FACILITY_HISTORY_EVENT_LABELS).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
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
          className="rounded-full px-2 py-0.5 text-[10px] font-bold text-stone-800 border border-white/70"
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
      className="w-14 h-14 rounded-2xl object-contain bg-white/80 border border-white/70 p-1"
    />
  ) : (
    <div className="w-14 h-14 rounded-2xl bg-white/60 border border-white/70 flex items-center justify-center">
      <Building2 className="w-6 h-6 text-stone-300" />
    </div>
  );
}

function GroupInfoCard({ detail }: { detail: FacilityDetail }) {
  const groupInfo = detail.groupInfo;
  return (
    <div className="flex flex-col gap-1 bg-white/40 border border-white/50 rounded-xl p-3 sm:col-span-2">
      <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wide flex items-center gap-1">
        <Briefcase className="w-3 h-3" /> 그룹 정보
      </span>
      {groupInfo ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-stone-700">
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
        <div className="text-sm text-stone-400">그룹 정보 없음</div>
      )}
    </div>
  );
}

function OperatingEntityCard({ detail }: { detail: FacilityDetail }) {
  const info = detail.operatingEntityInfo;
  return (
    <div className="flex flex-col gap-1 bg-white/40 border border-white/50 rounded-xl p-3 sm:col-span-2">
      <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wide flex items-center gap-1">
        <Briefcase className="w-3 h-3" /> 운영 주체
      </span>
      {info ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-stone-700">
          <div>
            법인명: <b>{formatCompanyName(info.entity.entityName)}</b>
          </div>
          <div>
            관계: <b>{OPERATING_RELATION_LABELS[info.relation.relationType]}</b>
          </div>
          <div>사업자번호: <b>{formatBusinessRegistrationNo(info.entity.businessRegistrationNo) ?? "—"}</b></div>
          <div>전화번호: <b>{info.entity.phoneNumber ?? "—"}</b></div>
          <div className="sm:col-span-2">
            소재지: <b>{formatAddress(info.entity.address) ?? "—"}</b>
          </div>
        </div>
      ) : (
        <div className="text-sm text-stone-400">운영 주체 정보 없음</div>
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
    <div className="flex flex-col gap-1 bg-white/40 border border-white/50 rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wide flex items-center gap-1">
          <Phone className="w-3 h-3" /> 전화번호
        </span>
        <button
          type="button"
          onClick={onOpenContacts}
          className="glass-button rounded-lg px-2 py-1 text-[10px] font-bold text-stone-700"
        >
          연락처/담당자 관리
        </button>
      </div>
      <div className="text-sm font-semibold text-stone-800 whitespace-pre-line">{value || "—"}</div>
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
    <div className="fixed inset-0 z-50 bg-stone-950/20 flex items-center justify-center p-4">
      <div className="glass-panel rounded-3xl p-5 w-[min(1120px,calc(100vw-32px))] max-h-[min(840px,calc(100vh-32px))] overflow-y-auto scrollbar-hide shadow-2xl">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-xl font-bold text-stone-800">연락처/담당자 관리</h3>
            <p className="text-xs text-stone-500 mt-1">
              {formatCompanyName(facility.companyName)} · 기존 파싱 전화번호: {facility.phoneNumber ?? "—"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700">
            닫기
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
          <section className="bg-white/45 border border-white/60 rounded-2xl p-3">
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button type="button" onClick={() => setTab("department")} className={cn("rounded-xl px-3 py-2 text-xs font-bold", tab === "department" ? "bg-primary text-white" : "glass-button text-stone-700")}>
                부서별
              </button>
              <button type="button" onClick={() => setTab("person")} className={cn("rounded-xl px-3 py-2 text-xs font-bold", tab === "person" ? "bg-primary text-white" : "glass-button text-stone-700")}>
                담당자별
              </button>
            </div>
            {loading && <div className="text-sm text-stone-400 text-center py-8">연락처 조회 중…</div>}
            {!loading && tab === "department" && (
              <div className="flex flex-col gap-2 max-h-[600px] overflow-y-auto scrollbar-hide">
                {departments.length === 0 && <div className="text-sm text-stone-400 text-center py-8">등록된 부서가 없습니다.</div>}
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
                      className={cn("text-left rounded-xl border p-3", selectedDepartmentId === department.id ? "border-primary/40 bg-primary/10" : "border-white/60 bg-white/50")}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-stone-800 truncate">{department.departmentName}</span>
                        <span className="text-[10px] font-bold text-stone-500 bg-white/70 rounded-full px-2 py-0.5">{count}건</span>
                      </div>
                      <div className="text-[11px] text-stone-500 mt-1">{department.phoneNumber ?? "전화번호 없음"}</div>
                    </button>
                  );
                })}
              </div>
            )}
            {!loading && tab === "person" && (
              <div className="flex flex-col gap-2 max-h-[600px] overflow-y-auto scrollbar-hide">
                {people.length === 0 && <div className="text-sm text-stone-400 text-center py-8">등록된 담당자가 없습니다.</div>}
                {people.map((person) => (
                  <button
                    key={person.id}
                    type="button"
                    onClick={() => {
                      setTab("person");
                      setSelectedPersonId(person.id);
                      setEditing(false);
                    }}
                    className={cn("text-left rounded-xl border p-3", selectedPersonId === person.id ? "border-primary/40 bg-primary/10" : "border-white/60 bg-white/50")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold text-stone-800 truncate">{person.personName}</span>
                      <span className="text-[10px] text-stone-500 truncate">{departmentName(person.departmentId)}</span>
                    </div>
                    <div className="text-[11px] text-stone-500 mt-1">{person.title ?? "직함 미입력"}</div>
                  </button>
                ))}
              </div>
            )}
            <div className="mt-3 pt-3 border-t border-white/60">
              <div className="rounded-2xl bg-white/60 border border-white/70 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div>
                    <div className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">
                      대표번호
                    </div>
                    {!mainNumberEditing && (
                      <div className="text-sm font-bold text-stone-800 mt-1">
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
                      className="glass-button rounded-lg px-2 py-1 text-[11px] font-bold text-stone-700"
                    >
                      {mainNumber?.phoneNumber ? "수정" : "등록"}
                    </button>
                  )}
                </div>
                {mainNumberEditing ? (
                  <div className="flex flex-col gap-2">
                    <input
                      className="input-field"
                      value={mainNumberForm.phoneNumber}
                      onChange={(e) => setMainNumberForm((prev) => ({ ...prev, phoneNumber: e.target.value }))}
                      placeholder="대표번호"
                    />
                    <input
                      className="input-field"
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
                        className="glass-button rounded-lg px-2 py-1 text-[11px] font-bold text-stone-700"
                      >
                        취소
                      </button>
                      <button
                        type="button"
                        onClick={saveMainNumber}
                        disabled={saving}
                        className="rounded-lg px-2 py-1 text-[11px] font-bold text-white bg-primary disabled:opacity-50"
                      >
                        저장
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {mainNumber?.note && <div className="text-[11px] text-stone-500 mt-1">{mainNumber.note}</div>}
                    {!mainNumber?.phoneNumber && facility.phoneNumber && (
                      <div className="text-[10px] text-stone-400 mt-1">현재 파싱 전화번호를 참고값으로 표시 중</div>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>

          <section className="bg-white/45 border border-white/60 rounded-2xl p-4 min-h-[620px]">
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
          <div className="rounded-2xl bg-white/50 border border-white/60 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h4 className="text-sm font-bold text-stone-800">소속 직원</h4>
              {canEdit && (
                <button type="button" onClick={onAddPerson} className="glass-button rounded-lg px-2 py-1 text-[11px] font-bold text-stone-700">
                  담당자 추가
                </button>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {people.length === 0 && <div className="text-sm text-stone-400 py-4 text-center">등록된 담당 직원이 없습니다.</div>}
              {people.map((person) => (
                <button key={person.id} type="button" onClick={() => onSelectPerson(person.id)} className="text-left rounded-xl bg-white/60 border border-white/60 p-2">
                  <span className="text-sm font-bold text-stone-800">{person.personName}</span>
                  <span className="text-xs text-stone-500 ml-2">{person.title ?? "직함 미입력"}</span>
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
            <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">소속 부서</span>
            <select className="ui-select" value={form.departmentId} onChange={(e) => onFormChange({ ...form, departmentId: e.target.value })}>
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
            <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">상태</span>
            <select className="ui-select" value={form.status} onChange={(e) => onFormChange({ ...form, status: e.target.value })}>
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
          <div className="rounded-2xl bg-white/50 border border-white/60 p-3">
            <h4 className="text-sm font-bold text-stone-800 mb-2">담당자 이력</h4>
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
      <div className="text-sm text-stone-400">{title}</div>
      {canEdit && (
        <button type="button" onClick={onNew} className="rounded-xl px-4 py-2 text-sm font-bold text-white bg-primary">
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
      <h4 className="text-lg font-bold text-stone-800">{title}</h4>
      {canEdit && !editing && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={onNew} className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700">
            신규
          </button>
          <button type="button" onClick={onEdit} className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700">
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
      <button type="button" onClick={onDelete} className="rounded-xl px-3 py-2 text-xs font-bold text-red-700 bg-red-50 border border-red-200">
        삭제
      </button>
      <button type="button" onClick={onCancel} className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700">
        취소
      </button>
      <button type="button" onClick={onSave} disabled={saving} className="rounded-xl px-3 py-2 text-xs font-bold text-white bg-primary disabled:opacity-50">
        {saving ? "저장 중…" : "저장"}
      </button>
    </div>
  );
}

function ContactInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">{label}</span>
      <input className="input-field" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ContactTextarea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">{label}</span>
      <textarea className="ui-textarea" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function ContactValue({ label, value, full }: { label: string; value: string | null | undefined; full?: boolean }) {
  return (
    <div className={cn("rounded-xl bg-white/50 border border-white/60 p-3", full && "sm:col-span-2")}>
      <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wide">{label}</div>
      <div className="text-sm font-semibold text-stone-800 mt-1 whitespace-pre-line">{value || "—"}</div>
    </div>
  );
}

function ContactLogBox({ logs }: { logs: FacilityContactLog[] }) {
  return (
    <div className="rounded-2xl bg-white/50 border border-white/60 p-3">
      <h4 className="text-sm font-bold text-stone-800 mb-2">변동 이력 로그</h4>
      <div className="max-h-44 overflow-y-auto scrollbar-hide flex flex-col gap-2">
        {logs.length === 0 && <div className="text-sm text-stone-400 py-4 text-center">등록된 변동 이력이 없습니다.</div>}
        {logs.map((log) => (
          <div key={log.id} className="rounded-xl bg-white/60 border border-white/60 p-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <b className="text-stone-800">{contactEventLabel(log.eventType)}</b>
              <span className="text-stone-400">{log.eventDate ?? log.createdAt?.slice(0, 10) ?? "—"}</span>
            </div>
            {log.memo && <div className="text-stone-500 mt-1">{log.memo}</div>}
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
    <section className="bg-white/40 border border-white/50 rounded-2xl p-4">
      <h3 className="text-sm font-bold text-stone-800 flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-primary" /> 주요 생산품
      </h3>
      <p className="text-[11px] text-stone-500 mt-1">
        통합허가 파싱 대상이 아닌 용역 사업장을 위한 수동 입력 정보입니다.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {products.length === 0 && <div className="text-sm text-stone-400 py-4 text-center">등록된 생산품이 없습니다.</div>}
        {products.map((product, idx) => (
          <div key={product.id ?? idx} className="grid grid-cols-[1fr_auto] gap-2 text-xs bg-white/50 border border-white/60 rounded-xl p-2">
            <div>
              <b className="text-stone-800">{product.productName}</b>
              {product.note && <div className="text-stone-500 mt-0.5">{product.note}</div>}
            </div>
            <div className="text-stone-600">
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
      ? detail.industries
      : [{ code: detail.industryCode, name: detail.industryName }];
  const primaryAlias = detail.aliases.find((alias) => alias.isPrimary) ?? detail.aliases[0];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div className="sm:col-span-2 bg-white/40 border border-white/50 rounded-xl p-3">
        <div className="min-w-0">
          {primaryAlias && (
            <div className="text-xs text-stone-500 truncate">
              별칭: <b>{primaryAlias.alias}</b>
              {detail.aliases.length > 1 ? ` 외 ${detail.aliases.length - 1}개` : ""}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 mt-2">
            <ServiceTags categories={detail.serviceCategories} />
            {detail.companySize && (
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-stone-100 text-stone-700">
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
        label="소재지"
        value={formatAddress(detail.siteAddress)}
        secondary={
          detail.regionSido
            ? "지역: " + detail.regionSido + (detail.regionSigungu ? " " + detail.regionSigungu : "")
            : null
        }
      />
      <div className="flex flex-col gap-1 bg-white/40 border border-white/50 rounded-xl p-3">
        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wide flex items-center gap-1">
          <FileText className="w-3 h-3" /> 업종
        </span>
        <div className="flex flex-col gap-1">
          {industries.length > 0 ? (
            industries.map((industry, idx) => (
              <div key={idx} className="grid grid-cols-[90px_1fr] gap-1 text-xs">
                <span className="font-mono bg-stone-100 rounded px-2 py-1 text-stone-700">
                  {industry.code ?? "—"}
                </span>
                <span className="bg-white/50 rounded px-2 py-1 text-stone-800">
                  {industry.name ?? "업종명 없음"}
                </span>
              </div>
            ))
          ) : (
            <span className="text-sm text-stone-400">—</span>
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
    <section className="rounded-2xl border border-stone-200 bg-white/50 p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <h3 className="text-sm font-black text-stone-800 flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            사업자등록증
          </h3>
          <p className="text-xs text-stone-500 mt-1">
            PDF 원본은 S3에 보관되며, 갱신 업로드 시 OCR 파싱 결과로 업태·종목·법인등록번호를 업데이트합니다.
          </p>
        </div>
        {canEdit && (
          <label className="rounded-xl px-3 py-2 text-xs font-bold text-white bg-primary hover:bg-primary/90 cursor-pointer inline-flex items-center gap-1">
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
        <p className="text-sm text-stone-400">등록된 사업자등록증이 없습니다.</p>
      ) : (
        <div className="grid gap-2">
          {certificates.map((item) => (
            <div key={item.certificateId} className="rounded-xl border border-stone-200 bg-white/70 p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-bold text-stone-800 truncate">{item.displayName}</p>
                  {item.isCurrent && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">현재본</span>
                  )}
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-500">v{item.versionNo}</span>
                </div>
                <p className="text-xs text-stone-500 mt-1">
                  갱신일: {item.createdAt.slice(0, 10)} · 업태 {item.businessType ?? "-"} · 종목 {item.businessItem ?? "-"} · 법인등록번호 {item.corporateRegistrationNo ?? "-"}
                </p>
                <p className="text-[11px] text-stone-400 mt-1">
                  등록자: {item.createdByName ?? item.createdByEmail ?? "-"}
                </p>
              </div>
              {item.publicPath && (
                <a
                  href={item.publicPath}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold text-stone-700 bg-stone-100 hover:bg-stone-200"
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
  const [siteAddress, setSiteAddress] = useState(formatAddress(detail.siteAddress) ?? "");
  const [phoneNumber, setPhoneNumber] = useState(detail.phoneNumber ?? "");
  const facilityIndustries =
    detail.industries?.filter((industry) => industry.source === "facility") ?? [];
  const scalarIndustries = parseIndustriesFromValue(detail.industryCode, detail.industryName);
  const displayedIndustries = detail.industries ?? [];
  const initialIndustries = facilityIndustries.length
    ? facilityIndustries
    : scalarIndustries.length
    ? scalarIndustries
    : displayedIndustries;
  const [industries, setIndustries] = useState(
    initialIndustries.length
      ? initialIndustries.map((industry) => ({
          code: industry.code ?? "",
          name: industry.name ?? "",
        }))
      : [{ code: "", name: "" }]
  );
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
          siteAddress: formatAddress(siteAddress) || null,
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
        label="소재지"
        value={siteAddress}
        onChange={setSiteAddress}
        full
      />
      <FieldInput label="전화번호" value={phoneNumber} onChange={setPhoneNumber} />
      <div className="sm:col-span-2 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">
            업종
          </span>
          <button
            type="button"
            onClick={() => setIndustries((prev) => [...prev, { code: "", name: "" }])}
            className="glass-button rounded-lg px-2 py-1 text-[11px] font-bold text-stone-700 flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> 업종 추가
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {industries.map((industry, idx) => (
            <div
              key={idx}
              className="grid grid-cols-1 sm:grid-cols-[130px_1fr_auto] gap-2 bg-white/40 border border-white/50 rounded-xl p-2"
            >
              <input
                className="input-field"
                value={industry.code}
                onChange={(e) =>
                  setIndustries((prev) =>
                    prev.map((item, itemIdx) =>
                      itemIdx === idx ? { ...item, code: e.target.value } : item
                    )
                  )
                }
                placeholder="업종 코드"
              />
              <input
                className="input-field"
                value={industry.name}
                onChange={(e) =>
                  setIndustries((prev) =>
                    prev.map((item, itemIdx) =>
                      itemIdx === idx ? { ...item, name: e.target.value } : item
                    )
                  )
                }
                placeholder="업종명"
              />
              <button
                type="button"
                onClick={() =>
                  setIndustries((prev) =>
                    prev.length > 1 ? prev.filter((_, itemIdx) => itemIdx !== idx) : [{ code: "", name: "" }]
                  )
                }
                className="rounded-lg px-2 py-1 text-[11px] font-bold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 flex items-center justify-center gap-1"
              >
                <Trash2 className="w-3 h-3" /> 삭제
              </button>
            </div>
          ))}
        </div>
      </div>
      <div className="sm:col-span-2 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">
            사업자등록증 기반 업종
          </span>
          <button
            type="button"
            onClick={() => setCertificateKinds((prev) => [...prev, { businessType: "", businessItem: "" }])}
            className="glass-button rounded-lg px-2 py-1 text-[11px] font-bold text-stone-700 flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> 항목 추가
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {certificateKinds.map((row, idx) => (
            <div
              key={idx}
              className="grid grid-cols-1 sm:grid-cols-[180px_1fr_auto] gap-2 bg-white/40 border border-white/50 rounded-xl p-2"
            >
              <input
                className="input-field"
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
                className="input-field"
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
                className="rounded-lg px-2 py-1 text-[11px] font-bold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 flex items-center justify-center gap-1"
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
      <div className="sm:col-span-2 grid grid-cols-1 md:grid-cols-[auto_1fr] gap-3 bg-white/40 border border-white/50 rounded-xl p-3">
        <LogoPreview path={logoPreviewUrl || logoPath || null} label={companyName} />
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <label className="glass-button rounded-lg px-3 py-2 text-[11px] font-bold text-stone-700 flex items-center gap-1 cursor-pointer">
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
                className="rounded-lg px-3 py-2 text-[11px] font-bold text-red-700 bg-red-50 border border-red-200"
              >
                로고 제거
              </button>
            )}
          </div>
          <div className="rounded-xl bg-white/50 border border-white/60 px-3 py-2 text-[11px] text-stone-500">
            {logoFile
              ? `${logoFile.name} 선택됨 · 저장 시 업로드됩니다.`
              : logoPath
              ? "등록된 로고 파일이 있습니다."
              : "등록된 로고 파일이 없습니다."}
          </div>
        </div>
      </div>

      <div className="sm:col-span-2 flex flex-col gap-2 bg-white/40 border border-white/50 rounded-xl p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide flex items-center gap-1">
            <Tags className="w-3 h-3" /> 사업장 별칭
          </span>
          <button
            type="button"
            onClick={() => setAliases((prev) => [...prev, { alias: "", aliasType: "site", note: "", isPrimary: false }])}
            className="glass-button rounded-lg px-2 py-1 text-[11px] font-bold text-stone-700"
          >
            별칭 추가
          </button>
        </div>
        {aliases.map((alias, idx) => (
          <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_100px_1fr_auto] gap-2">
            <input className="input-field" value={alias.alias} onChange={(e) => setAliases((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, alias: e.target.value } : item))} placeholder="사업체 사용 명칭" />
            <input className="input-field" value={alias.aliasType} onChange={(e) => setAliases((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, aliasType: e.target.value } : item))} placeholder="유형" />
            <input className="input-field" value={alias.note} onChange={(e) => setAliases((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, note: e.target.value } : item))} placeholder="메모" />
            <button type="button" onClick={() => setAliases((prev) => prev.filter((_, itemIdx) => itemIdx !== idx))} className="rounded-lg px-2 py-1 text-[11px] font-bold text-red-700 bg-red-50 border border-red-200">
              삭제
            </button>
          </div>
        ))}
      </div>

      <div className="sm:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-3 bg-white/40 border border-white/50 rounded-xl p-3">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">대상 용역 카테고리</span>
          <div className="flex flex-wrap gap-2">
            {FACILITY_SERVICE_ORDER.map((category) => (
              <label key={category} className="flex items-center gap-1.5 text-xs font-bold text-stone-700">
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
          <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">사업장 분류</span>
          <select className="ui-select" value={companySize} onChange={(e) => setCompanySize(e.target.value as FacilityCompanySize | "")}>
            <option value="">미지정</option>
            {FACILITY_COMPANY_SIZE_ORDER.map((size) => (
              <option key={size} value={size}>{FACILITY_COMPANY_SIZE_LABELS[size]}</option>
            ))}
          </select>
        </div>
      </div>

      {!hasIntegratedService && (
        <div className="sm:col-span-2 flex flex-col gap-2 bg-white/40 border border-white/50 rounded-xl p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">수동 주요 생산품</span>
            <button type="button" onClick={() => setManualProducts((prev) => [...prev, { productName: "", amount: "", unit: "", note: "" }])} className="glass-button rounded-lg px-2 py-1 text-[11px] font-bold text-stone-700">
              생산품 추가
            </button>
          </div>
          {manualProducts.map((product, idx) => (
            <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_100px_90px_1fr_auto] gap-2">
              <input className="input-field" value={product.productName} onChange={(e) => setManualProducts((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, productName: e.target.value } : item))} placeholder="생산품" />
              <input className="input-field" value={product.amount} onChange={(e) => setManualProducts((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, amount: e.target.value } : item))} placeholder="생산량" />
              <input className="input-field" value={product.unit} onChange={(e) => setManualProducts((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, unit: e.target.value } : item))} placeholder="단위" />
              <input className="input-field" value={product.note} onChange={(e) => setManualProducts((prev) => prev.map((item, itemIdx) => itemIdx === idx ? { ...item, note: e.target.value } : item))} placeholder="비고" />
              <button type="button" onClick={() => setManualProducts((prev) => prev.filter((_, itemIdx) => itemIdx !== idx))} className="rounded-lg px-2 py-1 text-[11px] font-bold text-red-700 bg-red-50 border border-red-200">
                삭제
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="sm:col-span-2 bg-white/40 border border-white/50 rounded-xl p-3 flex items-center justify-between gap-3">
        <div className="text-xs text-stone-600">
          <b className="text-stone-800">그룹 정보</b>
          <div>
            {detail.groupInfo
              ? `${detail.groupInfo.group.groupName} · ${detail.groupInfo.company.companyName} (${MEMBERSHIP_RELATION_LABELS[detail.groupInfo.membership.relationType]})`
              : "연결된 그룹 정보 없음"}
          </div>
        </div>
        <button type="button" onClick={() => setGroupOpen(true)} className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700">
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

      <div className="sm:col-span-2 bg-white/40 border border-white/50 rounded-xl p-3 flex items-center justify-between gap-3">
        <div className="text-xs text-stone-600">
          <b className="text-stone-800">운영 주체</b>
          <div>
            {detail.operatingEntityInfo
              ? `${detail.operatingEntityInfo.entity.entityName} · ${OPERATING_RELATION_LABELS[detail.operatingEntityInfo.relation.relationType]}`
              : "연결된 운영 주체 없음"}
          </div>
        </div>
        <button type="button" onClick={() => setOperatingOpen(true)} className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700">
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
        <div className="sm:col-span-2 text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          {error}
        </div>
      )}

      <div className="sm:col-span-2 flex items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700 flex items-center gap-1"
        >
          <X className="w-3.5 h-3.5" /> 취소
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="rounded-xl px-3 py-2 text-xs font-bold text-white bg-primary hover:bg-primary/90 shadow-sm flex items-center gap-1 disabled:opacity-60"
        >
          <Save className="w-3.5 h-3.5" />
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>
  );
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
  const [entities, setEntities] = useState<LegalEntity[]>([]);
  const [selectedEntityId, setSelectedEntityId] = useState(facility.operatingEntityInfo?.entity.entityId ?? "");
  const [relationType, setRelationType] = useState<FacilityOperatingRelationType>(
    facility.operatingEntityInfo?.relation.relationType ?? "operating_entity"
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [entityName, setEntityName] = useState("");
  const [entityBrn, setEntityBrn] = useState("");
  const [entityAddress, setEntityAddress] = useState("");
  const [entityPhone, setEntityPhone] = useState("");
  const [entityMemo, setEntityMemo] = useState("");
  const [editName, setEditName] = useState("");
  const [editBrn, setEditBrn] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editMemo, setEditMemo] = useState("");
  const selectedEntity = entities.find((entity) => entity.entityId === selectedEntityId);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/legal-entities", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const body = (await res.json()) as { items: LegalEntity[] };
      setEntities(body.items ?? []);
    } catch (err) {
      alert("법인 마스터 조회 실패: " + (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!selectedEntity) {
      setEditName("");
      setEditBrn("");
      setEditAddress("");
      setEditPhone("");
      setEditMemo("");
      return;
    }
    setEditName(selectedEntity.entityName);
    setEditBrn(selectedEntity.businessRegistrationNo ?? "");
    setEditAddress(selectedEntity.address ?? "");
    setEditPhone(selectedEntity.phoneNumber ?? "");
    setEditMemo(selectedEntity.memo ?? "");
  }, [selectedEntity]);

  const createAndLink = async () => {
    if (!entityName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/facilities/" + facility.facilityId + "/operating-entity", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityName,
          businessRegistrationNo: entityBrn,
          address: entityAddress,
          phoneNumber: entityPhone,
          memo: entityMemo,
          relationType,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      onChanged();
    } catch (err) {
      alert("운영 주체 등록 실패: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const linkSelectedEntity = async () => {
    if (!selectedEntityId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/facilities/" + facility.facilityId + "/operating-entity", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityId: selectedEntityId, relationType }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? "HTTP " + res.status);
      }
      onChanged();
    } catch (err) {
      alert("운영 주체 연결 실패: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const updateSelectedEntity = async () => {
    if (!selectedEntityId || !editName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/legal-entities/" + selectedEntityId, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityName: editName,
          businessRegistrationNo: editBrn,
          address: editAddress,
          phoneNumber: editPhone,
          memo: editMemo,
        }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      await reload();
    } catch (err) {
      alert("법인 마스터 수정 실패: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const clearOperatingEntity = async () => {
    if (!facility.operatingEntityInfo || !window.confirm("현재 사업장에 연결된 운영 주체 정보를 해제할까요? 법인 마스터는 삭제되지 않습니다.")) return;
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

  const modal = (
    <div className="fixed inset-0 z-50 bg-stone-950/20 flex items-center justify-center p-4">
      <div className="glass-panel rounded-3xl p-5 w-[min(980px,calc(100vw-32px))] max-h-[min(780px,calc(100vh-32px))] overflow-y-auto scrollbar-hide shadow-2xl">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-xl font-bold text-stone-800">운영 주체 관리</h3>
            <p className="text-xs text-stone-500 mt-1">
              허가 대상 사업장과 실제 계약 상대 법인을 분리해 관리합니다.
            </p>
          </div>
          <button type="button" onClick={onClose} className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700">
            닫기
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <section className="bg-white/45 border border-white/60 rounded-2xl p-3 flex flex-col gap-2">
            <h4 className="text-sm font-bold text-stone-800">기존 법인 연결</h4>
            {loading && <div className="text-sm text-stone-400 py-3">불러오는 중…</div>}
            <select className="ui-select" value={selectedEntityId} onChange={(e) => setSelectedEntityId(e.target.value)}>
              <option value="">법인 선택</option>
              {entities.map((entity) => (
                <option key={entity.entityId} value={entity.entityId}>
                  {entity.entityName}
                </option>
              ))}
            </select>
            <select className="ui-select" value={relationType} onChange={(e) => setRelationType(e.target.value as FacilityOperatingRelationType)}>
              <option value="operating_entity">운영 주체</option>
              <option value="owner_entity">소유 주체</option>
              <option value="manager_entity">관리 주체</option>
              <option value="other">기타 관계</option>
            </select>
            <button type="button" onClick={linkSelectedEntity} disabled={saving || !selectedEntityId} className="rounded-xl px-3 py-2 text-xs font-bold text-white bg-primary disabled:opacity-50">
              선택 법인 연결
            </button>
            {facility.operatingEntityInfo && (
              <button type="button" onClick={clearOperatingEntity} disabled={saving} className="rounded-xl px-3 py-2 text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 disabled:opacity-50">
                현재 운영 주체 연결 해제
              </button>
            )}
          </section>

          <section className="bg-white/45 border border-white/60 rounded-2xl p-3 flex flex-col gap-2">
            <h4 className="text-sm font-bold text-stone-800">신규 법인 등록 후 연결</h4>
            <input className="input-field" value={entityName} onChange={(e) => setEntityName(e.target.value)} placeholder="법인명 예: 한솔제지(주)" />
            <input className="input-field" value={entityBrn} onChange={(e) => setEntityBrn(e.target.value)} placeholder="사업자번호" />
            <input className="input-field" value={entityAddress} onChange={(e) => setEntityAddress(e.target.value)} placeholder="소재지" />
            <input className="input-field" value={entityPhone} onChange={(e) => setEntityPhone(e.target.value)} placeholder="전화번호" />
            <input className="input-field" value={entityMemo} onChange={(e) => setEntityMemo(e.target.value)} placeholder="메모" />
            <button type="button" onClick={createAndLink} disabled={saving || !entityName.trim()} className="rounded-xl px-3 py-2 text-xs font-bold text-white bg-primary disabled:opacity-50">
              신규 법인 등록 및 연결
            </button>
          </section>

          <section className="lg:col-span-2 bg-white/45 border border-white/60 rounded-2xl p-3">
            <h4 className="text-sm font-bold text-stone-800 mb-2">선택 법인 마스터 수정</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input className="input-field" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="법인명" disabled={!selectedEntity} />
              <input className="input-field" value={editBrn} onChange={(e) => setEditBrn(e.target.value)} placeholder="사업자번호" disabled={!selectedEntity} />
              <input className="input-field" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} placeholder="소재지" disabled={!selectedEntity} />
              <input className="input-field" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="전화번호" disabled={!selectedEntity} />
              <input className="input-field md:col-span-2" value={editMemo} onChange={(e) => setEditMemo(e.target.value)} placeholder="메모" disabled={!selectedEntity} />
            </div>
            <button type="button" onClick={updateSelectedEntity} disabled={saving || !selectedEntity || !editName.trim()} className="mt-2 rounded-xl px-4 py-2 text-xs font-bold text-white bg-primary disabled:opacity-50">
              법인 정보 저장
            </button>
          </section>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

function GroupManagementModal({
  facility,
  onClose,
  onChanged,
}: {
  facility: FacilityDetail;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [groups, setGroups] = useState<FacilityGroupTree[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState(facility.groupInfo?.group.groupId ?? "");
  const [selectedCompanyId, setSelectedCompanyId] = useState(facility.groupInfo?.company.companyId ?? "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [divisionName, setDivisionName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyBrn, setCompanyBrn] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [companyPhone, setCompanyPhone] = useState("");
  const [companyDivisionId, setCompanyDivisionId] = useState("");
  const [companyRole, setCompanyRole] = useState<FacilityGroupCompanyRole>("affiliate");
  const [editCompanyName, setEditCompanyName] = useState("");
  const [editCompanyBrn, setEditCompanyBrn] = useState("");
  const [editCompanyAddress, setEditCompanyAddress] = useState("");
  const [editCompanyPhone, setEditCompanyPhone] = useState("");
  const [editCompanyDivisionId, setEditCompanyDivisionId] = useState("");
  const [editCompanyRole, setEditCompanyRole] = useState<FacilityGroupCompanyRole>("affiliate");
  const [relationType, setRelationType] = useState<FacilityGroupMembershipRelationType>(
    facility.groupInfo?.membership.relationType === "site"
      ? "operating_company"
      : facility.groupInfo?.membership.relationType ?? "operating_company"
  );
  const selectedGroup = groups.find((group) => group.groupId === selectedGroupId);
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

  useEffect(() => {
    if (!selectedCompany) {
      setEditCompanyName("");
      setEditCompanyBrn("");
      setEditCompanyAddress("");
      setEditCompanyPhone("");
      setEditCompanyDivisionId("");
      setEditCompanyRole("affiliate");
      return;
    }
    setEditCompanyName(selectedCompany.companyName);
    setEditCompanyBrn(selectedCompany.businessRegistrationNo ?? "");
    setEditCompanyAddress(selectedCompany.address ?? "");
    setEditCompanyPhone(selectedCompany.phoneNumber ?? "");
    setEditCompanyDivisionId(selectedCompany.divisionId ?? "");
    setEditCompanyRole(selectedCompany.groupRole);
  }, [selectedCompany]);

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
      setSelectedCompanyId("");
      await reload();
    } catch (err) {
      alert("그룹 삭제 실패: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteSelectedCompany = async () => {
    if (!selectedGroupId || !selectedCompanyId || !window.confirm("선택한 법인 마스터를 그룹에서 삭제할까요? 이 법인을 참조하는 사업장 연결도 함께 삭제됩니다.")) return;
    setSaving(true);
    try {
      const res = await fetch(
        "/api/facility-groups/" + selectedGroupId + "/companies/" + selectedCompanyId,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      setSelectedCompanyId("");
      await reload();
    } catch (err) {
      alert("법인 마스터 삭제 실패: " + (err as Error).message);
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
      setDivisionName("");
      await reload();
    } catch (err) {
      alert("부문 생성 실패: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const createCompany = async () => {
    if (!selectedGroupId || !companyName.trim()) return;
    setSaving(true);
    try {
      const selectedDivisionId = selectedGroup?.divisions.some((division) => division.divisionId === companyDivisionId)
        ? companyDivisionId
        : null;
      const res = await fetch("/api/facility-groups/" + selectedGroupId + "/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          divisionId: selectedDivisionId,
          companyName,
          businessRegistrationNo: companyBrn,
          address: companyAddress,
          phoneNumber: companyPhone,
          groupRole: companyRole,
          isHeadquarters: companyRole === "group_representative",
        }),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const body = (await res.json()) as { companyId: string };
      setSelectedCompanyId(body.companyId);
      setCompanyName("");
      setCompanyBrn("");
      setCompanyAddress("");
      setCompanyPhone("");
      await reload();
    } catch (err) {
      alert("그룹 소속 법인 생성 실패: " + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const updateSelectedCompany = async () => {
    if (!selectedGroupId || !selectedCompanyId || !editCompanyName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(
        "/api/facility-groups/" + selectedGroupId + "/companies/" + selectedCompanyId,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            divisionId: editCompanyDivisionId || null,
            companyName: editCompanyName,
            businessRegistrationNo: editCompanyBrn,
            address: editCompanyAddress,
            phoneNumber: editCompanyPhone,
            groupRole: editCompanyRole,
            isHeadquarters: editCompanyRole === "group_representative",
          }),
        }
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      await reload();
    } catch (err) {
      alert("법인 마스터 수정 실패: " + (err as Error).message);
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
      onChanged();
    } catch (err) {
      alert("그룹 연결 저장 실패: " + (err as Error).message);
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
    <div className="fixed inset-0 z-50 bg-stone-950/20 flex items-center justify-center p-4">
      <div className="glass-panel rounded-3xl p-5 w-[min(1120px,calc(100vw-32px))] max-h-[min(820px,calc(100vh-32px))] overflow-y-auto scrollbar-hide shadow-2xl">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-xl font-bold text-stone-800">그룹 관리</h3>
            <p className="text-xs text-stone-500 mt-1">
              그룹, 부문, 그룹 소속 법인을 관리하고 현재 사업장과의 관계를 연결합니다.
            </p>
          </div>
          <button type="button" onClick={onClose} className="glass-button rounded-xl px-3 py-2 text-xs font-bold text-stone-700">
            닫기
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          <section className="bg-white/45 border border-white/60 rounded-2xl p-3">
            <h4 className="text-sm font-bold text-stone-800 mb-2">그룹 트리</h4>
            {loading && <div className="text-sm text-stone-400 py-6 text-center">불러오는 중…</div>}
            <div className="flex flex-col gap-2 max-h-[520px] overflow-y-auto scrollbar-hide">
              {groups.map((group) => (
                <button
                  key={group.groupId}
                  type="button"
                  onClick={() => {
                    setSelectedGroupId(group.groupId);
                    setSelectedCompanyId(group.companies[0]?.companyId ?? "");
                    setCompanyDivisionId("");
                  }}
                  className={cn("text-left rounded-xl border p-3", selectedGroupId === group.groupId ? "border-primary/40 bg-primary/10" : "border-white/60 bg-white/50")}
                >
                  <div className="text-sm font-bold text-stone-800">{group.groupName}</div>
                  <div className="text-[11px] text-stone-500 mt-1">
                    등록 법인 {group.companies.length}개 · 부문 {group.divisions.length}개
                  </div>
                  <div className="mt-2 flex flex-col gap-1">
                    {group.divisions.map((division) => (
                      <div key={division.divisionId} className="text-[11px] text-stone-600">
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
              <div className="bg-white/45 border border-white/60 rounded-2xl p-3 flex flex-col gap-2">
                <h4 className="text-sm font-bold text-stone-800">그룹 신규 입력</h4>
                <input className="input-field" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="예: 한화그룹" />
                <button type="button" onClick={createGroup} disabled={saving} className="rounded-xl px-3 py-2 text-xs font-bold text-white bg-primary disabled:opacity-50">
                  그룹 저장
                </button>
              </div>
              <div className="bg-white/45 border border-white/60 rounded-2xl p-3 flex flex-col gap-2">
                <h4 className="text-sm font-bold text-stone-800">부문 신규 입력</h4>
                <input className="input-field" value={divisionName} onChange={(e) => setDivisionName(e.target.value)} placeholder="예: 화학 부문" />
                <button type="button" onClick={createDivision} disabled={saving || !selectedGroupId} className="rounded-xl px-3 py-2 text-xs font-bold text-white bg-primary disabled:opacity-50">
                  부문 저장
                </button>
              </div>
              <div className="bg-white/45 border border-white/60 rounded-2xl p-3 flex flex-col gap-2">
                <h4 className="text-sm font-bold text-stone-800">그룹 소속 법인 등록</h4>
                <input className="input-field" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="상호" />
                <input className="input-field" value={companyBrn} onChange={(e) => setCompanyBrn(e.target.value)} placeholder="사업자번호" />
                <input className="input-field" value={companyAddress} onChange={(e) => setCompanyAddress(e.target.value)} placeholder="소재지" />
                <input className="input-field" value={companyPhone} onChange={(e) => setCompanyPhone(e.target.value)} placeholder="전화번호" />
                <select className="ui-select" value={companyDivisionId} onChange={(e) => setCompanyDivisionId(e.target.value)}>
                  <option value="">부문 없음</option>
                  {selectedGroup?.divisions.map((division) => (
                    <option key={division.divisionId} value={division.divisionId}>
                      {division.divisionName}
                    </option>
                  ))}
                </select>
                <select
                  className="ui-select"
                  value={companyRole}
                  onChange={(e) => setCompanyRole(e.target.value as FacilityGroupCompanyRole)}
                >
                  <option value="group_representative">그룹 대표기업</option>
                  <option value="affiliate">그룹 소속 법인</option>
                  <option value="other">기타 법인</option>
                </select>
                <button type="button" onClick={createCompany} disabled={saving || !selectedGroupId} className="rounded-xl px-3 py-2 text-xs font-bold text-white bg-primary disabled:opacity-50">
                  그룹 소속 법인 저장
                </button>
              </div>
            </div>

            <div className="bg-white/45 border border-white/60 rounded-2xl p-3">
              <h4 className="text-sm font-bold text-stone-800 mb-2">현재 사업장 운영 법인 연결</h4>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-2">
                <select className="ui-select" value={selectedCompanyId} onChange={(e) => setSelectedCompanyId(e.target.value)}>
                  <option value="">연결 법인 선택</option>
                  {selectedGroup?.companies.map((company) => (
                    <option key={company.companyId} value={company.companyId}>
                      [{GROUP_COMPANY_ROLE_LABELS[company.groupRole]}] {company.companyName}
                    </option>
                  ))}
                </select>
                <select
                  className="ui-select"
                  value={relationType}
                  onChange={(e) => setRelationType(e.target.value as FacilityGroupMembershipRelationType)}
                >
                  {EDITABLE_MEMBERSHIP_RELATION_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {MEMBERSHIP_RELATION_LABELS[type]}
                    </option>
                  ))}
                </select>
                <button type="button" onClick={saveMembership} disabled={saving || !selectedGroupId || !selectedCompanyId} className="rounded-xl px-4 py-2 text-xs font-bold text-white bg-primary disabled:opacity-50">
                  연결 저장
                </button>
              </div>
              {facility.groupInfo && (
                <div className="mt-2 text-[11px] text-stone-500">
                  현재 연결: {facility.groupInfo.group.groupName} · {facility.groupInfo.company.companyName} ({MEMBERSHIP_RELATION_LABELS[facility.groupInfo.membership.relationType]})
                </div>
              )}
              <div className="flex flex-wrap gap-2 mt-2">
                <button type="button" onClick={clearMembership} disabled={saving || !facility.groupInfo} className="rounded-lg px-2 py-1 text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 disabled:opacity-50">
                  현재 사업장 연결 해제
                </button>
                <button type="button" onClick={renameSelectedGroup} disabled={saving || !selectedGroupId} className="glass-button rounded-lg px-2 py-1 text-[11px] font-bold text-stone-700 disabled:opacity-50">
                  그룹명 수정
                </button>
                <button type="button" onClick={deleteSelectedCompany} disabled={saving || !selectedCompanyId} className="rounded-lg px-2 py-1 text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 disabled:opacity-50">
                  법인 마스터 삭제
                </button>
                <button type="button" onClick={deleteSelectedGroup} disabled={saving || !selectedGroupId} className="rounded-lg px-2 py-1 text-[11px] font-bold text-red-700 bg-red-50 border border-red-200 disabled:opacity-50">
                  그룹 삭제
                </button>
              </div>
            </div>

            <div className="bg-white/45 border border-white/60 rounded-2xl p-3">
              <h4 className="text-sm font-bold text-stone-800 mb-2">선택 법인 마스터 수정</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input className="input-field" value={editCompanyName} onChange={(e) => setEditCompanyName(e.target.value)} placeholder="상호" disabled={!selectedCompany} />
                <select className="ui-select" value={editCompanyDivisionId} onChange={(e) => setEditCompanyDivisionId(e.target.value)} disabled={!selectedCompany}>
                  <option value="">부문 없음</option>
                  {selectedGroup?.divisions.map((division) => (
                    <option key={division.divisionId} value={division.divisionId}>
                      {division.divisionName}
                    </option>
                  ))}
                </select>
                <input className="input-field" value={editCompanyBrn} onChange={(e) => setEditCompanyBrn(e.target.value)} placeholder="사업자번호" disabled={!selectedCompany} />
                <select
                  className="ui-select"
                  value={editCompanyRole}
                  onChange={(e) => setEditCompanyRole(e.target.value as FacilityGroupCompanyRole)}
                  disabled={!selectedCompany}
                >
                  <option value="group_representative">그룹 대표기업</option>
                  <option value="affiliate">그룹 소속 법인</option>
                  <option value="other">기타 법인</option>
                </select>
                <input className="input-field" value={editCompanyAddress} onChange={(e) => setEditCompanyAddress(e.target.value)} placeholder="소재지" disabled={!selectedCompany} />
                <input className="input-field" value={editCompanyPhone} onChange={(e) => setEditCompanyPhone(e.target.value)} placeholder="전화번호" disabled={!selectedCompany} />
              </div>
              <div className="flex items-center justify-between gap-2 mt-2">
                <p className="text-[11px] text-stone-500">
                  선택한 법인의 그룹 내 역할과 부문 소속을 수정합니다. 사업장 연결은 별도로 저장해야 합니다.
                </p>
                <button type="button" onClick={updateSelectedCompany} disabled={saving || !selectedCompany || !editCompanyName.trim()} className="rounded-xl px-4 py-2 text-xs font-bold text-white bg-primary disabled:opacity-50">
                  법인 정보 저장
                </button>
              </div>
            </div>

            <div className="bg-white/45 border border-white/60 rounded-2xl p-3">
              <h4 className="text-sm font-bold text-stone-800 mb-2">거래 사업장 컨셉 UI</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-white/60 border border-white/60 p-3">
                  <b>현재 거래 사업장</b>
                  <div className="text-stone-400 mt-2">계약 관리 모듈 연동 예정</div>
                </div>
                <div className="rounded-xl bg-white/60 border border-white/60 p-3">
                  <b>거래 경험 사업장</b>
                  <div className="text-stone-400 mt-2">용역 수행 내역 상세 패널 예정</div>
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
    <div className="rounded-2xl bg-white/50 border border-white/60 p-3">
      <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wide">{label}</div>
      <div className="text-sm font-bold text-stone-800 mt-1">{value}</div>
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
      <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">
        {label}
      </span>
      {multiline ? (
        <textarea
          className="input-field"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
        />
      ) : (
        <input
          className="input-field"
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
    <div className="flex flex-col gap-1 bg-white/40 border border-white/50 rounded-xl p-3">
      <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wide flex items-center gap-1">
        <Icon className="w-3 h-3" /> {label}
      </span>
      <span
        className={cn(
          "text-sm text-stone-800",
          multiline ? "whitespace-pre-wrap" : "truncate"
        )}
      >
        {value ?? <span className="text-stone-400">—</span>}
      </span>
      {secondary && <span className="text-[10px] text-stone-400">{secondary}</span>}
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
        <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wide flex items-center gap-1">
          <ClipboardList className="w-3 h-3" /> 연간보고서 (최신 스냅샷)
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="glass-button rounded-lg px-2 py-1 text-[10px] font-bold text-stone-700"
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
              className="rounded-lg px-2 py-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200"
            >
              삭제
            </button>
          </div>
        )}
      </div>
      <div className="bg-amber-50/40 border border-amber-200/50 rounded-xl p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-[11px] text-stone-600">
            출처: 연간(점검)보고서 · 사업장당 1건 보존
          </div>
          {annualReport.parsedAt && (
            <div className="text-[10px] text-stone-400">
              파싱: {annualReport.parsedAt.slice(0, 10)}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          {annualReport.airClass != null && (
            <span className="bg-stone-100 px-2 py-0.5 rounded">
              대기 {annualReport.airClass}종
              {annualReport.airAmountTonPerYear != null
                ? " · " + annualReport.airAmountTonPerYear + " 톤/년"
                : ""}
            </span>
          )}
          {annualReport.waterClass != null && (
            <span className="bg-stone-100 px-2 py-0.5 rounded">
              수질 {annualReport.waterClass}종
              {annualReport.wastewaterM3PerDay != null
                ? " · " + annualReport.wastewaterM3PerDay + " m³/일"
                : ""}
            </span>
          )}
        </div>
        {hasProducts && (
          <div className="text-[11px] text-stone-600 flex flex-col gap-0.5 mt-1">
            <div className="text-[10px] font-bold text-stone-500 uppercase tracking-wide mt-1">
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
    <div className="bg-amber-50/40 border border-amber-200/50 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-bold text-stone-500 uppercase tracking-wide flex items-center gap-1">
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
          <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">
            주요 생산품
          </span>
          <button
            type="button"
            onClick={() => setProducts([...products, { productName: "", amount: "", unit: "" }])}
            className="glass-button rounded-lg px-2 py-1 text-[10px] font-bold"
          >
            행 추가
          </button>
        </div>
        {products.map((product, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_90px_70px_32px] gap-2">
            <input
              className="input-field text-xs"
              placeholder="품목명"
              value={product.productName}
              onChange={(e) => {
                const next = [...products];
                next[idx] = { ...product, productName: e.target.value };
                setProducts(next);
              }}
            />
            <input
              className="input-field text-xs"
              placeholder="생산량"
              value={product.amount}
              onChange={(e) => {
                const next = [...products];
                next[idx] = { ...product, amount: e.target.value };
                setProducts(next);
              }}
            />
            <input
              className="input-field text-xs"
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
              className="rounded-lg text-red-600 bg-red-50 border border-red-200 text-xs font-bold"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="glass-button rounded-xl px-3 py-2 text-xs font-bold">
          취소
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-xl px-3 py-2 text-xs font-bold text-white bg-primary disabled:opacity-60"
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
        <div className="text-[10px] font-bold text-stone-400 uppercase tracking-wide">
          허가 / 종 규모 / 생산품
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="glass-button rounded-xl px-2 py-1 text-[11px] font-bold text-stone-700 flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> 허가 추가
          </button>
        )}
      </div>
      {detail.permits.length === 0 && !editing && (
        <div className="text-xs text-stone-400 text-center py-6">
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
          className="bg-white/40 border border-white/50 rounded-xl p-4 flex flex-col gap-2"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-sm font-bold text-stone-800">
                {p.decisionNo ?? "(결정번호 없음)"}
              </div>
              <div className="text-[10px] text-stone-400 font-mono">
                {p.permitId}
                {p.sourceAttachmentId ? " · " + p.sourceAttachmentId : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[11px] text-stone-500">
                {p.permitDate ?? "—"}
                {p.isFirstPermit ? (
                  <span className="ml-2 text-[10px] text-primary font-bold bg-primary/10 px-2 py-0.5 rounded-full">
                    최초허가
                  </span>
                ) : null}
              </div>
              {canEdit && (
                <>
                  <button
                    type="button"
                    onClick={() => setEditing(p)}
                    className="glass-button rounded-lg px-2 py-1 text-[10px] font-bold text-stone-700"
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
                    className="rounded-lg px-2 py-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200"
                  >
                    삭제
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {p.airClass != null && (
              <span className="bg-stone-100 px-2 py-0.5 rounded">
                대기 {p.airClass}종 · {p.airAmount ?? "—"} 톤/년
              </span>
            )}
            {p.waterClass != null && (
              <span className="bg-stone-100 px-2 py-0.5 rounded">
                수질 {p.waterClass}종 · {p.waterAmount ?? "—"} m³/일
              </span>
            )}
            {p.attachmentFileName && (
              <span className="text-stone-400 ml-auto truncate max-w-[60%]">
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
    <div className="rounded-lg bg-white/60 border border-white/70 px-3 py-2 min-w-0">
      <div className="text-[11px] font-bold text-stone-700 truncate">
        {cleanProductName(name) ?? "(상품명 없음)"}
      </div>
      <div className="mt-1 flex items-baseline justify-end gap-1 text-right">
        <span className="font-mono text-xs font-bold text-stone-800 tabular-nums">
          {formatNumber(amount) ?? "—"}
        </span>
        {unit && <span className="text-[10px] text-stone-500 shrink-0">{unit}</span>}
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
    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex flex-col gap-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <FieldInput label="결정번호" value={decisionNo} onChange={setDecisionNo} />
        <FieldInput label="허가유형" value={permitType} onChange={setPermitType} />
        <FieldInput label="허가일자" value={permitDate} onChange={setPermitDate} />
        <label className="flex items-center gap-2 text-xs font-bold text-stone-600 pt-6">
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
          <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">생산품</span>
          <button
            type="button"
            onClick={() => setProducts([...products, { productName: "", productionAmount: null, productionUnit: "", sourcePage: null, sourceText: null }])}
            className="glass-button rounded-lg px-2 py-1 text-[10px] font-bold"
          >
            행 추가
          </button>
        </div>
        {products.map((product, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_90px_70px_32px] gap-2">
            <input
              className="input-field text-xs"
              placeholder="품목명"
              value={product.productName ?? ""}
              onChange={(e) => {
                const next = [...products];
                next[idx] = { ...product, productName: e.target.value };
                setProducts(next);
              }}
            />
            <input
              className="input-field text-xs"
              placeholder="생산량"
              value={productAmountInputValue(product.productionAmount)}
              onChange={(e) => {
                const next = [...products];
                next[idx] = { ...product, productionAmount: e.target.value };
                setProducts(next);
              }}
            />
            <input
              className="input-field text-xs"
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
              className="rounded-lg text-red-600 bg-red-50 border border-red-200 text-xs font-bold"
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="glass-button rounded-xl px-3 py-2 text-xs font-bold">
          취소
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="rounded-xl px-3 py-2 text-xs font-bold text-white bg-primary disabled:opacity-60"
        >
          {pending ? "저장 중…" : "저장"}
        </button>
      </div>
    </div>
  );
}
