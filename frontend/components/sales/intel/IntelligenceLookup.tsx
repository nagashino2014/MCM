"use client";
import { useEffect, useRef, useState } from "react";
import { CdButton, CdInput, CdSelect } from "@/components/cdash";
import { intelApi } from "./intelligence-client";

type Option = { id: string; label: string };
export function IntelligenceLookup({ kind, label, value, onChange, disabled }: { kind: "facility" | "sales" | "contract"; label: string; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(() => { sequence.current += 1; setOptions([]); setQuery(""); setError(""); }, [kind]);
  async function search() {
    const call = ++sequence.current; setBusy(true); setError("");
    try {
      const path = kind === "facility" ? "/api/facilities" : kind === "sales" ? "/api/sales/projects" : "/api/contracts";
      const data = await intelApi<{ items?: Record<string, unknown>[]; projects?: Record<string, unknown>[] }>(`${path}?limit=30&q=${encodeURIComponent(query)}`);
      if (call !== sequence.current) return;
      setOptions((data.items ?? data.projects ?? []).map((row) => ({ id: String(kind === "facility" ? row.facilityId : kind === "sales" ? row.projectId : row.contractId), label: String(row.contractTitle ?? row.title ?? row.companyName ?? row.facilityName ?? "") + (row.siteAddress ? ` · ${row.siteAddress}` : "") })));
    } catch (e) { if (call === sequence.current) setError((e as Error).message); } finally { if (call === sequence.current) setBusy(false); }
  }
  return <div className="intel-form"><div className="flex items-end gap-2"><CdInput className="flex-1 min-w-0" label={`${label} 검색`} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} disabled={disabled} /><CdButton disabled={disabled || busy} onClick={() => void search()}>{busy ? "검색 중…" : "검색"}</CdButton></div>
    <CdSelect label={label} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}><option value="">선택하세요</option>{value && !options.some((item) => item.id === value) && <option value={value}>현재 연결된 항목</option>}{options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</CdSelect>
    {error && <p className="intel-error" role="alert">{error}</p>}
  </div>;
}
