"use client";

// 고객사 로고 — 회사소개서 '주요 고객사·협력 기관' 쪽(로고 월)에 실을 고객사·기관과 로고·분류·순서.
// 계약 거래처를 후보로 보여 주고, 협회·공공기관처럼 계약이 없는 곳은 이름으로 직접 추가한다.
// 사진·증서 자산은 렌더러 단계에서 이 화면에 더한다. docs/company-catalog-blueprint.md §6-2·§11

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, ImageUp, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdHelp } from "@/components/cdash/CdHelp";
import { CLIENT_CATEGORIES, type CatalogClient, type ClientCandidate } from "@/lib/catalog/client-types";
import { catalogFetch } from "./catalogFetch";
import "@/components/cdash/cdash.css";

interface ClientsResponse {
  clients: CatalogClient[];
  candidates: ClientCandidate[];
}

export function CatalogAssetsBoard() {
  const { theme } = useCdashTheme();
  const [clients, setClients] = useState<CatalogClient[]>([]);
  const [candidates, setCandidates] = useState<ClientCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<string>("민간");
  const [candidateQ, setCandidateQ] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await catalogFetch<ClientsResponse>("/api/catalog/clients");
      setClients(data.clients);
      setCandidates(data.candidates);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const data = await catalogFetch<ClientsResponse>("/api/catalog/clients", { method: "POST", body: JSON.stringify(body) });
      setClients(data.clients);
      setCandidates(data.candidates);
      return true;
    } catch (e) {
      alert((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const update = (c: CatalogClient, patch: Partial<CatalogClient>) =>
    save({ clientId: c.clientId, facilityId: c.facilityId, name: c.name, category: c.category, orderNo: c.orderNo, isPublic: c.isPublic, ...patch });

  const remove = async (c: CatalogClient) => {
    if (!confirm(`'${c.name}'을(를) 로고 목록에서 뺄까요? 올린 로고 파일은 지난 발행본을 위해 보관됩니다.`)) return;
    setBusy(true);
    try {
      const data = await catalogFetch<ClientsResponse>(`/api/catalog/clients?clientId=${encodeURIComponent(c.clientId)}`, { method: "DELETE" });
      setClients(data.clients);
      setCandidates(data.candidates);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = async (c: CatalogClient, file: File) => {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("clientId", c.clientId);
      fd.append("file", file);
      const data = await catalogFetch<{ clients: CatalogClient[] }>("/api/catalog/clients/logo", { method: "POST", body: fd });
      setClients(data.clients);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const filteredCandidates = useMemo(() => {
    const s = candidateQ.trim().toLowerCase();
    return s ? candidates.filter((c) => c.name.toLowerCase().includes(s)) : candidates;
  }, [candidates, candidateQ]);
  const withLogo = clients.filter((c) => c.logoAssetId).length;

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<Building2 className="w-5 h-5" />}
        eyebrow="회사소개서"
        breadcrumbs={[{ label: "회사소개서", href: "/sales/catalog" }, { label: "고객사 로고" }]}
        title="고객사 로고"
        titleSuffix={`${clients.length}곳`}
        helpTopic="catalog.clients"
        meta={<span className="text-xs cd-text-muted">로고 등록 {withLogo} / {clients.length}</span>}
        actions={
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={reload} disabled={loading || busy}>
            <RefreshCw className="w-3.5 h-3.5" /> 새로 고침
          </button>
        }
      />

      {error && <div className="cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm mb-3">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3">
        <section className="cd-card p-4">
          <h3 className="cd-text font-semibold text-base mb-3">로고 목록</h3>
          {loading ? (
            <p className="text-sm cd-text-faint py-6 text-center">불러오는 중…</p>
          ) : clients.length === 0 ? (
            <p className="text-sm cd-text-faint py-6 text-center">등록된 고객사가 없습니다. [추가]에서 계약 거래처를 고르거나 이름으로 추가하세요.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="cd-table">
                <thead>
                  <tr>
                    <th style={{ width: 120 }}>로고</th>
                    <th>이름</th>
                    <th>분류</th>
                    <th className="text-right">순서</th>
                    <th>공개</th>
                    <th style={{ width: 120 }} />
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <tr key={c.clientId}>
                      <td>
                        {c.logoAssetId ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/api/catalog/assets/${encodeURIComponent(c.logoAssetId)}`} alt={`${c.name} 로고`} className="h-8 max-w-[104px] object-contain bg-white rounded border cd-border-c px-1" />
                        ) : (
                          <span className="text-xs cd-text-faint">로고 없음</span>
                        )}
                      </td>
                      <td className="cd-text">
                        {c.name}
                        {c.contractCount > 0 && <span className="block text-[11px] cd-text-faint">계약 {c.contractCount}건</span>}
                      </td>
                      <td>
                        <select className="cd-select" style={{ width: 84 }} value={c.category} disabled={busy} onChange={(e) => update(c, { category: e.target.value as CatalogClient["category"] })} aria-label={`${c.name} 분류`}>
                          {CLIENT_CATEGORIES.map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                      </td>
                      <td className="text-right">
                        <input
                          className="cd-input text-right tabular-nums"
                          style={{ width: 64 }}
                          inputMode="numeric"
                          defaultValue={c.orderNo}
                          disabled={busy}
                          onBlur={(e) => {
                            const n = Number(e.target.value.replace(/[^\d]/g, "")) || 0;
                            if (n !== c.orderNo) update(c, { orderNo: n });
                          }}
                          aria-label={`${c.name} 순서`}
                        />
                      </td>
                      <td>
                        <label className="inline-flex items-center gap-1.5 text-xs">
                          <input type="checkbox" checked={c.isPublic} disabled={busy} onChange={(e) => update(c, { isPublic: e.target.checked })} /> 싣기
                        </label>
                      </td>
                      <td className="whitespace-nowrap">
                        <label className={`cd-btn cd-btn-soft cd-btn-sm cd-action cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`} title="PNG·JPG·WebP, 5MB 이하">
                          <ImageUp className="w-3.5 h-3.5" /> {c.logoAssetId ? "로고 교체" : "로고 올리기"}
                          <input
                            type="file"
                            className="hidden"
                            accept=".png,.jpg,.jpeg,.webp"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadLogo(c, f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" aria-label={`${c.name} 빼기`} disabled={busy} onClick={() => remove(c)}>
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

        <section className="cd-card p-4">
          <h3 className="cd-text font-semibold text-base flex items-center gap-1 mb-3">
            추가 <CdHelp topic="catalog.clients-add" />
          </h3>
          <div className="flex items-center gap-2 mb-4">
            <input className="cd-input flex-1 min-w-0" placeholder="기관·협회 이름(계약 없는 곳)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <select className="cd-select" style={{ width: 84 }} value={newCategory} onChange={(e) => setNewCategory(e.target.value)} aria-label="새 고객사 분류">
              {CLIENT_CATEGORIES.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            <button
              type="button"
              className="cd-btn cd-btn-primary cd-btn-sm"
              disabled={busy || !newName.trim()}
              onClick={async () => {
                if (await save({ name: newName, category: newCategory, orderNo: clients.length + 1, isPublic: true })) setNewName("");
              }}
            >
              <Plus className="w-3.5 h-3.5" /> 추가
            </button>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs cd-text-muted">계약 거래처(계약 많은 순)</span>
            <input className="cd-input ml-auto" style={{ width: 160 }} placeholder="거래처 검색" value={candidateQ} onChange={(e) => setCandidateQ(e.target.value)} />
          </div>
          <div className="overflow-auto rounded-lg border cd-border-c divide-y cd-border-c" style={{ maxHeight: 520 }}>
            {filteredCandidates.length === 0 ? (
              <p className="text-sm cd-text-faint p-4">{candidates.length === 0 ? "추가할 계약 거래처가 없습니다." : "검색 결과가 없습니다."}</p>
            ) : (
              filteredCandidates.map((c) => (
                <div key={c.facilityId} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="flex-1 min-w-0">
                    <span className="block cd-text truncate">{c.name}</span>
                    <span className="block text-[11px] cd-text-faint">계약 {c.contractCount}건 · 최근 {c.lastContractDate || "—"}</span>
                  </span>
                  <button
                    type="button"
                    className="cd-btn cd-btn-soft cd-btn-sm"
                    disabled={busy}
                    onClick={() => save({ facilityId: c.facilityId, name: c.name, category: "민간", orderNo: clients.length + 1, isPublic: true })}
                  >
                    <Plus className="w-3.5 h-3.5" /> 목록에 추가
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
