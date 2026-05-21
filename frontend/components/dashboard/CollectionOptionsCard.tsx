"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  SlidersHorizontal,
  CalendarRange,
  Filter,
  FileSearch,
  ScanLine,
  Plus,
  Pencil,
  Play,
  Save,
  RotateCcw,
  RefreshCw,
} from "lucide-react";
import {
  DEFAULT_COLLECTION_CONFIG,
  BUILTIN_RULES,
  mergeRulesWithBuiltin,
  withDefaultsApplied,
} from "@/lib/ieps/defaults";
import type {
  CollectionConfig,
  ExtractionRange,
  ExtractionRule,
  Locator,
  ResultType,
} from "@/lib/ieps/types";
import { RuleEditModal } from "./RuleEditModal";
import { useToast } from "@/components/ui/Toast";

const RANGE_PRESETS: { id: string; label: string }[] = [
  { id: "1m", label: "1개월" },
  { id: "3m", label: "3개월" },
  { id: "6m", label: "6개월" },
  { id: "1y", label: "1년" },
  { id: "2y", label: "2년" },
  { id: "all", label: "전체" },
];

const FILTER_OPTIONS: { id: string; label: string }[] = [
  { id: "integratedFirst", label: "통합허가" },
  { id: "integratedChange", label: "변경허가" },
  { id: "annualReport", label: "연간보고서" },
  { id: "all", label: "전체" },
];

/** "X 파싱" 버튼 → cli --parse-only=<category> 카테고리 어휘. /api/parse/start 와 1:1. */
export type ParseCategoryId = "integratedFirst" | "integratedChange" | "annualReport";

interface Props {
  initialConfig?: CollectionConfig;
  /**
   * "수집 시작" 버튼 — 이제 스크래핑 + PDF 다운로드까지만 수행한다.
   * (OCR/사업장 적재는 `onParseCategory` 가 카테고리별로 담당)
   */
  onCollect: (config: CollectionConfig) => void;
  /**
   * 카테고리별 파싱 트리거. raw/ 아래 PDF 중 해당 카테고리만 새 룰로 파싱+적재.
   * 룰을 수정한 뒤 기존 결과를 갱신할 때, 또는 이전에 다운로드만 끝난 PDF 를 처리할 때 사용.
   * 현재 카드의 config(특히 extractionRange / extractionRules)를 그대로 전달한다.
   */
  onParseCategory?: (config: CollectionConfig, category: ParseCategoryId) => void;
  /** 저장된 CollectionConfig 목록(드롭다운). */
  savedConfigs: { id: number; name: string }[];
  onSaveCurrent: (config: CollectionConfig, name: string) => Promise<void>;
  onLoadConfig: (id: number) => Promise<CollectionConfig | null>;
  isCollecting?: boolean;
  /** 현재 파싱 중인 카테고리 (있으면). 동시에 한 카테고리만 실행 가능. */
  parsingCategory?: ParseCategoryId | null;
  /** false 이면 수집/저장/룰 편집 버튼을 비활성화 (viewer 권한). 기본 true. */
  canEdit?: boolean;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

export function CollectionOptionsCard({
  initialConfig,
  onCollect,
  onParseCategory,
  savedConfigs,
  onSaveCurrent,
  onLoadConfig,
  isCollecting,
  parsingCategory,
  canEdit = true,
}: Props) {
  const isParsingAny = !!parsingCategory;
  const [config, setConfig] = useState<CollectionConfig>(
    withDefaultsApplied(clone(initialConfig ?? DEFAULT_COLLECTION_CONFIG))
  );
  const [editingRule, setEditingRule] = useState<ExtractionRule | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedConfigId, setSelectedConfigId] = useState<number | null>(null);
  const [saveName, setSaveName] = useState<string>("");
  // 부모(StatusPage)가 비동기로 마지막 저장 옵션을 fetch 해 initialConfig 를 갱신하면
  // 카드는 그 시점에 한 번 동기화한다. 그 외 사용자 편집 중에는 prop 변동이 없도록
  // 부모 단에서 한 번만 set 하므로 무한 루프가 발생하지 않는다.
  const initialJsonRef = useRef<string>(JSON.stringify(initialConfig ?? null));
  useEffect(() => {
    if (!initialConfig) return;
    const next = JSON.stringify(initialConfig);
    if (next !== initialJsonRef.current) {
      initialJsonRef.current = next;
      setConfig(withDefaultsApplied(clone(initialConfig)));
    }
  }, [initialConfig]);
  const toast = useToast();

