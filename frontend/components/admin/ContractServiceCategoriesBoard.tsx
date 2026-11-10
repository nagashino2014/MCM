"use client";

// 용역 분류(/admin/contract-service-categories) — 계약 용역 대분류·세분류 단일 원천(348, 2026-11-10).
// 여기서 추가·이름 변경·순서 변경·사용 중지·삭제하면 계약 입력·변경계약·견적 작성·견적 기준·계약서 작성·계약서 템플릿
// 화면이 같은 목록을 읽고, 계약 트리의 대분류 순서도 이 순서를 따른다.
// 결정(사용자 확정): 이름 변경은 저장된 계약·견적·계약서 값까지 새 이름으로 바꾼다. 쓰인 항목은 삭제 대신 사용 중지.
// 기본 대분류 5개와 허가번호 입력에 연결된 세분류 3개는 이름을 바꿀 수 없다(lock_reason).

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ListTree, Loader2, Lock, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdModal } from "@/components/cdash/CdModal";
import { CdInput } from "@/components/cdash/CdField";
import { CdButton, CdIconButton } from "@/components/cdash/CdButton";
import { useCdToast } from "@/components/cdash/CdToast";
import { refreshContractServiceOptions } from "@/lib/contracts/use-contract-service-options";
import type { ContractServiceType } from "@/lib/contracts/service-categories";
import "@/components/cdash/cdash.css";

type Kind = "type" | "subtype";

interface Usage {
  contracts: number;
  total: number;
}

interface UsageMap {
  types: Record<string, Usage>;
  subtypes: Record<string, Usage>;
}

interface Draft {
  mode: "create" | "rename";
  kind: Kind;
  /** rename 대상 id 또는 createSubtype 의 대분류 id */
  id: string;
  label: string;
  prevLabel: string;
  usage: Usage;
}

/** 목록에서 다루는 한 줄 — 대분류·세분류 공용 */
interface Row {
  id: string;
  label: string;
  active: boolean;
  lockReason: string | null;
  aliases: string[];
  usage: Usage;
}

const NO_USAGE: Usage = { contracts: 0, total: 0 };

function usageKey(type: string, subtype: string): string {
  return `${type}\u0000${subtype}`;
}

function usageText(usage: Usage): string {
  if (!usage.total) return "쓰인 곳 없음";
  const others = usage.total - usage.contracts;
  return `계약 ${usage.contracts.toLocaleString()}건${others > 0 ? ` · 견적·계약서 등 ${others.toLocaleString()}건` : ""}`;
}

