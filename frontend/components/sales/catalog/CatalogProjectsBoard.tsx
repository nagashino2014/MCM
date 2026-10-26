"use client";

// 실적 노출 관리 — 부록 실적의 대외 표기·노출 고정·대표 실적·묶음·비공개 고객 + 표시 범위 규칙(금액·기간·상태).
// 표기명·표시 판정은 lib/catalog/appendix.ts 순수 함수로 화면에서 즉시 계산한다(서버 미리보기 API 와 같은 결과).
// 계약 입력 동선은 바꾸지 않는다 — 메타는 이 화면에서만 다룬다. docs/company-catalog-blueprint.md §6-4

import { useCallback, useEffect, useMemo, useState } from "react";
import { ListChecks, RefreshCw, RotateCcw, Save, Search, Sparkles, X } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdHelp } from "@/components/cdash/CdHelp";
import { CdTabs } from "@/components/cdash/CdTabs";
import { CdModal } from "@/components/cdash/CdModal";
import { useClientPaging } from "@/components/ui/PaginationControls";
import { CATALOG_CATEGORIES } from "@/lib/catalog/areas";
import {
  DEFAULT_APPENDIX_RULES,
  HIDDEN_REASON_LABEL,
  MANUAL_ID_PREFIX,
  applyAppendixRules,
  buildDisplayIndustry,
  buildDisplayTitle,
  effectiveIndustry,
  effectiveTitle,
  hiddenReason,
  isCompleted,
  periodLabel,
  permitSiteCount,
  projectSiteCount,
  type AppendixRules,
  type CatalogProjectRow,
  type DisplayOverride,
  type HiddenReason,
  type ManualProject,
} from "@/lib/catalog/appendix";
import { regionGroupLabel } from "@/lib/catalog/regions";
import { awkwardReasons } from "@/lib/catalog/ai/label-rules";
import { CatalogLabelSuggest } from "./CatalogLabelSuggest";
import { catalogFetch, formatAmountShort } from "./catalogFetch";
import {
  ManualProjectModal,
  ManualProjectsPanel,
  draftToPayload,
  emptyManualDraft,
  isManualId,
  manualToDraft,
  type ManualDraft,
} from "./CatalogManualProjects";
import "@/components/cdash/cdash.css";

type TabKey = "list" | "manual" | "rules";
type VisibilityFilter = "" | "shown" | "hidden" | "unreviewed" | "featured" | "private" | "grouped";

const OVERRIDE_LABEL: Record<DisplayOverride, string> = { auto: "자동", always: "항상 표시", never: "항상 숨김" };

interface MetaDraft {
  displayTitle: string;
  displayIndustry: string;
  displayOverride: DisplayOverride;
  isFeatured: boolean;
  isPublic: boolean;
  groupKey: string;
  note: string;
  /** 허가 사업장 수(빈칸 = 결정번호 수) — 통합환경허가만 */
  siteCount: string;
}

