"use client";

// 정기 발행본 분류 — 관심 서비스 태그 → 통합허가 업종 → 사업장(마스터·관심 기업·미등록 기업) → 발간 보고서.
// 사업장 마스터에 없는 기업은 '마스터 미등록'으로 표시하고 수동 등록 화면으로 안내한다.

import { useMemo, useState } from "react";
import { Building2, ChevronDown, ChevronRight, FileText, Plus, Search } from "lucide-react";
import type { BriefingTreeEntity, BriefingTreeIndustry, BriefingTreeReport } from "@/lib/intel/briefing-tree";
import { INTEL_INTEREST_SERVICES, INTEL_SERVICE_LABELS } from "./intelligence-client";
import { IntelChips, IntelEmpty } from "./intel-ui-kit";

const TYPE_LABEL: Record<string, string> = { investment: "투자계획", expansion: "증설", new_site: "신설", other: "기타" };
const TYPE_ORDER = ["investment", "expansion", "new_site", "other"];
type ServiceKey = "" | (typeof INTEL_INTEREST_SERVICES)[number];

/** 보고서 노드 글자 — '(발간일) 투자계획·증설·신설'. 세 유형이 없을 때만 '기타'로 적는다. */
export function reportNodeText(report: BriefingTreeReport): string {
  const types = TYPE_ORDER.filter((type) => type !== "other" && report.types.includes(type)).map((type) => TYPE_LABEL[type]);
  return `(${report.date}) ${types.length ? types.join("·") : report.types.includes("other") ? TYPE_LABEL.other : "정보 유형 미확인"}`;
}

