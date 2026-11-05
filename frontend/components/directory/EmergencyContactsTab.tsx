"use client";

// 비상 연락망 탭(/directory) — 소속 칸을 병합한 표 + 엑셀·PDF 다운로드(전 직원), 수정·인원 추가·숨김·순서 변경(전사 staffing.edit).
// 직원 행의 연락처는 인사카드(employee_profiles) 값이다. 저장 규칙은 lib/emergency-contacts.ts 참고.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { ArrowDown, ArrowUp, ArrowUpDown, CopyPlus, Eye, EyeOff, Pencil, PhoneCall, Plus, Search, Trash2 } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdEmptyState } from "@/components/cdash/CdEmptyState";
import { CdHelp } from "@/components/cdash/CdHelp";
import { CdInput } from "@/components/cdash/CdField";
import { CdModal } from "@/components/cdash/CdModal";
import { useCdToast } from "@/components/cdash/CdToast";
import { mailToken } from "@/components/directory/mail-token";
import { hasPerm, permsOf } from "@/lib/auth/perms";
import { filenameFromDisposition } from "@/lib/client-download";
import {
  emergencyHeadcount,
  groupEmergencyRows,
  moveEmergencyGroup,
  moveEmergencyRow,
  type EmergencyContactRow,
} from "@/lib/emergency-contacts-rules";
import { cn } from "@/lib/utils";

const GROUP_LIST_ID = "emergency-group-labels";
// 표는 내용에 맞춘 폭으로 두고 화면 전체로 늘리지 않는다. 이 값보다 긴 내용은 줄바꿈 없이 열이 늘어난다.
const COLUMNS = [
  { label: "소속", width: 128 },
  { label: "이름", width: 76 },
  { label: "직책", width: 100 },
  { label: "직급", width: 100 },
  { label: "연락처", width: 124 },
  { label: "직통번호", width: 124 },
  { label: "이메일", width: 200 },
];

