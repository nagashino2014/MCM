"use client";

// 범용 API 스크래퍼 — 커스텀 소스 등록/관리 보드.
// 소스 CRUD + API Profile 자동생성(analyze) + 엔드포인트(JSON 편집) + 미리보기/실행 + 활성화.
// 수집 결과는 intel_signals(source='custom:<slug>')로 적재된다.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Radar, Plus, Wand2, Play, Eye, Trash2, ArrowLeft, Check } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdThemeToggle } from "@/components/cdash/CdThemeToggle";
import "@/components/cdash/cdash.css";

interface Source {
  sourceId: string;
  slug: string;
  name: string;
  baseUrl: string | null;
  purpose: string;
  apiProfile: unknown;
  enabled: boolean;
}
interface Endpoint {
  endpointId: string;
  name: string;
  apiConfig: unknown;
  fieldMapping: Record<string, string>;
  sinkConfig: { signal_type?: string; signal_grade?: string } | null;
  enabled: boolean;
}
interface Proposal {
  api_profile: unknown;
  api_config: unknown;
  field_mapping: Record<string, string>;
  warnings: string[];
  summary: string;
}
interface PreviewSample {
  externalId: string;
  companyName: string | null;
  reportName: string | null;
  url: string | null;
  disclosedAt: string | null;
  facilityId: string | null;
}