  const rules = useMemo(() => mergeRulesWithBuiltin(config.extractionRules), [config.extractionRules]);
  const activeIds = config.activeRuleIds ?? rules.map((r) => r.id);

  // ─── 수집 범위 ───
  const setPreset = (preset: string) => {
    setConfig((prev) => ({
      ...prev,
      collectionRange: { mode: "preset", preset, startDate: null, endDate: null },
    }));
  };
  const setCustomDate = (key: "startDate" | "endDate", value: string) => {
    setConfig((prev) => ({
      ...prev,
      collectionRange: {
        mode: "custom",
        preset: null,
        startDate: prev.collectionRange?.startDate ?? null,
        endDate: prev.collectionRange?.endDate ?? null,
        [key]: value || null,
      },
    }));
  };

  // ─── 필터 ───
  const toggleFilter = (id: string) => {
    setConfig((prev) => {
      const current = prev.filters ?? [];
      let next: string[];
      if (id === "all") {
        next = ["all"];
      } else {
        const without = current.filter((f) => f !== "all");
        if (without.includes(id)) {
          next = without.filter((f) => f !== id);
        } else {
          next = [...without, id];
        }
        if (next.length === 0) next = ["all"];
      }
      return { ...prev, filters: next };
    });
  };

  // ─── 추출 범위 ───
  // 검토결과서(통합·변경허가)와 연간보고서가 서로 다른 범위를 가질 수 있도록 두 슬롯을 공통 setter로 갱신.
  type RangeKey = "extractionRange" | "annualReportExtractionRange";
  const setRangeMode = (key: RangeKey, mode: "partial" | "full") => {
    setConfig((prev) => {
      const current: ExtractionRange =
        (prev[key] as ExtractionRange | undefined) ??
        (DEFAULT_COLLECTION_CONFIG[key] as ExtractionRange);
      return { ...prev, [key]: { ...current, mode } };
    });
  };
  const setRangePage = (key: RangeKey, field: "startPage" | "endPage", value: number) => {
    setConfig((prev) => {
      const current: ExtractionRange =
        (prev[key] as ExtractionRange | undefined) ??
        (DEFAULT_COLLECTION_CONFIG[key] as ExtractionRange);
      return { ...prev, [key]: { ...current, [field]: value } };
    });
  };

  const reviewRange: ExtractionRange =
    config.extractionRange ?? (DEFAULT_COLLECTION_CONFIG.extractionRange as ExtractionRange);
  const annualRange: ExtractionRange =
    config.annualReportExtractionRange ??
    (DEFAULT_COLLECTION_CONFIG.annualReportExtractionRange as ExtractionRange);

  // 사용자가 선택한 수집 필터에 따라 어떤 범위 카드를 강조/dim 할지 결정.
  // - "all" 포함 또는 미선택 → 양쪽 모두 활성
  // - integratedFirst/integratedChange 만 → 검토결과서만 활성
  // - annualReport 만 → 연간보고서만 활성
  const activeFilters = config.filters ?? [];
  const filterIncludesAll = activeFilters.length === 0 || activeFilters.includes("all");
  const reviewActive =
    filterIncludesAll ||
    activeFilters.includes("integratedFirst") ||
    activeFilters.includes("integratedChange");
  const annualActive = filterIncludesAll || activeFilters.includes("annualReport");

  // ─── 룰 ───
  const toggleRule = (id: string) => {
    setConfig((prev) => {
      const cur = prev.activeRuleIds ?? rules.map((r) => r.id);
      const next = cur.includes(id) ? cur.filter((r) => r !== id) : [...cur, id];
      return { ...prev, activeRuleIds: next };
    });
  };

  const openAddRule = () => {
    setEditingRule(null);
    setModalOpen(true);
  };
  const openEditRule = (rule: ExtractionRule) => {
    setEditingRule(rule);
    setModalOpen(true);
  };

  const handleSaveRule = (next: ExtractionRule) => {
    setConfig((prev) => {
      const idx = prev.extractionRules.findIndex((r) => r.id === next.id);
      let updated: ExtractionRule[];
      if (idx >= 0) {
        updated = [...prev.extractionRules];
        updated[idx] = next;
      } else {
        updated = [...prev.extractionRules, next];
      }
      // active list 갱신
      const active = prev.activeRuleIds ?? updated.map((r) => r.id);
      const nextActive = active.includes(next.id) ? active : [...active, next.id];
      return { ...prev, extractionRules: updated, activeRuleIds: nextActive };
    });
    toast.show(editingRule ? "항목이 수정되었습니다." : "새 항목이 추가되었습니다.");
    setModalOpen(false);
  };

