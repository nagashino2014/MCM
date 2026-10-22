"use client";

// 계약 없는 실적 — 정식 계약 없이 수행한 실적(예: 석문에너지 — 한국종합기술 위임, 대금만 수령)을 회사소개서 지표·부록에만 넣는다.
// 계약 관리의 수주·매출 집계에는 들어가지 않는다. 실적 노출 관리 화면의 탭·편집 창. docs/company-catalog-blueprint.md §6-4

import { Pencil, Plus, Trash2 } from "lucide-react";
import { CdHelp } from "@/components/cdash/CdHelp";
import { CdModal } from "@/components/cdash/CdModal";
import { CATALOG_CATEGORIES } from "@/lib/catalog/areas";
import { INTEGRATED_PERMIT_INDUSTRIES } from "@/lib/ieps/integrated-permit";
import {
  MANUAL_ID_PREFIX,
  buildDisplayTitle,
  manualPeriodText,
  type DisplayOverride,
  type ManualProject,
} from "@/lib/catalog/appendix";
import { formatAmountShort } from "./catalogFetch";

export type ManualDraft = Omit<ManualProject, "manualId" | "siteCount" | "amount"> & {
  manualId: string | null;
  /** 입력 중 문자열(빈칸 = 결정번호 수) */
  siteCount: string;
  /** 만 원 단위 입력 */
  amountMan: string;
};

export const emptyManualDraft: ManualDraft = {
  manualId: null,
  category: CATALOG_CATEGORIES[0],
  subtype: "최초허가",
  title: "",
  displayTitle: "",
  counterpartyName: "",
  siteName: "",
  regionSido: "",
  industry: "",
  startedAt: "",
  endedAt: "",
  status: "completed",
  permitIssuedAt: "",
  permitNo: "",
  siteCount: "",
  amountMan: "",
  displayOverride: "auto",
  isPublic: true,
  isFeatured: false,
  groupKey: "",
  note: "",
};

export function manualToDraft(m: ManualProject): ManualDraft {
  return {
    ...m,
    siteCount: m.siteCount != null ? String(m.siteCount) : "",
    amountMan: m.amount != null ? String(Math.round(m.amount / 10_000)) : "",
  };
}

export function draftToPayload(d: ManualDraft): Partial<ManualProject> {
  const { siteCount, amountMan, manualId, ...rest } = d;
  return {
    ...rest,
    manualId: manualId ?? undefined,
    siteCount: siteCount.trim() === "" ? null : Number(siteCount),
    amount: amountMan.trim() === "" ? null : Number(amountMan) * 10_000,
  };
}

/** 계약 없는 실적 id("manual:xxx") 판별 */
export const isManualId = (contractId: string) => contractId.startsWith(MANUAL_ID_PREFIX);