async function jfetch(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

export function CustomSourcesPanel() {
  const { theme, toggleTheme } = useCdashTheme();
  const [sources, setSources] = useState<Source[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [sel, setSel] = useState<Source | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 생성 폼
  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");

  // analyze
  const [anUrl, setAnUrl] = useState("");
  const [anRaw, setAnRaw] = useState("");
  const [anContext, setAnContext] = useState("");
  const [anFile, setAnFile] = useState<File | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [endpointName, setEndpointName] = useState("기본 엔드포인트");

  // preview
  const [samples, setSamples] = useState<PreviewSample[] | null>(null);

  const loadSources = useCallback(async () => {
    try {
      const d = await jfetch("/api/scraper/sources?purpose=intel");
      setSources(d.sources ?? []);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const loadDetail = useCallback(async (sourceId: string) => {
    try {
      const d = await jfetch(`/api/scraper/sources/${sourceId}`);
      setSel(d.source);
      setEndpoints(d.endpoints ?? []);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    loadSources();
  }, [loadSources]);
  useEffect(() => {
    if (selId) {
      setProposal(null);
      setSamples(null);
      loadDetail(selId);
    } else {
      setSel(null);
      setEndpoints([]);
    }
  }, [selId, loadDetail]);

  const createSource = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const d = await jfetch("/api/scraper/sources", {
        method: "POST",
        body: JSON.stringify({ name: newName.trim(), baseUrl: newBaseUrl.trim() || null }),
      });
      setNewName("");
      setNewBaseUrl("");
      await loadSources();
      setSelId(d.source.sourceId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runAnalyze = async () => {
    if (!sel) return;
    if (!anUrl.trim() && !anRaw.trim() && !anFile) {
      setMsg("가이드 파일(docx)·URL 또는 명세 원문을 입력하세요.");
      return;
    }
    setBusy(true);
    setMsg("분석 중… (LLM 호출, 최대 1분)");
    try {
      let d: Proposal;
      if (anFile) {
        // 파일 업로드는 multipart/form-data
        const fd = new FormData();
        if (anUrl.trim()) fd.append("url", anUrl.trim());
        if (anRaw.trim()) fd.append("rawText", anRaw.trim());
        if (anContext.trim()) fd.append("context", anContext.trim());
        fd.append("file", anFile);
        const res = await fetch(`/api/scraper/sources/${sel.sourceId}/analyze`, { method: "POST", body: fd, cache: "no-store" });
        d = await res.json();
        if (!res.ok) throw new Error((d as unknown as { error?: string })?.error ?? `HTTP ${res.status}`);
      } else {
        d = (await jfetch(`/api/scraper/sources/${sel.sourceId}/analyze`, {
          method: "POST",
          body: JSON.stringify({ url: anUrl.trim() || undefined, rawText: anRaw.trim() || undefined, context: anContext.trim() || undefined }),
        })) as Proposal;
      }
      setProposal(d);
      setMsg(d.warnings?.length ? `분석 완료 — 경고: ${d.warnings.join(", ")}` : "분석 완료");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveProposal = async () => {
    if (!sel || !proposal) return;
    setBusy(true);
    try {
      // 1) 소스에 api_profile 커밋
      await jfetch(`/api/scraper/sources/${sel.sourceId}`, {
        method: "PUT",
        body: JSON.stringify({ apiProfile: proposal.api_profile }),
      });
      // 2) 엔드포인트 생성(api_config + field_mapping)
      await jfetch(`/api/scraper/sources/${sel.sourceId}/endpoints`, {
        method: "POST",
        body: JSON.stringify({
          name: endpointName.trim() || "기본 엔드포인트",
          apiConfig: proposal.api_config,
          fieldMapping: proposal.field_mapping,
          sinkConfig: { signal_grade: "monitoring", signal_type: "other" },
        }),
      });
      setProposal(null);
      setMsg("저장됨");
      await loadDetail(sel.sourceId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runEndpoint = async (ep: Endpoint, preview: boolean) => {
    if (!sel) return;
    setBusy(true);
    setSamples(null);
    setMsg(preview ? "미리보기 실행 중…" : "수집 실행 중…");
    try {
      const d = await jfetch(`/api/scraper/sources/${sel.sourceId}/endpoints/${ep.endpointId}/preview`, {
        method: "POST",
        body: JSON.stringify({ preview }),
      });
      if (preview) {
        setSamples(d.samples ?? []);
        setMsg(`미리보기: 수집 ${d.scanned}건, 매칭 ${d.matched}건${d.error ? ` · 오류: ${d.error}` : ""}`);
      } else {
        setMsg(`수집 완료: 신규 ${d.inserted}건 / 매칭 ${d.matched}건 / 스캔 ${d.scanned}건${d.error ? ` · 오류: ${d.error}` : ""}`);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleEndpoint = async (ep: Endpoint) => {
    if (!sel) return;
    await jfetch(`/api/scraper/sources/${sel.sourceId}/endpoints/${ep.endpointId}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: !ep.enabled }),
    }).catch((e) => setMsg(String(e)));
    await loadDetail(sel.sourceId);
  };

  const toggleSource = async () => {
    if (!sel) return;
    await jfetch(`/api/scraper/sources/${sel.sourceId}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: !sel.enabled }),
    }).catch((e) => setMsg(String(e)));
    await loadSources();
    await loadDetail(sel.sourceId);
  };

  const deleteSource = async () => {
    if (!sel || !confirm(`소스 "${sel.name}"를 삭제할까요? (엔드포인트 포함)`)) return;
    await jfetch(`/api/scraper/sources/${sel.sourceId}`, { method: "DELETE" }).catch((e) => setMsg(String(e)));
    setSelId(null);
    await loadSources();
  };

  return (
    <div className="cdash cd-fields-white flex flex-col gap-4 p-4 md:p-5 rounded-3xl min-h-full" data-theme={theme}>
      <CdPageHeader
        icon={<Radar className="w-5 h-5" />}
        eyebrow="Intel · Custom Sources"
        title="커스텀 API 소스"
        subtitle="임의의 공개 API를 등록하면 API Profile을 AI가 자동 생성해 수집합니다. 결과는 인텔 신호로 적재됩니다."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/sales/intel" className="cd-chip">
              <ArrowLeft className="w-3.5 h-3.5" /> 인텔
            </Link>
            <CdThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        }
      />

      {msg && (
        <div className="cd-card px-3 py-2 text-[13px] cd-text-muted">{msg}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* 좌: 소스 목록 + 생성 */}
        <section className="cd-card p-4 flex flex-col gap-3">
          <h2 className="text-sm font-bold cd-text">소스 목록</h2>
          <div className="flex flex-col gap-2">
            {sources.map((s) => (
              <button
                key={s.sourceId}
                type="button"
                onClick={() => setSelId(s.sourceId)}
                className={
                  "w-full text-left rounded-lg border px-3 py-2 transition-colors " +
                  (selId === s.sourceId ? "cd-tint-primary border-[color:var(--cd-primary)]" : "cd-border-c hover:bg-[color:var(--cd-surface)]")
                }
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13px] cd-text truncate flex-1">{s.name}</span>
                  <span
                    className="text-[10px] rounded-full px-1.5 py-0.5 shrink-0"
                    style={
                      s.enabled
                        ? { background: "color-mix(in srgb, #13DEB9 18%, transparent)", color: "#13DEB9" }
                        : { background: "var(--cd-surface)", color: "var(--cd-faint)" }
                    }
                  >
                    {s.enabled ? "활성" : "비활성"}
                  </span>
                </div>
                <div className="text-[11px] cd-text-faint truncate">custom:{s.slug}</div>
              </button>
            ))}
            {sources.length === 0 && <p className="text-[13px] cd-text-faint py-2">등록된 소스가 없습니다.</p>}
          </div>
          <div className="border-t cd-border-c pt-3 flex flex-col gap-2">
            <input className="cd-input text-[13px]" placeholder="소스명 (예: 조달청 나라장터)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input className="cd-input text-[13px]" placeholder="base URL (도메인만, 예: http://apis.data.go.kr)" value={newBaseUrl} onChange={(e) => setNewBaseUrl(e.target.value)} />
            <button type="button" onClick={createSource} disabled={busy || !newName.trim()} className="cd-btn cd-btn-primary text-[13px] disabled:opacity-50">
              <Plus className="w-4 h-4" /> 소스 추가
            </button>
          </div>
        </section>

        {/* 우: 선택 소스 상세 */}
        <section className="flex flex-col gap-4 min-w-0">
          {!sel ? (
            <div className="cd-card p-8 text-center text-[13px] cd-text-faint">소스를 선택하거나 새로 추가하세요.</div>
          ) : (
            <>
              <div className="cd-card p-4 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold cd-text">{sel.name}</div>
                  <div className="text-[11px] cd-text-faint">custom:{sel.slug}{sel.baseUrl ? ` · ${sel.baseUrl}` : ""}</div>
                </div>
                <button type="button" onClick={toggleSource} className={"cd-btn text-[12px] " + (sel.enabled ? "cd-btn-soft" : "cd-btn-primary")}>
                  {sel.enabled ? "야간배치 비활성화" : "야간배치 활성화"}
                </button>
                <button type="button" onClick={deleteSource} className="cd-btn cd-btn-danger text-[12px]">
                  <Trash2 className="w-3.5 h-3.5" /> 삭제
                </button>
              </div>

              {/* analyze */}
              <div className="cd-card p-4 flex flex-col gap-2">
                <h3 className="text-sm font-bold cd-text flex items-center gap-1.5"><Wand2 className="w-4 h-4" /> API Profile 자동생성</h3>
                <p className="text-[11px] cd-text-faint">가이드 문서(docx)를 올리거나, 명세 페이지 URL·원문을 넣으면 AI가 요청변수·응답필드·인증방식을 분석합니다.</p>
                <label className="flex items-center gap-2 text-[12px] cd-text-muted">
                  <input type="file" accept=".docx" className="text-[12px]" onChange={(e) => setAnFile(e.target.files?.[0] ?? null)} />
                  {anFile && <span className="cd-text-faint truncate">{anFile.name}</span>}
                </label>
                <input className="cd-input text-[13px]" placeholder="API 가이드/명세 URL (실제 호출 URL 아님)" value={anUrl} onChange={(e) => setAnUrl(e.target.value)} />
                <textarea className="cd-textarea text-[13px] font-mono" rows={3} placeholder="또는 명세/응답 예시 원문 붙여넣기" value={anRaw} onChange={(e) => setAnRaw(e.target.value)} />
                <input className="cd-input text-[13px]" placeholder="추가 설명(선택, 예: 발주계획 목록 조회)" value={anContext} onChange={(e) => setAnContext(e.target.value)} />
                <button type="button" onClick={runAnalyze} disabled={busy} className="cd-btn cd-btn-primary text-[13px] self-start disabled:opacity-50">
                  <Wand2 className="w-4 h-4" /> 분석
                </button>

                {proposal && (
                  <div className="mt-2 flex flex-col gap-2 border-t cd-border-c pt-3">
                    {proposal.summary && <p className="text-[12px] cd-text-muted">{proposal.summary}</p>}
                    {proposal.warnings?.length > 0 && (
                      <p className="text-[12px]" style={{ color: "#FA896B" }}>⚠ {proposal.warnings.join(", ")}</p>
                    )}
                    <label className="text-[11px] cd-text-faint">field_mapping</label>
                    <pre className="text-[11px] cd-text-muted bg-[color:var(--cd-surface)] rounded p-2 overflow-x-auto">{JSON.stringify(proposal.field_mapping, null, 2)}</pre>
                    <label className="text-[11px] cd-text-faint">api_config</label>
                    <pre className="text-[11px] cd-text-muted bg-[color:var(--cd-surface)] rounded p-2 overflow-x-auto max-h-40">{JSON.stringify(proposal.api_config, null, 2)}</pre>
                    <div className="flex items-center gap-2">
                      <input className="cd-input text-[13px] flex-1" placeholder="엔드포인트명" value={endpointName} onChange={(e) => setEndpointName(e.target.value)} />
                      <button type="button" onClick={saveProposal} disabled={busy} className="cd-btn cd-btn-primary text-[13px] disabled:opacity-50">
                        <Check className="w-4 h-4" /> 프로파일 저장
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* 엔드포인트 목록 */}
              <div className="cd-card p-4 flex flex-col gap-2">
                <h3 className="text-sm font-bold cd-text">엔드포인트</h3>
                {endpoints.length === 0 && <p className="text-[13px] cd-text-faint">아직 없습니다. 위에서 분석 후 프로파일을 저장하세요.</p>}
                {endpoints.map((ep) => (
                  <div key={ep.endpointId} className="rounded-lg border cd-border-c p-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] cd-text flex-1 truncate">{ep.name}</span>
                      <span className="text-[11px] cd-text-faint">{ep.enabled ? "수집 대상" : "비활성"}</span>
                      <button type="button" onClick={() => toggleEndpoint(ep)} className="cd-btn cd-btn-soft text-[11px]">
                        {ep.enabled ? "끄기" : "켜기"}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => runEndpoint(ep, true)} disabled={busy} className="cd-btn cd-btn-soft text-[12px] disabled:opacity-50">
                        <Eye className="w-3.5 h-3.5" /> 미리보기
                      </button>
                      <button type="button" onClick={() => runEndpoint(ep, false)} disabled={busy} className="cd-btn cd-btn-primary text-[12px] disabled:opacity-50">
                        <Play className="w-3.5 h-3.5" /> 지금 수집
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* 미리보기 결과 */}
              {samples && (
                <div className="cd-card p-4 flex flex-col gap-2">
                  <h3 className="text-sm font-bold cd-text">미리보기 ({samples.length}건)</h3>
                  <div className="overflow-x-auto">
                    <table className="cd-table text-[12px] w-full">
                      <thead>
                        <tr>
                          <th className="text-left">회사</th>
                          <th className="text-left">제목</th>
                          <th className="text-left">일자</th>
                          <th className="text-left">매칭</th>
                        </tr>
                      </thead>
                      <tbody>
                        {samples.map((s) => (
                          <tr key={s.externalId}>
                            <td className="truncate max-w-[140px]">{s.companyName ?? "-"}</td>
                            <td className="truncate max-w-[240px]">{s.reportName ?? "-"}</td>
                            <td>{s.disclosedAt ?? "-"}</td>
                            <td>{s.facilityId ? "✓" : "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