  const handleDeleteRule = (id: string) => {
    const builtin = BUILTIN_RULES.find((r) => r.id === id);
    if (builtin) {
      toast.show("기본 항목은 삭제할 수 없습니다.", "error");
      return;
    }
    setConfig((prev) => ({
      ...prev,
      extractionRules: prev.extractionRules.filter((r) => r.id !== id),
      activeRuleIds: (prev.activeRuleIds ?? []).filter((rid) => rid !== id),
    }));
    toast.show("항목이 삭제되었습니다.");
    setModalOpen(false);
  };

  const handleReset = () => {
    setConfig(clone(DEFAULT_COLLECTION_CONFIG));
    setSelectedConfigId(null);
    toast.show("기본값으로 초기화했습니다.");
  };

  const handleSave = async () => {
    const name = saveName.trim() || `수집 옵션 ${new Date().toISOString().slice(0, 10)}`;
    try {
      await onSaveCurrent(config, name);
      toast.show("수집 옵션이 저장되었습니다.");
      setSaveName("");
    } catch (err) {
      toast.show(`저장 실패: ${(err as Error).message}`, "error");
    }
  };

  const handleLoad = async (id: number) => {
    setSelectedConfigId(id);
    if (!id) return;
    try {
      const loaded = await onLoadConfig(id);
      if (loaded) {
        setConfig(clone(loaded));
        toast.show("저장된 옵션을 불러왔습니다.");
      }
    } catch (err) {
      toast.show(`로드 실패: ${(err as Error).message}`, "error");
    }
  };