export function ContractServiceCategoriesBoard() {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const [types, setTypes] = useState<ContractServiceType[]>([]);
  const [usage, setUsage] = useState<UsageMap>({ types: {}, subtypes: {} });
  const [fromTable, setFromTable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/contract-service-categories", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "용역 분류를 불러오지 못했습니다.");
      const list: ContractServiceType[] = data.types ?? [];
      setTypes(list);
      setUsage(data.usage ?? { types: {}, subtypes: {} });
      setFromTable(data.fromTable !== false);
      setSelectedTypeId((cur) => (cur && list.some((t) => t.id === cur) ? cur : list[0]?.id ?? null));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedType = types.find((t) => t.id === selectedTypeId) ?? null;

  const typeRows: Row[] = useMemo(
    () =>
      types.map((t) => ({
        id: t.id,
        label: t.label,
        active: t.active,
        lockReason: t.lockReason,
        aliases: [],
        usage: usage.types[t.label] ?? NO_USAGE,
      })),
    [types, usage]
  );

  const subtypeRows: Row[] = useMemo(
    () =>
      (selectedType?.subtypes ?? []).map((s) => ({
        id: s.id,
        label: s.label,
        active: s.active,
        lockReason: s.lockReason,
        aliases: s.aliases,
        usage: usage.subtypes[usageKey(selectedType!.label, s.label)] ?? NO_USAGE,
      })),
    [selectedType, usage]
  );

  /** 편집 요청 — 성공하면 목록과 같은 탭의 다른 화면 선택 목록을 다시 읽는다. */
  const post = async (body: unknown): Promise<{ ok: boolean; changedText?: string }> => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/contract-service-categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "HTTP " + res.status);
      await Promise.all([load(), refreshContractServiceOptions()]);
      return { ok: true, changedText: data?.changedText || undefined };
    } catch (err) {
      toast((err as Error).message, "error");
      setDraftError((err as Error).message);
      return { ok: false };
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setDraftError(null);
    const label = draft.label.trim();
    const body =
      draft.mode === "rename"
        ? { action: "rename", kind: draft.kind, id: draft.id, label }
        : draft.kind === "type"
          ? { action: "createType", label }
          : { action: "createSubtype", typeId: draft.id, label };
    const result = await post(body);
    if (!result.ok) return;
    if (draft.mode === "rename") {
      toast(result.changedText ? `이름을 바꿨습니다 — ${result.changedText}을 새 이름으로 바꿨습니다.` : "이름을 바꿨습니다.", "success");
    } else {
      toast(draft.kind === "type" ? "대분류를 추가했습니다." : "세분류를 추가했습니다.", "success");
    }
    setDraft(null);
  };

  const setActive = async (kind: Kind, row: Row, active: boolean) => {
    const what = kind === "type" ? "대분류" : "세분류";
    if (
      !active &&
      !window.confirm(
        `'${row.label}' ${what}를 사용 중지할까요? 새 계약·견적 입력 목록에서만 빠지고, 이미 저장된 계약·견적의 분류는 그대로 보입니다.`
      )
    )
      return;
    const result = await post({ action: "setActive", kind, id: row.id, active });
    if (result.ok) toast(active ? "다시 사용합니다." : "사용 중지했습니다.", "success");
  };

  /** 삭제 — 쓰인 적 없으면 실제 삭제, 쓰였거나 이름이 고정된 항목은 사용 중지로 안내한다(사용자 확정). */
  const remove = async (kind: Kind, row: Row) => {
    const what = kind === "type" ? "대분류" : "세분류";
    if (row.usage.total > 0 || row.lockReason) {
      const reason = row.usage.total > 0 ? `이미 ${usageText(row.usage)}에 쓰여` : "기본 분류라";
      if (!row.active) {
        window.alert(`'${row.label}' ${what}는 ${reason} 지울 수 없습니다. 이미 사용 중지 상태입니다.`);
        return;
      }
      if (!window.confirm(`'${row.label}' ${what}는 ${reason} 지울 수 없습니다. 대신 사용 중지할까요? 기존 계약의 분류는 그대로 보입니다.`)) return;
      const result = await post({ action: "setActive", kind, id: row.id, active: false });
      if (result.ok) toast("사용 중지했습니다.", "success");
      return;
    }
    const subCount = kind === "type" ? types.find((t) => t.id === row.id)?.subtypes.length ?? 0 : 0;
    const extra = subCount > 0 ? ` 아래 세분류 ${subCount}개도 함께 지워집니다.` : "";
    if (!window.confirm(`'${row.label}' ${what}를 지울까요? 쓰인 곳이 없어 바로 지워집니다.${extra}`)) return;
    const result = await post({ action: "delete", kind, id: row.id });
    if (result.ok) toast("지웠습니다.", "success");
  };

  const move = async (kind: Kind, rows: Row[], index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const ids = rows.map((r) => r.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    // 화면 먼저 바꾸고 저장(실패하면 post 가 다시 읽어 되돌린다)
    if (kind === "type") {
      setTypes((prev) => ids.map((id) => prev.find((t) => t.id === id)!).filter(Boolean));
    } else if (selectedType) {
      const nextSubs = ids.map((id) => selectedType.subtypes.find((s) => s.id === id)!).filter(Boolean);
      setTypes((prev) => prev.map((t) => (t.id === selectedType.id ? { ...t, subtypes: nextSubs } : t)));
    }
    await post({ action: "reorder", kind, ids });
  };

  const openCreate = (kind: Kind) => {
    if (kind === "subtype" && !selectedType) return;
    setDraftError(null);
    setDraft({ mode: "create", kind, id: kind === "subtype" ? selectedType!.id : "", label: "", prevLabel: "", usage: NO_USAGE });
  };

  const openRename = (kind: Kind, row: Row) => {
    setDraftError(null);
    setDraft({ mode: "rename", kind, id: row.id, label: row.label, prevLabel: row.label, usage: row.usage });
  };

  const activeTypeCount = types.filter((t) => t.active).length;
  const subtypeTotal = types.reduce((sum, t) => sum + t.subtypes.length, 0);
  const editable = fromTable && !busy;

  const renderTable = (kind: Kind, rows: Row[]) => {
    const what = kind === "type" ? "대분류" : "세분류";
    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="cd-table-head">
            <tr className="cd-text-faint text-xs border-b cd-border-c">
              <th className="py-2 px-2 text-left w-16">순서</th>
              <th className="py-2 px-2 text-left">{what}</th>
              <th className="py-2 px-2 text-left">쓰인 곳</th>
              <th className="py-2 px-2 text-left w-20">상태</th>
              <th className="py-2 px-2 text-right">관리</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="py-10 text-center cd-text-faint">
                  <Loader2 className="w-4 h-4 animate-spin inline-block mr-2 align-[-2px]" />
                  불러오는 중…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center cd-text-faint">등록된 {what}가 없습니다.</td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const selected = kind === "type" && row.id === selectedTypeId;
                return (
                  <tr
                    key={row.id}
                    className={`border-b cd-border-c ${selected ? "cd-tint-primary" : ""} ${row.active ? "" : "opacity-60"}`}
                    aria-selected={kind === "type" ? selected : undefined}
                  >
                    <td className="py-2 px-2 whitespace-nowrap">
                      <div className="flex items-center gap-0.5">
                        <CdIconButton size="sm" label={`${row.label} 위로`} disabled={!editable || index === 0} onClick={() => move(kind, rows, index, -1)}>
                          <ArrowUp className="w-3.5 h-3.5" />
                        </CdIconButton>
                        <CdIconButton size="sm" label={`${row.label} 아래로`} disabled={!editable || index === rows.length - 1} onClick={() => move(kind, rows, index, 1)}>
                          <ArrowDown className="w-3.5 h-3.5" />
                        </CdIconButton>
                      </div>
                    </td>
                    <td className="py-2 px-2 min-w-[8.5rem]">
                      {kind === "type" ? (
                        <button
                          type="button"
                          className={`text-left font-medium whitespace-nowrap hover:underline underline-offset-2 ${selected ? "cd-text-primary" : ""}`}
                          onClick={() => setSelectedTypeId(row.id)}
                        >
                          {row.label}
                        </button>
                      ) : (
                        <div className="font-medium whitespace-nowrap">{row.label}</div>
                      )}
                      {(kind === "type" || row.lockReason || row.aliases.length > 0) && (
                        <div className="text-[11px] cd-text-faint flex flex-wrap items-center gap-x-1">
                          {kind === "type" && <span>세분류 {types.find((t) => t.id === row.id)?.subtypes.length ?? 0}</span>}
                          {kind === "type" && row.lockReason && <span>·</span>}
                          {row.lockReason && (
                            <span className="inline-flex items-center gap-0.5" title={row.lockReason}>
                              <Lock className="w-3 h-3" aria-hidden />
                              이름 고정
                            </span>
                          )}
                          {(kind === "type" || row.lockReason) && row.aliases.length > 0 && <span>·</span>}
                          {row.aliases.length > 0 && <span>옛 이름 {row.aliases.join(", ")}</span>}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-2 text-xs tabular-nums cd-text-muted">{usageText(row.usage)}</td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <span className={`cd-pill ${row.active ? "cd-pill-success" : "cd-pill-idle"} text-[11px]`}>{row.active ? "사용 중" : "사용 중지"}</span>
                    </td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-0.5">
                        <CdIconButton
                          size="sm"
                          label={row.lockReason ? `이름 변경 불가 — ${row.lockReason}` : `${row.label} 이름 변경`}
                          disabled={!editable || !!row.lockReason}
                          onClick={() => openRename(kind, row)}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </CdIconButton>
                        <CdButton size="sm" variant="ghost" disabled={!editable} onClick={() => setActive(kind, row, !row.active)}>
                          {row.active ? "사용 중지" : "다시 사용"}
                        </CdButton>
                        <CdIconButton size="sm" label={`${row.label} 삭제`} disabled={!editable} onClick={() => remove(kind, row)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </CdIconButton>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="cdash cd-fields-white flex h-full min-h-0 flex-col gap-5 p-4 md:p-5 rounded-3xl" data-theme={theme}>
      <CdPageHeader
        icon={<ListTree className="w-5 h-5" />}
        title="용역 분류"
        meta={types.length ? `대분류 ${activeTypeCount}개 사용 중 · 세분류 ${subtypeTotal}개` : undefined}
        helpTopic="admin.contract-service-categories"
        actions={
          <CdIconButton label="새로고침" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5" />
          </CdIconButton>
        }
      />
      {error && <p className="text-sm cd-error-text">{error}</p>}
      {!fromTable && !loading && (
        <p className="text-sm cd-warn-text" role="status">
          용역 분류 표(마이그레이션 348)가 아직 적용되지 않아 기본 목록으로 동작 중입니다. 적용한 뒤 편집할 수 있습니다.
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start">
        <section className="cd-card p-5 gap-3" aria-label="대분류">
          <div className="flex items-center gap-2">
            <h2 className="cd-card-title">대분류</h2>
            <CdButton className="ml-auto" size="sm" variant="primary" icon={<Plus className="w-3.5 h-3.5" />} disabled={!editable} onClick={() => openCreate("type")}>
              대분류 추가
            </CdButton>
          </div>
          {renderTable("type", typeRows)}
        </section>

        <section className="cd-card p-5 gap-3" aria-label="세분류">
          <div className="flex items-center gap-2">
            <h2 className="cd-card-title">세분류{selectedType ? ` — ${selectedType.label}` : ""}</h2>
            <CdButton
              className="ml-auto"
              size="sm"
              variant="primary"
              icon={<Plus className="w-3.5 h-3.5" />}
              disabled={!editable || !selectedType}
              onClick={() => openCreate("subtype")}
            >
              세분류 추가
            </CdButton>
          </div>
          {selectedType ? (
            renderTable("subtype", subtypeRows)
          ) : (
            <p className="py-10 text-center text-sm cd-text-faint">왼쪽에서 대분류를 고르세요.</p>
          )}
        </section>
      </div>

      <CdModal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={
          draft
            ? `${draft.kind === "type" ? "대분류" : "세분류"} ${draft.mode === "rename" ? "이름 변경" : "추가"}`
            : ""
        }
        footer={
          <div className="flex justify-end gap-2">
            <CdButton variant="ghost" onClick={() => setDraft(null)}>
              취소
            </CdButton>
            <CdButton variant="primary" loading={busy} disabled={busy || !draft?.label.trim()} onClick={save}>
              저장
            </CdButton>
          </div>
        }
      >
        {draft && (
          <div className="grid gap-3">
            {draft.kind === "subtype" && draft.mode === "create" && selectedType && (
              <p className="text-sm cd-text-muted">대분류: {selectedType.label}</p>
            )}
            <CdInput
              label={draft.kind === "type" ? "대분류 이름" : "세분류 이름"}
              required
              autoFocus
              value={draft.label}
              maxLength={30}
              placeholder={draft.kind === "type" ? "예: 기술진단" : "예: 사후환경영향조사"}
              hint={
                draft.mode === "rename"
                  ? draft.usage.total > 0
                    ? `저장하면 '${draft.prevLabel}'으로 저장된 ${usageText(draft.usage)}도 새 이름으로 바뀝니다. 옛 이름은 기록으로 남습니다.`
                    : "쓰인 곳이 없어 목록 이름만 바뀝니다."
                  : draft.kind === "type"
                    ? "새 대분류는 견적번호가 '기타' 순번으로 매겨집니다. 세분류를 하나 이상 추가해야 계약 입력에서 고를 수 있습니다."
                    : "30자 이내. 저장하면 계약 입력·견적·계약서 화면의 선택 목록에 바로 나옵니다."
              }
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void save();
                }
              }}
            />
            {draftError && <p className="text-sm cd-error-text">{draftError}</p>}
          </div>
        )}
      </CdModal>
    </div>
  );
}