export function ManualProjectsPanel({
  items,
  loading,
  busy,
  onAdd,
  onEdit,
  onDelete,
}: {
  items: ManualProject[];
  loading: boolean;
  busy: boolean;
  onAdd: () => void;
  onEdit: (m: ManualProject) => void;
  onDelete: (m: ManualProject) => void;
}) {
  return (
    <section className="cd-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="text-xs cd-text-muted flex items-center gap-1">
          정식 계약 없이 수행한 실적을 회사소개서 지표·부록에만 넣습니다. 계약 관리의 수주·매출 집계에는 들어가지 않습니다.
          <CdHelp topic="catalog.manual-projects" />
        </div>
        <button type="button" className="cd-btn cd-btn-primary cd-btn-sm ml-auto shrink-0" onClick={onAdd} disabled={busy}>
          <Plus className="w-3.5 h-3.5" /> 실적 추가
        </button>
      </div>
      {loading ? (
        <p className="text-sm cd-text-faint py-6 text-center">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="text-sm cd-text-faint py-6 text-center">등록된 계약 없는 실적이 없습니다. [실적 추가]로 등록하세요.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="cd-table">
            <thead>
              <tr>
                <th>분류</th>
                <th>실적</th>
                <th>수행기간</th>
                <th>상태</th>
                <th className="text-right">사업장 수</th>
                <th className="text-right">수령액</th>
                <th>계약이 없는 사유</th>
                <th style={{ width: 80 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.manualId}>
                  <td className="cd-text-muted whitespace-nowrap">
                    {m.category}
                    {m.subtype && <span className="block text-[11px] cd-text-faint">{m.subtype}</span>}
                  </td>
                  <td className="cd-text" style={{ minWidth: 280 }}>
                    <span className="block">{m.displayTitle || m.title}</span>
                    <span className="block text-[11px] cd-text-faint">{[m.siteName, m.counterpartyName && `발주·위임 ${m.counterpartyName}`].filter(Boolean).join(" · ")}</span>
                  </td>
                  <td className="tabular-nums whitespace-nowrap">{manualPeriodText(m) || "—"}</td>
                  <td className="whitespace-nowrap">
                    <span className={`cd-pill ${m.status === "completed" || m.permitIssuedAt ? "cd-pill-success" : "cd-pill-idle"}`}>
                      {m.status === "completed" || m.permitIssuedAt ? "완료" : "수행 중"}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">{m.siteCount ?? "—"}</td>
                  <td className="text-right tabular-nums whitespace-nowrap">{formatAmountShort(m.amount)}</td>
                  <td className="cd-text-muted text-xs" style={{ maxWidth: 260 }}>
                    <span className="block truncate">{m.note || "—"}</span>
                  </td>
                  <td className="whitespace-nowrap">
                    <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" aria-label={`${m.title} 편집`} onClick={() => onEdit(m)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" aria-label={`${m.title} 삭제`} disabled={busy} onClick={() => onDelete(m)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ManualProjectModal({
  draft,
  setDraft,
  busy,
  onClose,
  onSave,
}: {
  draft: ManualDraft | null;
  setDraft: (d: ManualDraft) => void;
  busy: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const d = draft;
  const set = (patch: Partial<ManualDraft>) => d && setDraft({ ...d, ...patch });
  const isPermit = d?.category === CATALOG_CATEGORIES[0];
  const autoTitle = d
    ? buildDisplayTitle({
        contractId: "manual:preview",
        source: "manual",
        contractTitle: d.title,
        category: d.category,
        subtype: d.subtype,
        contractDate: d.startedAt,
        year: d.startedAt.slice(0, 4),
        startedAt: d.startedAt,
        endedAt: d.endedAt,
        amount: null,
        isUnitPrice: false,
        counterpartyName: d.counterpartyName,
        siteName: d.siteName,
        regionSido: d.regionSido,
        regionGroup: "",
        industryCategory: d.industry,
        industryName: "",
        industryCode: "",
        permitIssuedAt: d.permitIssuedAt,
        permitNo: d.permitNo,
        completedAt: d.permitIssuedAt || (d.status === "completed" ? d.endedAt || "완료" : ""),
        meta: null,
      }, { anonymize: !d.isPublic })
    : "";

  return (
    <CdModal
      open={!!d}
      onClose={() => (busy ? undefined : onClose())}
      title={<span className="inline-flex items-center gap-1">{d?.manualId ? "계약 없는 실적 편집" : "계약 없는 실적 추가"}<CdHelp topic="catalog.manual-project-form" /></span>}
      size="lg"
      closeOnBackdrop={false}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" className="cd-btn cd-btn-ghost" disabled={busy} onClick={onClose}>취소</button>
          <button type="button" className="cd-btn cd-btn-primary" disabled={busy || !d?.title.trim()} onClick={onSave}>저장</button>
        </div>
      }
    >
      {d && (
        <div className="grid gap-3 text-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="grid gap-1">
              <span className="text-xs cd-text-muted">분류 *</span>
              <select className="cd-select" value={d.category} onChange={(e) => set({ category: e.target.value })}>
                {CATALOG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-xs cd-text-muted">세분류</span>
              <input className="cd-input" list="manual-subtypes" value={d.subtype} onChange={(e) => set({ subtype: e.target.value })} />
              <datalist id="manual-subtypes">
                {["최초허가", "변경허가", "변경신고", "재검토", "사후관리"].map((x) => <option key={x} value={x} />)}
              </datalist>
            </label>
            <label className="grid gap-1">
              <span className="text-xs cd-text-muted">상태</span>
              <select className="cd-select" value={d.status} onChange={(e) => set({ status: e.target.value as ManualDraft["status"] })}>
                <option value="completed">완료</option>
                <option value="ongoing">수행 중</option>
              </select>
            </label>
          </div>
          <label className="grid gap-1">
            <span className="text-xs cd-text-muted">실적 이름(내부용) *</span>
            <input className="cd-input" value={d.title} placeholder="예: 석문에너지 통합환경허가 취득 — 한국종합기술 위임" onChange={(e) => set({ title: e.target.value })} />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="grid gap-1">
              <span className="text-xs cd-text-muted">사업장</span>
              <input className="cd-input" value={d.siteName} placeholder="예: 석문에너지" onChange={(e) => set({ siteName: e.target.value })} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs cd-text-muted">발주·위임처</span>
              <input className="cd-input" value={d.counterpartyName} placeholder="예: 한국종합기술" onChange={(e) => set({ counterpartyName: e.target.value })} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs cd-text-muted">시도(권역 집계)</span>
              <input className="cd-input" value={d.regionSido} placeholder="예: 충청남도" onChange={(e) => set({ regionSido: e.target.value })} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs cd-text-muted">업종</span>
              <input className="cd-input" list="manual-industries" value={d.industry} placeholder="예: 발전" onChange={(e) => set({ industry: e.target.value })} />
              <datalist id="manual-industries">
                {INTEGRATED_PERMIT_INDUSTRIES.map((i) => <option key={i.label} value={i.label} />)}
              </datalist>
            </label>
            <label className="grid gap-1">
              <span className="text-xs cd-text-muted">수행 시작(YYYY-MM-DD)</span>
              <input className="cd-input tabular-nums" value={d.startedAt} placeholder="2019-06-01" onChange={(e) => set({ startedAt: e.target.value })} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs cd-text-muted">수행 종료</span>
              <input className="cd-input tabular-nums" value={d.endedAt} placeholder="2020-12-03" onChange={(e) => set({ endedAt: e.target.value })} />
            </label>
            {isPermit && (
              <>
                <label className="grid gap-1">
                  <span className="text-xs cd-text-muted">허가일</span>
                  <input className="cd-input tabular-nums" value={d.permitIssuedAt} placeholder="2020-12-03" onChange={(e) => set({ permitIssuedAt: e.target.value })} />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs cd-text-muted">허가 결정번호</span>
                  <input className="cd-input tabular-nums" value={d.permitNo} placeholder="0000-01" onChange={(e) => set({ permitNo: e.target.value })} />
                </label>
                <label className="grid gap-1">
                  <span className="text-xs cd-text-muted">허가 사업장 수</span>
                  <input
                    className="cd-input tabular-nums"
                    inputMode="numeric"
                    value={d.siteCount}
                    placeholder="비우면 결정번호 수"
                    onChange={(e) => set({ siteCount: e.target.value.replace(/[^\d]/g, "").slice(0, 2) })}
                  />
                </label>
              </>
            )}
            <label className="grid gap-1">
              <span className="text-xs cd-text-muted">수령액(만 원, 선택)</span>
              <input className="cd-input tabular-nums text-right" inputMode="numeric" value={d.amountMan} onChange={(e) => set({ amountMan: e.target.value.replace(/[^\d]/g, "") })} />
            </label>
            <label className="grid gap-1">
              <span className="text-xs cd-text-muted">부록 표시</span>
              <select className="cd-select" value={d.displayOverride} onChange={(e) => set({ displayOverride: e.target.value as DisplayOverride })}>
                <option value="auto">자동</option>
                <option value="always">항상 표시</option>
                <option value="never">항상 숨김</option>
              </select>
            </label>
          </div>
          <label className="grid gap-1">
            <span className="text-xs cd-text-muted">대외 표기명</span>
            <textarea className="cd-input" rows={2} value={d.displayTitle} placeholder={autoTitle} onChange={(e) => set({ displayTitle: e.target.value })} />
            <span className="text-[11px] cd-text-faint">비워 두면 회색 글씨의 자동 표기를 씁니다.</span>
          </label>
          <label className="grid gap-1">
            <span className="text-xs cd-text-muted">계약이 없는 사유(내부용)</span>
            <input className="cd-input" value={d.note} placeholder="예: 한국종합기술 사정으로 정식 계약 미체결, 대금만 수령" onChange={(e) => set({ note: e.target.value })} />
          </label>
          <div className="flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={d.isFeatured} onChange={(e) => set({ isFeatured: e.target.checked })} /> 대표 실적
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={!d.isPublic} onChange={(e) => set({ isPublic: !e.target.checked })} /> 비공개 고객(목록에 ○○사로 표기)
            </label>
          </div>
        </div>
      )}
    </CdModal>
  );
}