  return (
    <section className="glass-panel p-6 rounded-3xl flex flex-col gap-4 reveal delay-3">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-stone-700 flex items-center gap-2">
          <SlidersHorizontal className="w-5 h-5 text-primary" />
          수집 옵션
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="glass-button rounded-xl px-3 py-1.5 text-xs font-bold text-stone-700 flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            초기화
          </button>
        </div>
      </div>

      {savedConfigs.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            className="ui-select text-xs flex-1"
            value={selectedConfigId ?? ""}
            onChange={(e) => handleLoad(Number(e.target.value))}
          >
            <option value="">저장된 옵션 불러오기…</option>
            {savedConfigs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 1. 수집 범위 */}
      <div className="bg-white/40 border border-white/60 rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <CalendarRange className="w-4 h-4 text-stone-500" />
          <span className="text-xs font-bold text-stone-700">수집 범위</span>
          <span className="text-[10px] text-stone-400 font-medium ml-auto">게재일 기준</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {RANGE_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="ui-chip"
              data-active={
                config.collectionRange?.mode === "preset" &&
                config.collectionRange.preset === p.id
                  ? "true"
                  : "false"
              }
              onClick={() => setPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="input-field flex-1"
            value={config.collectionRange?.startDate ?? ""}
            onChange={(e) => setCustomDate("startDate", e.target.value)}
          />
          <span className="text-stone-400 text-xs">~</span>
          <input
            type="date"
            className="input-field flex-1"
            value={config.collectionRange?.endDate ?? ""}
            onChange={(e) => setCustomDate("endDate", e.target.value)}
          />
        </div>
      </div>

      {/* 2. 필터 */}
      <div className="bg-white/40 border border-white/60 rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-stone-500" />
          <span className="text-xs font-bold text-stone-700">수집 필터</span>
          <span className="text-[10px] text-stone-400 font-medium ml-auto">다중 선택</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="ui-chip"
              data-active={(config.filters ?? []).includes(f.id) ? "true" : "false"}
              onClick={() => toggleFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3. 추출 범위 — 검토결과서 / 연간보고서 두 종류는 PDF 구조가 달라 범위를 분리한다.
          (통합허가·변경허가는 같은 검토결과서 형식이므로 한 범위 공유) */}
      <div className="grid grid-cols-2 gap-3">
        <ExtractionRangeCard
          title="검토결과서 추출 범위"
          subtitle="통합허가 · 변경허가"
          active={reviewActive}
          range={reviewRange}
          onChangeMode={(m) => setRangeMode("extractionRange", m)}
          onChangePage={(f, v) => setRangePage("extractionRange", f, v)}
          defaultEnd={15}
        />

        <ExtractionRangeCard
          title="연간보고서 추출 범위"
          subtitle="연간(점검)보고서"
          active={annualActive}
          range={annualRange}
          onChangeMode={(m) => setRangeMode("annualReportExtractionRange", m)}
          onChangePage={(f, v) => setRangePage("annualReportExtractionRange", f, v)}
          defaultEnd={2}
        />
      </div>

      {/* 4. 추출 설정 */}
      <div className="bg-white/40 border border-white/60 rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <ScanLine className="w-4 h-4 text-stone-500" />
          <span className="text-xs font-bold text-stone-700">추출 설정</span>
          <span className="text-[10px] text-stone-400 font-medium ml-auto">
            활성 {activeIds.length} / {rules.length}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {rules.map((rule) => {
            const isActive = activeIds.includes(rule.id);
            return (
              <button
                key={rule.id}
                type="button"
                className="rule-chip"
                data-active={isActive ? "true" : "false"}
                onClick={(e) => {
                  // 편집 아이콘 영역이면 편집 모달 띄우고 토글하지 않음
                  if ((e.target as HTMLElement).closest("[data-role='edit']")) {
                    openEditRule(rule);
                  } else {
                    toggleRule(rule.id);
                  }
                }}
              >
                <span>{rule.label}</span>
                <span
                  className="edit-btn"
                  data-role="edit"
                  title="편집"
                >
                  <Pencil className="w-3 h-3" />
                </span>
              </button>
            );
          })}
          <button type="button" className="rule-add-btn" onClick={openAddRule}>
            <Plus className="w-3.5 h-3.5" />
            추가
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <input
          type="text"
          className="input-field flex-1"
          placeholder="저장 이름 (선택) — 비우면 오늘 날짜 사용"
          value={saveName}
          onChange={(e) => setSaveName(e.target.value)}
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={!canEdit}
          title={!canEdit ? "조회자 권한은 옵션을 저장할 수 없습니다." : undefined}
          className="rounded-xl px-3 py-2 text-xs font-bold bg-white/70 text-stone-700 border border-white/70 hover:bg-white shadow-sm flex items-center gap-1 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="w-3.5 h-3.5" />
          옵션 저장
        </button>
        <button
          type="button"
          disabled={!!isCollecting || isParsingAny || !canEdit}
          onClick={() => onCollect(config)}
          title={
            !canEdit
              ? "조회자 권한은 수집을 트리거할 수 없습니다."
              : "게시판 목록 스크래핑 + PDF 다운로드까지만 수행합니다. (OCR/사업장 적재는 아래 카테고리별 파싱 버튼)"
          }
          className="rounded-xl px-4 py-2 text-xs font-bold text-white bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm flex items-center gap-1 shrink-0"
        >
          <Play className="w-3.5 h-3.5" />
          {isCollecting ? "수집 중…" : "수집 시작"}
        </button>
      </div>

      {/* 카테고리별 파싱 — 스크래핑/다운로드 없이 raw/ 아래 PDF 중 해당 카테고리만 새 룰로 파싱+적재.
          통합허가/변경허가/연간보고서로 분리해 한 카테고리만 룰을 갱신해도 다른 카테고리에
          영향을 주지 않으며, 잡 단위가 작아져 재파싱 진행 상황 추적도 쉬워진다. */}
      {onParseCategory && (
        <div className="grid grid-cols-3 gap-2">
          <ParseCategoryButton
            category="integratedFirst"
            label="통합허가 파싱"
            disabled={!!isCollecting || isParsingAny || !canEdit}
            running={parsingCategory === "integratedFirst"}
            canEdit={canEdit}
            onClick={() => onParseCategory(config, "integratedFirst")}
          />
          <ParseCategoryButton
            category="integratedChange"
            label="변경허가 파싱"
            disabled={!!isCollecting || isParsingAny || !canEdit}
            running={parsingCategory === "integratedChange"}
            canEdit={canEdit}
            onClick={() => onParseCategory(config, "integratedChange")}
          />
          <ParseCategoryButton
            category="annualReport"
            label="연간보고서 파싱"
            disabled={!!isCollecting || isParsingAny || !canEdit}
            running={parsingCategory === "annualReport"}
            canEdit={canEdit}
            onClick={() => onParseCategory(config, "annualReport")}
          />
        </div>
      )}

      {modalOpen && (
        <RuleEditModal
          rule={editingRule}
          extractionRange={reviewRange}
          onSave={handleSaveRule}
          onDelete={handleDeleteRule}
          onClose={() => setModalOpen(false)}
        />
      )}
    </section>
  );
}

interface ParseCategoryButtonProps {
  category: ParseCategoryId;
  label: string;
  disabled: boolean;
  running: boolean;
  canEdit: boolean;
  onClick: () => void;
}

/**
 * 카테고리별 파싱 트리거 버튼. 동일한 시각 위계의 secondary 액션으로 3개를 가로 배치.
 * 어떤 카테고리가 실행 중인지 한눈에 보이도록 `running` 일 때만 액센트 컬러로 강조한다.
 */
function ParseCategoryButton({
  category,
  label,
  disabled,
  running,
  canEdit,
  onClick,
}: ParseCategoryButtonProps) {
  const tooltip = !canEdit
    ? "조회자 권한은 파싱을 트리거할 수 없습니다."
    : `raw/ 아래 ${label.replace(" 파싱", "")} 카테고리 PDF 만 새 룰로 다시 파싱하고 사업장 DB를 갱신합니다.`;
  return (
    <button
      type="button"
      data-category={category}
      disabled={disabled}
      onClick={onClick}
      title={tooltip}
      className={
        "rounded-xl px-3 py-2 text-[11px] font-bold border shadow-sm flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed " +
        (running
          ? "bg-primary/10 border-primary/40 text-primary"
          : "bg-white/70 border-white/70 text-stone-700 hover:bg-white")
      }
    >
      <RefreshCw className={"w-3 h-3 " + (running ? "animate-spin" : "")} />
      {running ? `${label.replace(" 파싱", "")} 파싱 중…` : label}
    </button>
  );
}

interface ExtractionRangeCardProps {
  title: string;
  subtitle: string;
  active: boolean;
  range: ExtractionRange;
  onChangeMode: (mode: "partial" | "full") => void;
  onChangePage: (field: "startPage" | "endPage", value: number) => void;
  /** "일부" 모드에서 endPage 가 비어 있을 때 표시할 디폴트(검토결과서=15, 연간=2). */
  defaultEnd: number;
}

/**
 * 추출 범위 카드 1단위. 검토결과서/연간보고서 카드를 동일 컴포넌트로 렌더링하되,
 * `active=false` 인 경우 (수집 필터에 해당 종류가 없을 때) 시각적으로 dim 처리하고
 * 입력을 잠그지는 않는다 — 사용자가 필터를 다시 켜면 그 값이 바로 적용되도록 보존.
 */
function ExtractionRangeCard({
  title,
  subtitle,
  active,
  range,
  onChangeMode,
  onChangePage,
  defaultEnd,
}: ExtractionRangeCardProps) {
  return (
    <div
      className={
        "bg-white/40 border border-white/60 rounded-2xl p-4 flex flex-col gap-3 transition-opacity " +
        (active ? "" : "opacity-50")
      }
      title={
        active
          ? undefined
          : "현재 수집 필터에 해당 문서 종류가 포함되어 있지 않아 적용되지 않습니다."
      }
    >
      <div className="flex items-center gap-2">
        <FileSearch className="w-4 h-4 text-stone-500" />
        <span className="text-xs font-bold text-stone-700">{title}</span>
        <span className="text-[10px] text-stone-400 font-medium ml-auto">{subtitle}</span>
      </div>
      <div className="range-toggle">
        <button
          type="button"
          data-active={range.mode === "partial" ? "true" : "false"}
          onClick={() => onChangeMode("partial")}
        >
          일부
        </button>
        <button
          type="button"
          data-active={range.mode === "full" ? "true" : "false"}
          onClick={() => onChangeMode("full")}
        >
          전체
        </button>
      </div>
      {range.mode === "partial" ? (
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            className="input-field w-20 text-center"
            value={range.startPage ?? 1}
            onChange={(e) =>
              onChangePage("startPage", Math.max(1, Number(e.target.value) || 1))
            }
          />
          <span className="text-stone-400 text-xs">~</span>
          <input
            type="number"
            min={1}
            className="input-field w-20 text-center"
            value={range.endPage ?? defaultEnd}
            onChange={(e) =>
              onChangePage("endPage", Math.max(1, Number(e.target.value) || 1))
            }
          />
          <span className="text-[10px] text-stone-400 font-medium">p</span>
        </div>
      ) : (
        <div className="text-[11px] text-stone-500 font-medium">전체 페이지에서 추출</div>
      )}
    </div>
  );
}