export function BriefingTree({ industries, loading, selectedRunId, onSelect }: {
  industries: BriefingTreeIndustry[];
  loading: boolean;
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}) {
  const [service, setService] = useState<ServiceKey>("");
  const [query, setQuery] = useState("");
  const [onlyWithReports, setOnlyWithReports] = useState(true);
  const [openIndustries, setOpenIndustries] = useState<Set<string>>(new Set());
  const [openEntities, setOpenEntities] = useState<Set<string>>(new Set());

  /** 서비스 태그·검색어·'보고서 있는 곳만'을 적용한 트리. */
  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    return industries.map((industry) => {
      const entities = industry.entities
        .map((entity) => ({ ...entity, reports: service ? entity.reports.filter((report) => report.services.includes(service)) : entity.reports }))
        .filter((entity) => {
          if (onlyWithReports && !entity.reports.length && entity.kind !== "interest") return false;
          if (service && !entity.reports.length) return false;
          if (!q) return true;
          return [entity.name, entity.detail ?? "", industry.label, ...entity.reports.map((report) => report.profileName)].some((text) => text.toLowerCase().includes(q));
        });
      const reportCount = new Set(entities.flatMap((entity) => entity.reports.map((report) => report.briefingId))).size;
      return { ...industry, entities, reportCount };
    }).filter((industry) => industry.entities.length);
  }, [industries, service, query, onlyWithReports]);

  const unregisteredInterest = useMemo(() => {
    const names = new Set<string>();
    industries.forEach((industry) => industry.entities.forEach((entity) => { if (entity.kind === "interest") names.add(entity.name); }));
    return names.size;
  }, [industries]);

  const searching = query.trim().length > 0;
  const toggle = (set: Set<string>, key: string, apply: (next: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    apply(next);
  };

  return (
    <div className="flex flex-col gap-2 min-w-0">
      <IntelChips active={service} onChange={setService} items={[
        { key: "" as ServiceKey, label: "전체 서비스" },
        ...INTEL_INTEREST_SERVICES.map((code) => ({ key: code as ServiceKey, label: INTEL_SERVICE_LABELS[code] })),
      ]} />
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 rounded-xl border cd-border-c px-2 py-1 flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 cd-text-faint shrink-0" />
          <input className="bg-transparent outline-none cd-text text-sm w-full" aria-label="업종·사업장·관심 분야 검색" placeholder="업종·사업장·관심 분야 검색" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <label className="flex items-center gap-1.5 cd-text-muted text-xs cursor-pointer select-none">
          <input type="checkbox" checked={onlyWithReports} onChange={(event) => setOnlyWithReports(event.target.checked)} />
          보고서 있는 사업장만
        </label>
      </div>
      {unregisteredInterest > 0 && (
        <p className="cd-text-muted text-[11px]">사업장 마스터에 없는 관심 기업 {unregisteredInterest}곳 — 노드의 <span className="font-bold">사업장 등록</span>으로 마스터에 올리면 사업장 정보·수집 신호와 연결됩니다.</p>
      )}

      {view.length ? (
        <div role="tree" aria-label="업종별 발행 보고서" className="flex flex-col overflow-y-auto pr-0.5" style={{ maxHeight: "calc(100vh - 340px)" }}>
          {view.map((industry) => {
            const open = searching || openIndustries.has(industry.id);
            return (
              <div key={industry.id} role="treeitem" aria-expanded={open} className="border-b cd-border-c last:border-b-0">
                <button type="button" className="w-full flex items-center gap-1.5 py-2 px-1 cd-row-hover rounded-lg text-left" onClick={() => toggle(openIndustries, industry.id, setOpenIndustries)}>
                  {open ? <ChevronDown className="w-3.5 h-3.5 cd-text-faint" /> : <ChevronRight className="w-3.5 h-3.5 cd-text-faint" />}
                  <span className="cd-text text-sm font-extrabold">{industry.label}</span>
                  <span className="cd-text-faint text-[11px]">사업장 {industry.entities.length}</span>
                  {industry.reportCount > 0 && <span className="cd-pill cd-pill-info ml-auto">보고서 {industry.reportCount}</span>}
                </button>
                {open && (
                  <div role="group" className="flex flex-col pl-5 pb-1.5">
                    {industry.entities.map((entity) => (
                      <EntityNode
                        key={`${industry.id}:${entity.key}`}
                        entity={entity}
                        open={searching && entity.reports.length > 0 && entity.reports.length <= 3 ? !openEntities.has(`${industry.id}:${entity.key}`) : openEntities.has(`${industry.id}:${entity.key}`)}
                        onToggle={() => toggle(openEntities, `${industry.id}:${entity.key}`, setOpenEntities)}
                        selectedRunId={selectedRunId}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <IntelEmpty>{loading ? "분류를 불러오는 중…" : searching || service ? "조건에 맞는 보고서가 없습니다." : "사업장과 연결된 발행 보고서가 없습니다. 최근 순 보기에서 전체 이력을 확인하세요."}</IntelEmpty>
      )}
    </div>
  );
}

function EntityNode({ entity, open, onToggle, selectedRunId, onSelect }: {
  entity: BriefingTreeEntity; open: boolean; onToggle: () => void; selectedRunId: string | null; onSelect: (runId: string) => void;
}) {
  const unregistered = entity.kind !== "facility";
  return (
    <div role="treeitem" aria-expanded={entity.reports.length ? open : undefined}>
      <div className="flex items-center gap-1.5 py-1.5 px-1 rounded-lg cd-row-hover min-w-0">
        <button type="button" className="flex items-center gap-1.5 min-w-0 flex-1 text-left disabled:cursor-default" disabled={!entity.reports.length} onClick={onToggle}>
          {entity.reports.length ? (open ? <ChevronDown className="w-3.5 h-3.5 cd-text-faint shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 cd-text-faint shrink-0" />) : <span className="w-3.5 shrink-0" />}
          <Building2 className="w-3.5 h-3.5 cd-text-faint shrink-0" />
          <span className="cd-text text-[13px] font-bold truncate">{entity.name}</span>
          {entity.detail && <span className="cd-text-faint text-[11px] truncate">{entity.detail}</span>}
          {unregistered && <span className="cd-pill cd-pill-warn shrink-0">마스터 미등록</span>}
        </button>
        {unregistered && (
          <a className="cd-btn cd-btn-ghost cd-btn-sm shrink-0" href={`/facilities/new?companyName=${encodeURIComponent(entity.name)}`} target="_blank" rel="noopener noreferrer" title="사업장 마스터에 수동 등록">
            <Plus className="w-3 h-3" />사업장 등록
          </a>
        )}
        <span className={`shrink-0 text-xs font-extrabold tabular-nums ${entity.reports.length ? "cd-text" : "cd-text-faint"}`} title="이 사업장을 다룬 발행 보고서 수">{entity.reports.length}건</span>
      </div>
      {open && entity.reports.length > 0 && (
        <div role="group" className="flex flex-col pl-7 pb-1">
          {entity.reports.map((report) => (
            <button
              key={report.briefingId}
              type="button"
              role="treeitem"
              aria-current={report.runId === selectedRunId || undefined}
              className="flex items-center gap-1.5 py-1 px-1.5 rounded-lg text-left cd-row-hover min-w-0"
              style={report.runId === selectedRunId ? { background: "var(--cd-primary-soft)" } : undefined}
              onClick={() => onSelect(report.runId)}
              title={report.profileName}
            >
              <FileText className="w-3 h-3 cd-text-faint shrink-0" />
              <span className="cd-text text-xs tabular-nums">{reportNodeText(report)}</span>
              <span className="cd-text-faint text-[11px] truncate">{report.profileName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