export function CatalogProjectsBoard() {
  const { theme } = useCdashTheme();
  const [tab, setTab] = useState<TabKey>("list");
  const [rows, setRows] = useState<CatalogProjectRow[]>([]);
  const [savedRules, setSavedRules] = useState<AppendixRules>(DEFAULT_APPENDIX_RULES);
  const [draftRules, setDraftRules] = useState<AppendixRules>(DEFAULT_APPENDIX_RULES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // 목록 필터
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [year, setYear] = useState("");
  const [visibility, setVisibility] = useState<VisibilityFilter>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<CatalogProjectRow | null>(null);
  const [draft, setDraft] = useState<MetaDraft | null>(null);
  const [groupPrompt, setGroupPrompt] = useState<string | null>(null);
  const [labelOpen, setLabelOpen] = useState(false);
  // 계약 없는 실적
  const [manuals, setManuals] = useState<ManualProject[]>([]);
  const [manualDraft, setManualDraft] = useState<ManualDraft | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, manual] = await Promise.all([
        catalogFetch<{ rows: CatalogProjectRow[]; rules: AppendixRules }>("/api/catalog/projects"),
        catalogFetch<{ items: ManualProject[] }>("/api/catalog/manual-projects"),
      ]);
      setRows(data.rows);
      setManuals(manual.items);
      setSavedRules(data.rules);
      setDraftRules(data.rules);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const nowYear = new Date().getFullYear();
  const years = useMemo(() => [...new Set(rows.map((r) => r.year).filter(Boolean))].sort().reverse(), [rows]);
  const groupKeys = useMemo(() => [...new Set(rows.map((r) => r.meta?.groupKey ?? "").filter(Boolean))].sort(), [rows]);
  const reasonOf = useCallback((r: CatalogProjectRow): HiddenReason | null => hiddenReason(r, savedRules, nowYear), [savedRules, nowYear]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (category && r.category !== category) return false;
        if (year && r.year !== year) return false;
        const reason = reasonOf(r);
        if (visibility === "shown" && reason) return false;
        if (visibility === "hidden" && !reason) return false;
        if (visibility === "unreviewed" && r.meta?.reviewedAt) return false;
        if (visibility === "featured" && !r.meta?.isFeatured) return false;
        if (visibility === "private" && (r.meta?.isPublic ?? true)) return false;
        if (visibility === "grouped" && !r.meta?.groupKey) return false;
        if (s) {
          const hay = [r.contractTitle, r.counterpartyName, r.siteName, effectiveTitle(r), r.permitNo].join(" ").toLowerCase();
          if (!hay.includes(s)) return false;
        }
        return true;
      })
      .slice()
      .reverse(); // 최근 계약 먼저
  }, [rows, q, category, year, visibility, reasonOf]);
  const { pageRows, pager, resetPage } = useClientPaging(filtered, "catalog-projects-page-size", loading);
  const unreviewed = useMemo(() => rows.filter((r) => !r.meta?.reviewedAt).length, [rows]);
  // 규칙 표기가 어색한 행(AI 표기 제안 대상, P6)
  const awkwardCount = useMemo(() => rows.filter((r) => r.source === "contract" && awkwardReasons(r).length > 0).length, [rows]);

  const savedResult = useMemo(() => applyAppendixRules(rows, savedRules, nowYear), [rows, savedRules, nowYear]);
  const draftResult = useMemo(() => applyAppendixRules(rows, draftRules, nowYear), [rows, draftRules, nowYear]);
  const rulesDirty = JSON.stringify(savedRules) !== JSON.stringify(draftRules);

  const saveMeta = async (contractIds: string[], patch: Record<string, unknown>, doneText: string) => {
    if (contractIds.length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      const data = await catalogFetch<{ rows: CatalogProjectRow[]; updated: number }>("/api/catalog/projects", {
        method: "PUT",
        body: JSON.stringify({ contractIds, patch }),
      });
      setRows(data.rows);
      setNotice(`${doneText} — ${data.updated}건`);
      return true;
    } catch (e) {
      alert((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (r: CatalogProjectRow) => {
    if (r.source === "manual") {
      const m = manuals.find((x) => isManualId(r.contractId) && r.contractId === MANUAL_ID_PREFIX + x.manualId);
      if (m) setManualDraft(manualToDraft(m));
      return;
    }
    setEditing(r);
    setDraft({
      displayTitle: r.meta?.displayTitle ?? "",
      displayIndustry: r.meta?.displayIndustry ?? "",
      displayOverride: r.meta?.displayOverride ?? "auto",
      isFeatured: r.meta?.isFeatured ?? false,
      isPublic: r.meta?.isPublic ?? true,
      groupKey: r.meta?.groupKey ?? "",
      note: r.meta?.note ?? "",
      siteCount: r.meta?.siteCount != null ? String(r.meta.siteCount) : "",
    });
  };

  const submitEdit = async (markReviewed: boolean) => {
    if (!editing || !draft) return;
    const { siteCount, ...rest } = draft;
    const patch = {
      ...rest,
      ...(editing.category === "통합환경허가" ? { siteCount: siteCount.trim() === "" ? null : Number(siteCount) } : {}),
      ...(markReviewed ? { reviewed: true } : {}),
    };
    const ok = await saveMeta([editing.contractId], patch, "저장했습니다");
    if (ok) {
      setEditing(null);
      setDraft(null);
    }
  };

  const bulk = async (patch: Record<string, unknown>, text: string) => {
    const ok = await saveMeta([...selected], patch, text);
    if (ok) setSelected(new Set());
  };

  const saveManual = async () => {
    if (!manualDraft) return;
    setBusy(true);
    setNotice(null);
    try {
      await catalogFetch("/api/catalog/manual-projects", { method: "POST", body: JSON.stringify(draftToPayload(manualDraft)) });
      setManualDraft(null);
      await reload();
      setNotice("계약 없는 실적을 저장했습니다");
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteManual = async (m: ManualProject) => {
    if (!confirm(`'${m.title}'을(를) 삭제할까요? 회사소개서 지표·부록에서 빠집니다.`)) return;
    setBusy(true);
    try {
      await catalogFetch(`/api/catalog/manual-projects?manualId=${encodeURIComponent(m.manualId)}`, { method: "DELETE" });
      await reload();
      setNotice("계약 없는 실적을 삭제했습니다");
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveRules = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const data = await catalogFetch<{ rules: AppendixRules }>("/api/catalog/appendix-rules", {
        method: "PUT",
        body: JSON.stringify({ rules: draftRules }),
      });
      setSavedRules(data.rules);
      setDraftRules(data.rules);
      setNotice("표시 범위를 저장했습니다");
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectablePageRows = pageRows.filter((r) => r.source === "contract");
  const allOnPageSelected = selectablePageRows.length > 0 && selectablePageRows.every((r) => selected.has(r.contractId));

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<ListChecks className="w-5 h-5" />}
        eyebrow="회사소개서"
        breadcrumbs={[{ label: "회사소개서", href: "/sales/catalog" }, { label: "실적 노출 관리" }]}
        title="실적 노출 관리"
        titleSuffix={`${rows.length.toLocaleString("ko-KR")}건`}
        helpTopic="catalog.projects"
        meta={
          <span className="text-xs cd-text-muted">
            부록 표시 {savedResult.shownContracts.toLocaleString("ko-KR")}건 · 숨김 {savedResult.hiddenContracts.toLocaleString("ko-KR")}건 · 미검토 {unreviewed.toLocaleString("ko-KR")}건
          </span>
        }
        actions={
          <div className="flex items-center gap-1.5">
            <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => setLabelOpen(true)} disabled={loading || busy || awkwardCount === 0}>
              <Sparkles className="w-3.5 h-3.5" /> 표기 제안{awkwardCount ? ` ${awkwardCount.toLocaleString("ko-KR")}` : ""}
            </button>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={reload} disabled={loading || busy}>
              <RefreshCw className="w-3.5 h-3.5" /> 새로 고침
            </button>
          </div>
        }
        tabs={
          <CdTabs<TabKey>
            items={[
              { key: "list", label: "실적 목록", count: rows.length },
              { key: "manual", label: "계약 없는 실적", count: manuals.length },
              { key: "rules", label: "표시 범위" },
            ]}
            active={tab}
            onChange={setTab}
          />
        }
      />

      {error && <div className="cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm mb-3">{error}</div>}
      {notice && <div className="cd-card px-4 py-2 text-sm cd-text-muted mb-3" role="status">{notice}</div>}

      {tab === "list" ? (
        <section className="cd-card p-4">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <div className="flex items-center gap-1.5">
              <Search className="w-4 h-4 cd-text-faint" />
              <input
                className="cd-input"
                style={{ width: 240 }}
                placeholder="계약명·발주처·대외 표기·결정번호"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  resetPage();
                }}
              />
            </div>
            <select className="cd-select" style={{ width: "auto" }} value={category} onChange={(e) => { setCategory(e.target.value); resetPage(); }} aria-label="분류">
              <option value="">분류 전체</option>
              {CATALOG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="cd-select" style={{ width: "auto" }} value={year} onChange={(e) => { setYear(e.target.value); resetPage(); }} aria-label="수주 연도">
              <option value="">연도 전체</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className="cd-select" style={{ width: "auto" }} value={visibility} onChange={(e) => { setVisibility(e.target.value as VisibilityFilter); resetPage(); }} aria-label="노출 상태">
              <option value="">노출 전체</option>
              <option value="shown">부록에 표시</option>
              <option value="hidden">부록에서 숨김</option>
              <option value="unreviewed">미검토</option>
              <option value="featured">대표 실적</option>
              <option value="private">비공개 고객</option>
              <option value="grouped">묶음 행</option>
            </select>
            {(q || category || year || visibility) && (
              <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => { setQ(""); setCategory(""); setYear(""); setVisibility(""); resetPage(); }}>
                <X className="w-3.5 h-3.5" /> 초기화
              </button>
            )}
            <span className="ml-auto text-xs cd-text-faint">표시 {filtered.length.toLocaleString("ko-KR")} / 전체 {rows.length.toLocaleString("ko-KR")}</span>
          </div>

          {selected.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-3 text-xs">
              <span className="cd-text font-semibold">{selected.size}건 선택</span>
              <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy} onClick={() => bulk({ reviewed: true }, "검토 완료로 표시했습니다")}>검토 완료</button>
              <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy} onClick={() => bulk({ displayOverride: "always" }, "항상 표시로 바꿨습니다")}>항상 표시</button>
              <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy} onClick={() => bulk({ displayOverride: "never" }, "항상 숨김으로 바꿨습니다")}>항상 숨김</button>
              <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy} onClick={() => bulk({ displayOverride: "auto" }, "자동으로 되돌렸습니다")}>자동으로</button>
              <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy} onClick={() => setGroupPrompt("")}>묶음 지정</button>
              <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setSelected(new Set())}>선택 해제</button>
            </div>
          )}

          {loading ? (
            <p className="text-sm cd-text-faint py-6 text-center">불러오는 중…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm cd-text-faint py-6 text-center">{rows.length === 0 ? "등록된 계약이 없습니다." : "조건에 맞는 계약이 없습니다. 필터를 바꿔 보세요."}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="cd-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>
                        <input
                          type="checkbox"
                          aria-label="이 쪽 모두 선택"
                          checked={allOnPageSelected}
                          onChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              for (const r of selectablePageRows) {
                                if (allOnPageSelected) next.delete(r.contractId);
                                else next.add(r.contractId);
                              }
                              return next;
                            })
                          }
                        />
                      </th>
                      <th>연도</th>
                      <th>분류</th>
                      <th>대외 표기</th>
                      <th>업종</th>
                      <th>권역</th>
                      <th className="text-right">금액</th>
                      <th>상태</th>
                      <th>부록</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => {
                      const reason = reasonOf(r);
                      return (
                        <tr
                          key={r.contractId}
                          className="cursor-pointer"
                          tabIndex={0}
                          aria-label={`${effectiveTitle(r)} 대외 표기 편집`}
                          onClick={() => openEdit(r)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && e.target === e.currentTarget) openEdit(r);
                          }}
                        >
                          <td onClick={(e) => e.stopPropagation()}>
                            {r.source === "contract" && (
                              <input type="checkbox" aria-label={`${r.contractTitle} 선택`} checked={selected.has(r.contractId)} onChange={() => toggleSelect(r.contractId)} />
                            )}
                          </td>
                          <td className="tabular-nums">{r.year || "—"}</td>
                          <td className="cd-text-muted whitespace-nowrap">{r.category}</td>
                          <td className="cd-text" style={{ minWidth: 320 }}>
                            <span className="block">{effectiveTitle(r)}</span>
                            <span className="block text-[11px] cd-text-faint">
                              {r.meta?.displayTitle ? "직접 입력 · " : ""}
                              {r.source === "manual" ? "계약 없는 실적" : "계약명"} {r.contractTitle}
                              {r.meta?.groupKey ? ` · 묶음: ${r.meta.groupKey}` : ""}
                              {r.category === "통합환경허가" && projectSiteCount(r) > 1 ? ` · 사업장 ${projectSiteCount(r)}개소` : ""}
                            </span>
                          </td>
                          <td className="cd-text-muted whitespace-nowrap">{effectiveIndustry(r) || "—"}</td>
                          <td className="cd-text-muted whitespace-nowrap">{regionGroupLabel(r.regionGroup)}</td>
                          <td className="text-right tabular-nums whitespace-nowrap">{r.isUnitPrice && !r.amount ? <span className="cd-text-faint">단가</span> : formatAmountShort(r.amount)}</td>
                          <td className="whitespace-nowrap">
                            <span className={`cd-pill ${isCompleted(r) ? "cd-pill-success" : "cd-pill-idle"}`}>{isCompleted(r) ? "완료" : "수행 중"}</span>
                          </td>
                          <td className="whitespace-nowrap">
                            {reason ? (
                              <span className="cd-pill cd-pill-idle">숨김 · {HIDDEN_REASON_LABEL[reason]}</span>
                            ) : (
                              <span className="cd-pill cd-pill-info">표시{r.meta?.displayOverride === "always" ? " · 고정" : ""}</span>
                            )}
                            {r.meta?.isFeatured && <span className="cd-pill cd-pill-warn ml-1">대표</span>}
                            {r.meta && !r.meta.isPublic && <span className="cd-pill cd-pill-idle ml-1">비공개</span>}
                            {!r.meta?.reviewedAt && <span className="cd-pill cd-pill-warn ml-1">미검토</span>}
                            {r.source === "manual" && <span className="cd-pill cd-pill-idle ml-1">계약 없음</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-3">{pager}</div>
            </>
          )}
        </section>
      ) : tab === "manual" ? (
        <ManualProjectsPanel
          items={manuals}
          loading={loading}
          busy={busy}
          onAdd={() => setManualDraft({ ...emptyManualDraft })}
          onEdit={(m) => setManualDraft(manualToDraft(m))}
          onDelete={deleteManual}
        />
      ) : (
        <RulesPanel
          draft={draftRules}
          setDraft={setDraftRules}
          savedResult={savedResult}
          draftResult={draftResult}
          dirty={rulesDirty}
          busy={busy}
          onSave={saveRules}
          onReset={() => setDraftRules(DEFAULT_APPENDIX_RULES)}
          onRevert={() => setDraftRules(savedRules)}
        />
      )}

      <CdModal
        open={!!editing && !!draft}
        onClose={() => (busy ? undefined : (setEditing(null), setDraft(null)))}
        title={<span className="inline-flex items-center gap-1">대외 표기 편집<CdHelp topic="catalog.display-title" /></span>}
        size="lg"
        closeOnBackdrop={false}
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="cd-btn cd-btn-ghost" disabled={busy} onClick={() => { setEditing(null); setDraft(null); }}>취소</button>
            <button type="button" className="cd-btn cd-btn-soft" disabled={busy} onClick={() => submitEdit(false)}>저장</button>
            <button type="button" className="cd-btn cd-btn-primary" disabled={busy} onClick={() => submitEdit(true)}>
              <Save className="w-3.5 h-3.5" /> 검토 완료로 저장
            </button>
          </div>
        }
      >
        {editing && draft && (
          <div className="grid gap-3 text-sm">
            <div className="text-xs cd-text-faint">
              {editing.category} · {editing.year || "연도 미상"} · {periodLabel(editing) || "기간 미상"} · 계약명 {editing.contractTitle}
            </div>
            <label className="grid gap-1">
              <span className="text-xs cd-text-muted">대외 표기명</span>
              <textarea
                className="cd-input"
                rows={2}
                value={draft.displayTitle}
                placeholder={buildDisplayTitle({ ...editing, meta: editing.meta ? { ...editing.meta, isPublic: draft.isPublic } : null }, { anonymize: !draft.isPublic })}
                onChange={(e) => setDraft({ ...draft, displayTitle: e.target.value })}
              />
              <span className="text-[11px] cd-text-faint">비워 두면 회색 글씨의 자동 표기를 씁니다(계약·허가 정보가 바뀌면 자동으로 따라갑니다).</span>
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="grid gap-1">
                <span className="text-xs cd-text-muted">업종 표기</span>
                <input className="cd-input" value={draft.displayIndustry} placeholder={buildDisplayIndustry(editing) || "업종"} onChange={(e) => setDraft({ ...draft, displayIndustry: e.target.value })} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs cd-text-muted">부록 표시</span>
                <select className="cd-select" value={draft.displayOverride} onChange={(e) => setDraft({ ...draft, displayOverride: e.target.value as DisplayOverride })}>
                  {(Object.keys(OVERRIDE_LABEL) as DisplayOverride[]).map((k) => <option key={k} value={k}>{OVERRIDE_LABEL[k]}</option>)}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-xs cd-text-muted">묶음 행 이름(같은 이름끼리 한 줄)</span>
                <input className="cd-input" list="catalog-group-keys" value={draft.groupKey} placeholder="예: 비산배출시설 신고 및 정기점검 대행" onChange={(e) => setDraft({ ...draft, groupKey: e.target.value })} />
              </label>
              <label className="grid gap-1">
                <span className="text-xs cd-text-muted">메모(내부용)</span>
                <input className="cd-input" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
              </label>
              {editing.category === "통합환경허가" && (
                <label className="grid gap-1">
                  <span className="text-xs cd-text-muted">허가 사업장 수(여러 사업장이 묶인 용역은 2 이상, 최초허가 집계에서 뺄 계약은 0)</span>
                  <input
                    className="cd-input tabular-nums"
                    style={{ width: 120 }}
                    inputMode="numeric"
                    value={draft.siteCount}
                    placeholder={`${permitSiteCount(editing.permitNo)} (결정번호 기준)`}
                    onChange={(e) => setDraft({ ...draft, siteCount: e.target.value.replace(/[^\d]/g, "").slice(0, 2) })}
                  />
                </label>
              )}
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={draft.isFeatured} onChange={(e) => setDraft({ ...draft, isFeatured: e.target.checked })} />
                대표 실적(금액 기준과 무관하게 표시, 본편 사례 후보)
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={!draft.isPublic} onChange={(e) => setDraft({ ...draft, isPublic: !e.target.checked })} />
                비공개 고객(목록에 ○○사로 표기, 총괄 건수에는 포함)
              </label>
            </div>
          </div>
        )}
      </CdModal>
      <ManualProjectModal draft={manualDraft} setDraft={setManualDraft} busy={busy} onClose={() => setManualDraft(null)} onSave={saveManual} />
      <datalist id="catalog-group-keys">
        {groupKeys.map((k) => <option key={k} value={k} />)}
      </datalist>

      <CdModal
        open={groupPrompt != null}
        onClose={() => (busy ? undefined : setGroupPrompt(null))}
        title="묶음 지정"
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="cd-btn cd-btn-ghost" disabled={busy} onClick={() => setGroupPrompt(null)}>취소</button>
            <button
              type="button"
              className="cd-btn cd-btn-primary"
              disabled={busy}
              onClick={async () => {
                await bulk({ groupKey: groupPrompt ?? "" }, groupPrompt ? "묶음을 지정했습니다" : "묶음을 풀었습니다");
                setGroupPrompt(null);
              }}
            >
              적용
            </button>
          </div>
        }
      >
        <label className="grid gap-1 text-sm">
          <span className="text-xs cd-text-muted">선택한 {selected.size}건에 붙일 묶음 행 이름(비우면 묶음 해제)</span>
          <input className="cd-input" list="catalog-group-keys" value={groupPrompt ?? ""} onChange={(e) => setGroupPrompt(e.target.value)} placeholder="예: 비산배출시설 신고 및 정기점검 대행" />
          <span className="text-[11px] cd-text-faint">같은 분류·같은 수주 연도 안에서 이름이 같은 계약이 부록에서 한 줄로 합쳐지고, 고객사 이름이 나열됩니다.</span>
        </label>
      </CdModal>
      <CatalogLabelSuggest
        open={labelOpen}
        onClose={() => setLabelOpen(false)}
        onSaved={(next, count) => {
          setRows(next);
          setNotice(`대외 표기 ${count}건을 확정했습니다(검토 완료로 표시)`);
        }}
      />
    </div>
  );
}

