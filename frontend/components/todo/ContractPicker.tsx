"use client";

// 계약(용역) 선택기 — BoardCreateModal(§19-11)·LinkPickerModal 이 공유한다.
// GET /api/contracts/tree?year= 가 200이면 FacilityOrdersModal 과 같은 연도·용역분류 트리(접기)로, 403 이면
// GET /api/todo/boards/contract-candidates?q= 검색 목록으로 폴백한다. 선택 결과는 TreeContract(+후보 행이 있으면 함께)로 돌려준다.

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FileSignature, Folder, FolderOpen } from "lucide-react";
import { CdInput } from "@/components/cdash";
import { resolveServiceTypeStyle } from "@/lib/ieps/contract-tree-style";
import type { TodoContractCandidate } from "@/lib/todo/types";
import { apiCall } from "./useTodoData";

export interface TreeContract {
  contractId: string;
  contractTitle: string;
  counterpartyName: string;
  serviceSubtype: string | null;
  contractDate: string | null;
  contractStatus: string;
}
interface TreeGroup {
  serviceType: string;
  contracts: TreeContract[];
}
interface TreePayload {
  year: string | null;
  totalCount: number;
  availableYears: string[];
  groups: TreeGroup[];
}

export const CONTRACT_STATUS_LABEL: Record<string, string> = { terminated: "계약해지", suspended: "계약중지", completed: "수행 완료" };

export interface ContractPickerProps {
  /** true 일 때만 트리를 불러온다(모달 열림·탭 활성). false→true 전환 시 검색어·펼침을 초기화한다. */
  active: boolean;
  selectedId: string | null;
  /** cand 는 폴백 검색에서 고른 경우에만 채워진다(트리 선택은 null). */
  onSelect: (contract: TreeContract, cand: TodoContractCandidate | null) => void;
}

export function ContractPicker({ active, selectedId, onSelect }: ContractPickerProps) {
  const [treeMode, setTreeMode] = useState<"loading" | "tree" | "fallback">("loading");
  const [tree, setTree] = useState<TreePayload | null>(null);
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<TodoContractCandidate[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!active) return;
    setQ("");
    setHits([]);
    setExpanded({});
  }, [active]);

  // 계약 트리 — contract.view 권한이 있으면 200, 없으면 403 → 검색 폴백
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setTreeMode("loading");
    (async () => {
      try {
        const res = await fetch(`/api/contracts/tree?year=${encodeURIComponent(year)}`, { cache: "no-store" });
        if (res.status === 403 || res.status === 401) {
          if (!cancelled) setTreeMode("fallback");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as TreePayload;
        if (cancelled) return;
        setTree(json);
        setTreeMode("tree");
      } catch {
        if (!cancelled) setTreeMode("fallback");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, year]);

  // 폴백 검색(디바운스)
  useEffect(() => {
    if (!active || treeMode !== "fallback") return;
    const t = window.setTimeout(async () => {
      setSearching(true);
      try {
        const d = await apiCall<{ contracts: TodoContractCandidate[] }>(`/api/todo/boards/contract-candidates?q=${encodeURIComponent(q.trim())}&limit=40`);
        setHits(d.contracts ?? []);
      } catch {
        setHits([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => window.clearTimeout(t);
  }, [active, treeMode, q]);

  if (treeMode === "loading") return <div className="todo-loading">계약 목록을 불러오는 중…</div>;

  if (treeMode === "fallback") {
    return (
      <>
        <CdInput label="용역 검색" placeholder="용역명·발주처로 검색" value={q} onChange={(e) => setQ(e.target.value)} hint="내가 수행인력으로 등록된 계약(계약 열람 권한이 있으면 그 범위)만 보입니다." />
        <div className="todo-cand" role="listbox" aria-label="계약 후보">
          {searching && hits.length === 0 ? (
            <div className="todo-loading">검색 중…</div>
          ) : hits.length === 0 ? (
            <div className="todo-empty">일치하는 계약이 없습니다.</div>
          ) : (
            hits.map((c) => (
              <button
                key={c.contractId}
                type="button"
                role="option"
                aria-selected={selectedId === c.contractId}
                className="todo-cand-row"
                onClick={() =>
                  onSelect({ contractId: c.contractId, contractTitle: c.contractTitle, counterpartyName: c.counterpartyName, serviceSubtype: c.serviceSubtype, contractDate: c.contractDate, contractStatus: c.contractStatus }, c)
                }
              >
                <FileSignature aria-hidden="true" className="w-3.5 h-3.5 shrink-0" style={{ color: resolveServiceTypeStyle(c.serviceType).childColor }} />
                <span className="todo-cand-t">{c.contractTitle}</span>
                <span className="todo-cand-s">{c.counterpartyName}</span>
                {c.existingBoardId && <span className="todo-tree-st" data-s="completed">보드 있음</span>}
              </button>
            ))
          )}
        </div>
      </>
    );
  }

  const years = tree?.availableYears?.length ? tree.availableYears : [year];
  return (
    <>
      <div className="flex items-center gap-2">
        <label className="todo-field-lb" htmlFor="todo-contract-year">
          계약 연도
        </label>
        <select id="todo-contract-year" className="cd-select todo-w-sel" value={year} onChange={(e) => setYear(e.target.value)}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}년
            </option>
          ))}
        </select>
        <span className="todo-field-hint">총 {tree?.totalCount ?? 0}건 · 용역분류를 펼쳐 계약을 고르세요</span>
      </div>
      <div className="todo-tree" role="tree" aria-label="계약 트리">
        {!tree || tree.groups.length === 0 ? (
          <div className="todo-empty">{year}년에 등록된 계약이 없습니다.</div>
        ) : (
          tree.groups.map((g) => {
            const style = resolveServiceTypeStyle(g.serviceType);
            const isOpen = expanded[g.serviceType] === true;
            const Icon = isOpen ? FolderOpen : Folder;
            return (
              <div key={g.serviceType} role="treeitem" aria-expanded={isOpen}>
                <button type="button" className="todo-tree-g" onClick={() => setExpanded((p) => (p[g.serviceType] ? {} : { [g.serviceType]: true }))}>
                  {isOpen ? <ChevronDown aria-hidden="true" className="cd-text-faint" /> : <ChevronRight aria-hidden="true" className="cd-text-faint" />}
                  <Icon aria-hidden="true" className="fill-current" style={{ color: style.parentColor }} />
                  <span>{g.serviceType}</span>
                  <span className="todo-tree-n">{g.contracts.length}건</span>
                </button>
                {isOpen &&
                  g.contracts.map((c) => {
                    const st = CONTRACT_STATUS_LABEL[c.contractStatus];
                    return (
                      <button key={c.contractId} type="button" className="todo-tree-c" aria-selected={selectedId === c.contractId} onClick={() => onSelect(c, null)}>
                        <FileSignature aria-hidden="true" style={{ color: style.childColor }} />
                        <span className="todo-tree-t">{c.contractTitle}</span>
                        {st && (
                          <span className="todo-tree-st" data-s={c.contractStatus}>
                            {st}
                          </span>
                        )}
                        <span className="todo-tree-cp">{c.counterpartyName}</span>
                      </button>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