export function EmergencyContactsTab() {
  const { toast } = useCdToast();
  const { data: session } = useSession();
  const canEdit = hasPerm(permsOf(session?.user), "staffing.edit", { global: true });
  const [rows, setRows] = useState<EmergencyContactRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [editing, setEditing] = useState<EmergencyContactRow | "new" | null>(null);
  const [addingLine, setAddingLine] = useState<EmergencyContactRow | null>(null);
  const [deleting, setDeleting] = useState<EmergencyContactRow | null>(null);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/directory/emergency", { cache: "no-store" }).catch(() => null);
    if (r?.ok) {
      const d = await r.json();
      setRows(Array.isArray(d.rows) ? d.rows : []);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const hiddenCount = useMemo(() => (rows ?? []).filter((r) => r.hidden).length, [rows]);
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (r.hidden && !showHidden) return false;
      if (!s) return true;
      return [r.groupLabel, r.name, r.title, r.positionName, r.mobilePhone, r.directPhone, r.email]
        .join(" ")
        .toLowerCase()
        .includes(s);
    });
  }, [rows, q, showHidden]);
  const groups = useMemo(() => groupEmergencyRows(visible), [visible]);
  const groupLabels = useMemo(() => [...new Set((rows ?? []).map((r) => r.groupLabel))], [rows]);
  const total = useMemo(() => emergencyHeadcount((rows ?? []).filter((r) => !r.hidden)), [rows]);
  // 순서 변경은 검색·숨김 표시를 끈 전체 표에서만 한다(일부만 보이는 상태의 순서를 저장하지 않도록).
  const canReorder = canEdit && reordering && !q.trim() && !showHidden;

  const handleExport = async (format: "xlsx" | "pdf") => {
    if (exporting) return;
    setExporting(format);
    try {
      const res = await fetch(`/api/directory/emergency/export?format=${format}`);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFromDisposition(res, `사내 비상연락망.${format}`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast("내보내기에 실패했습니다. 잠시 후 다시 시도해주세요.", "error");
    } finally {
      setExporting(null);
    }
  };

  const saveOrder = async (next: EmergencyContactRow[] | null) => {
    if (!next || !rows) return;
    // 숨긴 행은 화면 순서 뒤에 그대로 붙여 저장한다.
    const merged = [...next, ...rows.filter((r) => r.hidden)];
    const previous = rows;
    setRows(merged);
    const r = await fetch("/api/directory/emergency/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: merged.map((x) => x.key) }),
    }).catch(() => null);
    if (!r?.ok) {
      setRows(previous);
      const d = await r?.json().catch(() => ({}));
      toast(String(d?.error ?? "순서 저장에 실패했습니다."), "error");
    }
  };

  const setHidden = async (row: EmergencyContactRow, hidden: boolean) => {
    const r = await fetch("/api/directory/emergency", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: row.key, hidden }),
    }).catch(() => null);
    if (r?.ok) {
      toast(hidden ? `${row.name} 님을 표에서 숨겼습니다.` : `${row.name} 님을 표에 다시 표시합니다.`, "success");
      await load();
    } else {
      const d = await r?.json().catch(() => ({}));
      toast(String(d?.error ?? "저장에 실패했습니다."), "error");
    }
  };

  const remove = async (row: EmergencyContactRow) => {
    const r = await fetch(`/api/directory/emergency?key=${encodeURIComponent(row.key)}`, { method: "DELETE" }).catch(() => null);
    if (r?.ok) {
      toast(row.sameAsEmployeeId ? `${row.name} 님의 ${row.groupLabel} 줄을 삭제했습니다.` : `${row.name} 님을 비상 연락망에서 삭제했습니다.`, "success");
      await load();
    } else {
      const d = await r?.json().catch(() => ({}));
      toast(String(d?.error ?? "삭제에 실패했습니다."), "error");
    }
    setDeleting(null);
  };

  if (failed && rows == null) {
    return (
      <CdEmptyState
        icon={<PhoneCall className="w-7 h-7" />}
        title="비상 연락망을 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
      />
    );
  }
  if (rows == null) return <p className="text-sm cd-text-faint p-4">불러오는 중입니다.</p>;

  const colCount = canEdit ? 8 : 7;

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 w-fit max-w-full">
      <div className="flex items-center gap-2 flex-wrap">
        <Search className="w-4 h-4 cd-text-faint" />
        <input
          className="cd-input"
          style={{ width: 260, maxWidth: "100%" }}
          placeholder="이름·소속·연락처·이메일 검색"
          aria-label="비상 연락망 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <CdHelp topic="directory.emergency" />
        {canEdit && hiddenCount > 0 && (
          <button type="button" className="cd-chip cd-chip-sm" data-active={showHidden || undefined} onClick={() => setShowHidden((v) => !v)}>
            숨긴 인원 {hiddenCount}명
          </button>
        )}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {canEdit && (
            <>
              <CdButton size="sm" icon={<ArrowUpDown className="w-3.5 h-3.5" />} aria-pressed={reordering} onClick={() => setReordering((v) => !v)}>
                {reordering ? "순서 변경 끝내기" : "순서 변경"}
              </CdButton>
              <CdButton size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => setEditing("new")}>
                인원 추가
              </CdButton>
            </>
          )}
          {/* 내보내기 — 사업장 마스터와 같은 엑셀·PDF 아이콘 2개(30px). */}
          <div className="shrink-0 flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleExport("xlsx")}
              disabled={exporting !== null}
              title="비상 연락망을 엑셀로 다운로드"
              className={cn("flex items-center justify-center disabled:opacity-40", exporting !== null && "cursor-wait")}
              style={{ width: 30, height: 30 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/excelico.png" alt="엑셀 다운로드" className="w-full h-full object-contain" />
            </button>
            <button
              type="button"
              onClick={() => handleExport("pdf")}
              disabled={exporting !== null}
              title="비상 연락망을 PDF로 다운로드"
              className={cn("flex items-center justify-center disabled:opacity-40", exporting !== null && "cursor-wait")}
              style={{ width: 30, height: 30 }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icons/pdfico.png" alt="PDF 다운로드" className="w-full h-full object-contain" />
            </button>
          </div>
        </div>
      </div>

      {reordering && !canReorder && (
        <p className="text-xs cd-text-faint">순서를 바꾸려면 검색어를 지우고 숨긴 인원 보기를 끄세요.</p>
      )}

      <div className="flex-1 min-h-0 overflow-auto cd-card">
        <table className="cd-table text-[12.5px] [&_tbody_td]:!h-[38px] [&_tbody_td]:!py-1" style={{ width: "auto" }}>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.label} style={{ width: c.width }}>
                  {c.label}
                </th>
              ))}
              {canEdit && <th style={{ width: 72 }}>관리</th>}
            </tr>
          </thead>
          <tbody>
            {groups.map((group, groupIndex) =>
              group.rows.map((row, rowIndex) => (
                <tr key={row.key} style={row.hidden ? { opacity: 0.55 } : undefined}>
                  {rowIndex === 0 && (
                    <td rowSpan={group.rows.length} className="cd-text font-semibold whitespace-nowrap align-middle border-r cd-hairline-c">
                      <div className="flex items-center gap-1.5">
                        <span>{group.label}</span>
                        {canReorder && groups.length > 1 && (
                          <OrderButtons
                            label={`${group.label} 소속`}
                            canUp={groupIndex > 0}
                            canDown={groupIndex < groups.length - 1}
                            onMove={(delta) => saveOrder(moveEmergencyGroup(visible, groupIndex, delta))}
                          />
                        )}
                      </div>
                    </td>
                  )}
                  <td className="cd-text font-bold whitespace-nowrap">
                    {row.name}
                    {row.hidden && <span className="ml-1.5 text-[11px] font-medium cd-text-faint">숨김</span>}
                  </td>
                  <td className="cd-text-muted whitespace-nowrap">{row.title || "-"}</td>
                  <td className="cd-text-muted whitespace-nowrap">{row.positionName || "-"}</td>
                  <td className="cd-text-muted tabular-nums whitespace-nowrap">{row.mobilePhone || "-"}</td>
                  <td className="cd-text-muted tabular-nums whitespace-nowrap">{row.directPhone || "-"}</td>
                  <td className="whitespace-nowrap">
                    {row.email ? (
                      <Link
                        href={`/mail/compose?to=${encodeURIComponent(mailToken(row.name, row.positionName, row.email))}`}
                        className="cd-text-primary hover:underline"
                      >
                        {row.email}
                      </Link>
                    ) : (
                      <span className="cd-text-faint">-</span>
                    )}
                  </td>
                  {canEdit && (
                    <td>
                      {canReorder ? (
                        <OrderButtons
                          label={`${row.name} 님`}
                          canUp={rowIndex > 0}
                          canDown={rowIndex < group.rows.length - 1}
                          onMove={(delta) => saveOrder(moveEmergencyRow(visible, row.key, delta))}
                        />
                      ) : (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="p-1 rounded-md cd-text-faint hover:cd-text-primary"
                            title="수정"
                            aria-label={`${row.name} 수정`}
                            onClick={() => setEditing(row)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {row.employeeId ? (
                            <button
                              type="button"
                              className="p-1 rounded-md cd-text-faint hover:cd-text-primary"
                              title={row.hidden ? "다시 표시" : "숨기기"}
                              aria-label={`${row.name} ${row.hidden ? "다시 표시" : "숨기기"}`}
                              onClick={() => setHidden(row, !row.hidden)}
                            >
                              {row.hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="p-1 rounded-md cd-text-faint hover:cd-error-text"
                              title="삭제"
                              aria-label={`${row.name} 삭제`}
                              onClick={() => setDeleting(row)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
            {visible.length === 0 && (
              <tr>
                <td colSpan={colCount} className="text-center cd-text-faint p-6">표시할 인원이 없습니다.</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t cd-hairline-c">
              <td className="cd-text font-semibold whitespace-nowrap px-3 py-2.5">총 인원</td>
              <td colSpan={colCount - 1} className="cd-text font-semibold px-3 py-2.5">{total}명</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <datalist id={GROUP_LIST_ID}>
        {groupLabels.map((label) => (
          <option key={label} value={label} />
        ))}
      </datalist>

      {editing && (
        <EmergencyContactModal
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
          onAddLine={(row) => {
            setEditing(null);
            setAddingLine(row);
          }}
        />
      )}

      {addingLine && (
        <EmergencyContactLineModal
          row={addingLine}
          onClose={() => setAddingLine(null)}
          onSaved={async () => {
            setAddingLine(null);
            await load();
          }}
        />
      )}

      <CdModal
        open={deleting != null}
        onClose={() => setDeleting(null)}
        title="비상 연락망에서 삭제"
        size="sm"
        footer={
          <>
            <CdButton onClick={() => setDeleting(null)}>취소</CdButton>
            <CdButton variant="danger" icon={<Trash2 className="w-4 h-4" />} onClick={() => deleting && remove(deleting)}>
              삭제
            </CdButton>
          </>
        }
      >
        <p className="text-sm cd-text">
          {deleting
            ? deleting.sameAsEmployeeId
              ? `'${deleting.name}' 님의 ${deleting.groupLabel} 줄을 삭제할까요? 인사카드와 다른 소속 줄은 그대로입니다.`
              : `'${deleting.name}' 님을 비상 연락망에서 삭제할까요?`
            : ""}
        </p>
      </CdModal>
    </div>
  );
}

function OrderButtons({
  label,
  canUp,
  canDown,
  onMove,
}: {
  label: string;
  canUp: boolean;
  canDown: boolean;
  onMove: (delta: -1 | 1) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className="p-1 rounded-md cd-text-faint hover:cd-text-primary disabled:opacity-30"
        title="위로"
        aria-label={`${label} 위로`}
        disabled={!canUp}
        onClick={() => onMove(-1)}
      >
        <ArrowUp className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        className="p-1 rounded-md cd-text-faint hover:cd-text-primary disabled:opacity-30"
        title="아래로"
        aria-label={`${label} 아래로`}
        disabled={!canDown}
        onClick={() => onMove(1)}
      >
        <ArrowDown className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/** 사용자 등록 화면의 휴대폰·직통 번호 입력과 같은 자동 하이픈. */
function formatPhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.startsWith("02")) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    if (digits.length <= 10) return `${digits.slice(0, 2)}-${digits.slice(2, digits.length - 4)}-${digits.slice(-4)}`;
  }
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, digits.length - 4)}-${digits.slice(-4)}`;
}

/** 겸직 줄 추가 창 — 같은 사람을 다른 소속에도 표시한다. */
function EmergencyContactLineModal({
  row,
  onClose,
  onSaved,
}: {
  row: EmergencyContactRow;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { toast } = useCdToast();
  const [groupLabel, setGroupLabel] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!groupLabel.trim()) {
      toast("소속을 입력하세요.", "warn");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/directory/emergency", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sameAsEmployeeId: row.employeeId, groupLabel, title }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(String(d.error ?? "저장에 실패했습니다."), "error");
        return;
      }
      toast(`${row.name} 님을 ${groupLabel.trim()}에도 표시합니다.`, "success");
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <CdModal
      open
      onClose={onClose}
      title="다른 소속에도 표시"
      size="sm"
      footer={
        <>
          <CdButton onClick={onClose}>취소</CdButton>
          <CdButton variant="primary" loading={saving} onClick={save}>
            추가
          </CdButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm cd-text font-semibold">{row.name}</p>
        <p className="text-xs cd-text-faint">겸직하는 소속에 줄을 하나 더 만듭니다. 번호는 인사카드를 따르고, 총 인원에는 1명으로 셉니다.</p>
        <CdInput label="소속" required list={GROUP_LIST_ID} value={groupLabel} onChange={(e) => setGroupLabel(e.target.value)} />
        <CdInput label="직책" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={row.defaultTitle || undefined} />
      </div>
    </CdModal>
  );
}

/** 수정·인원 추가 창. 직원 행·겸직 줄의 이름·직급은 인사카드 값이라 읽기 전용이다. */
function EmergencyContactModal({
  row,
  onClose,
  onSaved,
  onAddLine,
}: {
  row: EmergencyContactRow | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onAddLine: (row: EmergencyContactRow) => void;
}) {
  const { toast } = useCdToast();
  const isEmployee = !!row?.employeeId || !!row?.sameAsEmployeeId;
  const [groupLabel, setGroupLabel] = useState(row && row.groupLabel !== row.defaultGroupLabel ? row.groupLabel : row?.employeeId ? "" : row?.groupLabel ?? "");
  const [title, setTitle] = useState(row && row.title !== row.defaultTitle ? row.title : "");
  const [name, setName] = useState(row?.name ?? "");
  const [positionName, setPositionName] = useState(row?.positionName ?? "");
  const [mobilePhone, setMobilePhone] = useState(row?.mobilePhone ?? "");
  const [directPhone, setDirectPhone] = useState(row?.directPhone ?? "");
  const [email, setEmail] = useState(row?.email ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!isEmployee && !name.trim()) {
      toast("이름을 입력하세요.", "warn");
      return;
    }
    if (!row && !groupLabel.trim()) {
      toast("소속을 입력하세요.", "warn");
      return;
    }
    setSaving(true);
    try {
      const body = {
        ...(row ? { key: row.key } : {}),
        groupLabel,
        title,
        mobilePhone,
        directPhone,
        email,
        ...(isEmployee ? {} : { name, positionName }),
      };
      const r = await fetch("/api/directory/emergency", {
        method: row ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast(String(d.error ?? "저장에 실패했습니다."), "error");
        return;
      }
      toast(row ? "비상 연락망을 저장했습니다." : "인원을 추가했습니다.", "success");
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <CdModal
      open
      onClose={onClose}
      title={row ? "비상 연락망 수정" : "인원 추가"}
      size="md"
      footer={
        <>
          <CdButton onClick={onClose}>취소</CdButton>
          <CdButton variant="primary" loading={saving} onClick={save}>
            저장
          </CdButton>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {isEmployee ? (
          <>
            <p className="text-sm cd-text font-semibold">
              {row?.name}
              {row?.positionName && <span className="ml-1.5 text-xs font-medium cd-text-faint">{row.positionName}</span>}
            </p>
            <p className="text-xs cd-text-faint">이름·직급은 사용자 등록에서 바꿉니다. 연락처·직통번호·이메일을 고치면 인사카드에도 함께 반영됩니다.</p>
          </>
        ) : (
          !row && <p className="text-xs cd-text-faint">사용자 등록에 있는 직원은 자동으로 표에 들어옵니다. 인사카드가 없는 인원만 여기서 추가하세요.</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {!isEmployee && (
            <>
              <CdInput label="이름" required value={name} onChange={(e) => setName(e.target.value)} />
              <CdInput label="직급" value={positionName} onChange={(e) => setPositionName(e.target.value)} />
            </>
          )}
          <CdInput
            label="소속"
            required={!row?.employeeId}
            list={GROUP_LIST_ID}
            value={groupLabel}
            onChange={(e) => setGroupLabel(e.target.value)}
            placeholder={isEmployee ? row?.defaultGroupLabel : undefined}
            hint={row?.employeeId ? "비워 두면 부서명을 씁니다." : undefined}
          />
          <CdInput
            label="직책"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={isEmployee ? row?.defaultTitle || undefined : "예: 팀원"}
            hint={isEmployee ? "비워 두면 보직의 직책을 씁니다." : undefined}
          />
          <CdInput label="연락처" inputMode="numeric" value={mobilePhone} onChange={(e) => setMobilePhone(formatPhoneNumber(e.target.value))} />
          <CdInput label="직통번호" inputMode="numeric" value={directPhone} onChange={(e) => setDirectPhone(formatPhoneNumber(e.target.value))} />
        </div>
        <CdInput label="이메일" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
        {row?.employeeId && (
          <div>
            <CdButton size="sm" icon={<CopyPlus className="w-3.5 h-3.5" />} onClick={() => onAddLine(row)}>
              다른 소속에도 표시
            </CdButton>
          </div>
        )}
      </div>
    </CdModal>
  );
}