function RulesPanel({
  draft,
  setDraft,
  savedResult,
  draftResult,
  dirty,
  busy,
  onSave,
  onReset,
  onRevert,
}: {
  draft: AppendixRules;
  setDraft: (r: AppendixRules) => void;
  savedResult: ReturnType<typeof applyAppendixRules>;
  draftResult: ReturnType<typeof applyAppendixRules>;
  dirty: boolean;
  busy: boolean;
  onSave: () => void;
  onReset: () => void;
  onRevert: () => void;
}) {
  const [previewCategory, setPreviewCategory] = useState<string>(CATALOG_CATEGORIES[0]);
  const section = draftResult.sections.find((s) => s.category === previewCategory);
  const set = (patch: Partial<AppendixRules>) => setDraft({ ...draft, ...patch });
  const arrow = (a: number, b: number) => (a === b ? a.toLocaleString("ko-KR") : `${a.toLocaleString("ko-KR")} → ${b.toLocaleString("ko-KR")}`);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3">
      <section className="cd-card p-4">
        <h3 className="cd-text font-semibold text-base flex items-center gap-1 mb-3">
          표시 범위(마스터본) <CdHelp topic="catalog.appendix-rules" />
        </h3>
        <div className="grid gap-4 text-sm">
          <div>
            <p className="text-xs cd-text-muted mb-2">분류별 금액 기준 — 이 금액 이하 계약은 부록 목록에서 뺍니다(0 = 전부 표시). 변경계약 반영 금액 기준.</p>
            <div className="grid gap-2">
              {CATALOG_CATEGORIES.map((c) => (
                <label key={c} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 cd-text">{c}</span>
                  <input
                    className="cd-input text-right tabular-nums"
                    style={{ width: 120 }}
                    inputMode="numeric"
                    value={Math.round((draft.minAmountByCategory[c] ?? 0) / 10_000).toLocaleString("ko-KR")}
                    onChange={(e) => {
                      const man = Number(e.target.value.replace(/[^\d]/g, "")) || 0;
                      set({ minAmountByCategory: { ...draft.minAmountByCategory, [c]: man * 10_000 } });
                    }}
                    aria-label={`${c} 금액 기준(만 원)`}
                  />
                  <span className="text-xs cd-text-faint">만 원 이하 미표시</span>
                </label>
              ))}
            </div>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-xs cd-text-muted mb-1">기간</legend>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="period" checked={draft.periodMode === "all"} onChange={() => set({ periodMode: "all" })} /> 전체
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="period" checked={draft.periodMode === "from"} onChange={() => set({ periodMode: "from" })} />
              <input className="cd-input tabular-nums" style={{ width: 80 }} value={draft.fromYear} onChange={(e) => set({ fromYear: Number(e.target.value.replace(/[^\d]/g, "")) || draft.fromYear, periodMode: "from" })} aria-label="시작 연도" />
              년부터
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="period" checked={draft.periodMode === "recent"} onChange={() => set({ periodMode: "recent" })} />
              최근
              <input className="cd-input tabular-nums" style={{ width: 60 }} value={draft.recentYears} onChange={(e) => set({ recentYears: Number(e.target.value.replace(/[^\d]/g, "")) || draft.recentYears, periodMode: "recent" })} aria-label="최근 연수" />
              년
            </label>
          </fieldset>
          <div className="grid gap-2">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={draft.includeOngoing} onChange={(e) => set({ includeOngoing: e.target.checked })} /> 수행 중 계약 포함("수행 중" 표기)
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={draft.includeNoAmount} onChange={(e) => set({ includeNoAmount: e.target.checked })} /> 금액 미정 계약(단가 계약 등) 표시
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={draft.showHiddenSummary} onChange={(e) => set({ showHiddenSummary: e.target.checked })} /> 숨긴 실적을 "그 외 ○건" 한 줄로 표시
            </label>
          </div>
          <fieldset className="grid gap-2">
            <legend className="text-xs cd-text-muted mb-1">총괄표·본편 숫자 집계</legend>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="basis" checked={draft.summaryBasis === "all"} onChange={() => set({ summaryBasis: "all" })} /> 전체 실적(표시 범위와 무관)
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="basis" checked={draft.summaryBasis === "shown"} onChange={() => set({ summaryBasis: "shown" })} /> 부록에 표시된 실적만
            </label>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="text-xs cd-text-muted mb-1">묶음 행 금액 기준</legend>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="groupBasis" checked={draft.groupAmountBasis === "item"} onChange={() => set({ groupAmountBasis: "item" })} /> 계약별로 거른 뒤 묶기
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="radio" name="groupBasis" checked={draft.groupAmountBasis === "group"} onChange={() => set({ groupAmountBasis: "group" })} /> 묶은 뒤 합계로 거르기
            </label>
          </fieldset>
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" className="cd-btn cd-btn-primary" disabled={busy || !dirty} onClick={onSave}>
              <Save className="w-3.5 h-3.5" /> 표시 범위 저장
            </button>
            <button type="button" className="cd-btn cd-btn-ghost" disabled={busy || !dirty} onClick={onRevert}>되돌리기</button>
            <button type="button" className="cd-btn cd-btn-ghost" disabled={busy} onClick={onReset}>
              <RotateCcw className="w-3.5 h-3.5" /> 기본값으로
            </button>
            {dirty && <span className="text-xs cd-text-muted">저장하지 않은 변경이 있습니다.</span>}
          </div>
        </div>
      </section>

      <section className="cd-card p-4">
        <h3 className="cd-text font-semibold text-base mb-2">미리보기</h3>
        <p className="text-sm cd-text mb-3 tabular-nums">
          부록 행 <b>{arrow(savedResult.shownRows, draftResult.shownRows)}</b> · 표시 계약 {arrow(savedResult.shownContracts, draftResult.shownContracts)} · 예상{" "}
          <b>{arrow(savedResult.estimatedPages, draftResult.estimatedPages)}쪽</b>
          {dirty && <span className="text-xs cd-text-faint ml-1">(저장된 값 → 지금 설정)</span>}
        </p>
        <div className="overflow-x-auto mb-3">
          <table className="cd-table">
            <thead>
              <tr>
                <th>분류</th>
                <th className="text-right">표시 행</th>
                <th className="text-right">표시 계약</th>
                <th className="text-right">숨김</th>
              </tr>
            </thead>
            <tbody>
              {draftResult.sections.map((s) => {
                const before = savedResult.sections.find((x) => x.category === s.category);
                return (
                  <tr key={s.category}>
                    <td className="cd-text">{s.category}</td>
                    <td className="text-right tabular-nums">{arrow(before?.shownRows ?? 0, s.shownRows)}</td>
                    <td className="text-right tabular-nums">{arrow(before?.shownContracts ?? 0, s.shownContracts)}</td>
                    <td className="text-right tabular-nums">{arrow(before?.hiddenContracts ?? 0, s.hiddenContracts)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs cd-text-faint mb-3">
          숨김 사유:{" "}
          {(Object.keys(draftResult.hiddenByReason) as HiddenReason[])
            .filter((k) => draftResult.hiddenByReason[k] > 0)
            .map((k) => `${HIDDEN_REASON_LABEL[k]} ${draftResult.hiddenByReason[k]}`)
            .join(" · ") || "없음"}
        </p>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs cd-text-muted">부록 목록 보기</span>
          <select className="cd-select" style={{ width: "auto" }} value={previewCategory} onChange={(e) => setPreviewCategory(e.target.value)} aria-label="미리볼 분류">
            {CATALOG_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="overflow-auto rounded-lg border cd-border-c" style={{ maxHeight: 420 }}>
          {!section || section.years.length === 0 ? (
            <p className="text-sm cd-text-faint p-4">이 분류의 실적이 없습니다.</p>
          ) : (
            section.years.map((y) => (
              <div key={y.year} className="px-3 py-2 border-b cd-border-c last:border-b-0">
                <p className="text-xs font-semibold cd-text mb-1">{y.year}</p>
                {y.rows.map((r) => (
                  <p key={r.key} className="text-xs cd-text-muted py-0.5">
                    {r.title}
                    {r.detail && <span className="cd-text-faint"> — {r.detail}</span>}
                    <span className="cd-text-faint"> · {r.period || "기간 미상"}{r.status === "ongoing" && !r.title.endsWith("수행 중") ? " · 수행 중" : ""}</span>
                  </p>
                ))}
                {y.hiddenSummary && <p className="text-xs cd-text-faint py-0.5">{y.hiddenSummary}</p>}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
