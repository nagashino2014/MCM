"use client";

// 범용 API 스크래퍼 — 커스텀 소스 등록/관리 보드.
// 소스 CRUD + API Profile 자동생성(analyze) + 엔드포인트(JSON 편집) + 미리보기/실행 + 활성화.
// 수집 결과는 intel_signals(source='custom:<slug>')로 적재된다.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Radar, Plus, Wand2, Play, Eye, Trash2, ArrowLeft, Check, ExternalLink, KeyRound, ListTree, Settings2, History, Clock } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { EndpointConfigBuilder } from "@/components/sales/scraper/EndpointConfigBuilder";
import type { ApiConfig, ApiProfile, FieldMapping, SourceCatalog } from "@/lib/scraper/types";
import "@/components/cdash/cdash.css";

interface Source {
  sourceId: string;
  slug: string;
  name: string;
  baseUrl: string | null;
  purpose: string;
  apiProfile: ApiProfile | null;
  catalog: SourceCatalog | null;
  enabled: boolean;
  hasSecret?: boolean;
  /** 배치 실행 시각(KST 0~23). null=기본값 */
  batchHour?: number | null;
  lastBatchDate?: string | null;
}

/** 배치 실행 시각 기본값(KST) — sources-store.DEFAULT_BATCH_HOUR 와 동일해야 함 */
const DEFAULT_BATCH_HOUR = 7;
/** 백필 실행 중 청크의 세부 진행 — 서버 backfill.chunk_progress 와 동일 shape. */
interface ChunkProgress {
  chunk: string;
  phase: "fetch" | "save";
  page: number;
  items: number;
  total?: number;
  started_at: string;
  updated_at: string;
}

interface Endpoint {
  endpointId: string;
  name: string;
  apiConfig: ApiConfig | null;
  fieldMapping: Record<string, string>;
  sinkConfig: { signal_type?: string; signal_grade?: string; bid_type?: string } | null;
  backfill: {
    from?: string;
    to?: string;
    cursor?: string;
    status?: string;
    last_result?: { chunk?: string; scanned?: number; inserted?: number; updated?: number; error?: string };
    /** 실행 중 청크의 세부 진행(서버가 폴링용으로 기록) */
    chunk_progress?: ChunkProgress | null;
  } | null;
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
  // intel sink
  companyName?: string | null;
  reportName?: string | null;
  url?: string | null;
  disclosedAt?: string | null;
  facilityId?: string | null;
  // bid sink
  orgName?: string | null;
  title?: string | null;
  budget?: number | null;
  postedAt?: string | null;
  deadline?: string | null;
  method?: string | null;
  workType?: string | null;
  category?: string | null;
}

interface RunLogRow {
  runId: string;
  endpointName: string | null;
  trigger: string;
  status: "success" | "error";
  scanned: number;
  inserted: number;
  updated: number;
  error: string | null;
  startedAt: string;
}

const RUN_TRIGGER_LABEL: Record<string, string> = {
  batch: "배치",
  manual: "수동 수집",
  backfill: "백필",
};

/** UTC ISO → KST "MM-DD HH:mm" */
function fmtRunTime(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(5, 16).replace("T", " ");
  const kst = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(kst.getUTCMonth() + 1)}-${p(kst.getUTCDate())} ${p(kst.getUTCHours())}:${p(kst.getUTCMinutes())}`;
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

export function CustomSourcesPanel({ purpose = "intel" }: { purpose?: "intel" | "bid" }) {
  const isBid = purpose === "bid";
  const { theme } = useCdashTheme();
  const [sources, setSources] = useState<Source[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [sel, setSel] = useState<Source | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 생성 폼
  const [newName, setNewName] = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newSlug, setNewSlug] = useState("");
  // bid 소스 저장 시 대상 종류(엔드포인트별)
  const [bidType, setBidType] = useState<"order_plan" | "prior_spec" | "bid_notice">("bid_notice");

  // analyze
  const [anUrl, setAnUrl] = useState("");
  const [anRaw, setAnRaw] = useState("");
  const [anContext, setAnContext] = useState("");
  const [anFile, setAnFile] = useState<File | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [endpointName, setEndpointName] = useState("기본 엔드포인트");

  // preview
  const [samples, setSamples] = useState<PreviewSample[] | null>(null);

  // 인증키
  const [secretInput, setSecretInput] = useState("");

  // 야간배치 실행 로그(최근 5일)
  const [runs, setRuns] = useState<RunLogRow[] | null>(null);

  const loadRuns = useCallback(async (sourceId: string) => {
    try {
      const d = await jfetch(`/api/scraper/sources/${sourceId}/runs?days=5`);
      setRuns(Array.isArray(d.runs) ? d.runs : []);
    } catch {
      setRuns([]);
    }
  }, []);

  // 카탈로그 취사선택 + 설정 빌더
  const [catalogSel, setCatalogSel] = useState<string[]>([]);
  const [builderEpId, setBuilderEpId] = useState<string | null>(null);
  /** 카탈로그 카드 내부 진행/완료 배너(전역 msg 는 페이지 상단이라 스크롤 밖에서 안 보임). */
  const [buildMsg, setBuildMsg] = useState<string | null>(null);
  const [buildRunning, setBuildRunning] = useState(false);
  const endpointsRef = useRef<HTMLDivElement | null>(null);

  // 백필(과거 대량 수집) — 열린 엔드포인트/기간/진행/자동 반복 제어
  const [backfillEpId, setBackfillEpId] = useState<string | null>(null);
  const [bfFrom, setBfFrom] = useState("");
  const [bfTo, setBfTo] = useState("");
  const [bfProgress, setBfProgress] = useState<{ done: number; total: number } | null>(null);
  const [bfMsg, setBfMsg] = useState<string | null>(null);
  const [bfRunning, setBfRunning] = useState(false);
  /** 실행 중 청크의 세부 진행(폴링 수신) — 진행률 바 하단 표시용 */
  const [bfChunk, setBfChunk] = useState<ChunkProgress | null>(null);
  const bfLoopRef = useRef(false);
  /** 사용자가 중지를 눌렀는지 — 루프 종료 사유 구분(완료/오류와 분리) */
  const bfStopRef = useRef(false);

  const loadSources = useCallback(async () => {
    try {
      const d = await jfetch(`/api/scraper/sources?purpose=${purpose}`);
      setSources(d.sources ?? []);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, [purpose]);

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
      setSecretInput("");
      setCatalogSel([]);
      setBuilderEpId(null);
      setBuildMsg(null);
      setBackfillEpId(null);
      bfLoopRef.current = false;
      setRuns(null);
      loadDetail(selId);
      loadRuns(selId);
    } else {
      setSel(null);
      setEndpoints([]);
      setRuns(null);
    }
  }, [selId, loadDetail, loadRuns]);

  const createSource = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const d = await jfetch("/api/scraper/sources", {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim(),
          baseUrl: newBaseUrl.trim() || null,
          slug: newSlug.trim() || undefined,
          purpose,
        }),
      });
      setNewName("");
      setNewBaseUrl("");
      setNewSlug("");
      await loadSources();
      setSelId(d.source.sourceId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runAnalyze = async (mode: "quick" | "catalog") => {
    if (!sel) return;
    if (!anUrl.trim() && !anRaw.trim() && !anFile) {
      setMsg("가이드 파일(docx)·URL 또는 명세 원문을 입력하세요.");
      return;
    }
    setBusy(true);
    setMsg(mode === "catalog" ? "카탈로그 추출 중… (LLM 호출, 큰 가이드는 2~3분)" : "분석 중… (LLM 호출, 최대 1분)");
    try {
      let d: Record<string, unknown>;
      if (anFile) {
        // 파일 업로드는 multipart/form-data
        const fd = new FormData();
        fd.append("mode", mode);
        if (anUrl.trim()) fd.append("url", anUrl.trim());
        if (anRaw.trim()) fd.append("rawText", anRaw.trim());
        if (anContext.trim()) fd.append("context", anContext.trim());
        fd.append("file", anFile);
        const res = await fetch(`/api/scraper/sources/${sel.sourceId}/analyze`, { method: "POST", body: fd, cache: "no-store" });
        d = await res.json();
        if (!res.ok) throw new Error((d as { error?: string })?.error ?? `HTTP ${res.status}`);
      } else {
        d = (await jfetch(`/api/scraper/sources/${sel.sourceId}/analyze`, {
          method: "POST",
          body: JSON.stringify({ mode, url: anUrl.trim() || undefined, rawText: anRaw.trim() || undefined, context: anContext.trim() || undefined }),
        })) as Record<string, unknown>;
      }
      const warnings = Array.isArray(d.warnings) ? (d.warnings as string[]) : [];
      if (mode === "catalog") {
        const cat = d.catalog as SourceCatalog | undefined;
        setCatalogSel([]);
        await loadDetail(sel.sourceId); // catalog 는 서버에 저장됨
        setMsg(`카탈로그 추출 완료 — 엔드포인트 ${cat?.total_endpoints ?? 0}개. 아래에서 수집할 항목을 선택하세요.${warnings.length ? ` · 경고: ${warnings.join(", ")}` : ""}`);
      } else {
        setProposal(d as unknown as Proposal);
        setMsg(warnings.length ? `분석 완료 — 경고: ${warnings.join(", ")}` : "분석 완료");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 카탈로그에서 선택한 엔드포인트를 정제 분석 → api_profile 저장 + 엔드포인트 자동 생성. */
  const buildSelected = async () => {
    if (!sel || catalogSel.length === 0) return;
    setBusy(true);
    setBuildRunning(true);
    setMsg(`선택 ${catalogSel.length}개 엔드포인트 정제 분석 중… (LLM 호출)`);
    setBuildMsg(`선택 ${catalogSel.length}개 정제 분석 중… 1~3분 걸립니다(목록만 추출된 항목은 상세 분석 포함). 완료되면 아래 엔드포인트 목록으로 이동합니다.`);
    try {
      const d = await jfetch(`/api/scraper/sources/${sel.sourceId}/analyze`, {
        method: "POST",
        body: JSON.stringify({ mode: "build", selectedTitles: catalogSel, context: anContext.trim() || undefined }),
      });
      // 1) api_profile 커밋(endpoints[] 카탈로그 보존본 포함)
      await jfetch(`/api/scraper/sources/${sel.sourceId}`, {
        method: "PUT",
        body: JSON.stringify({ apiProfile: d.api_profile }),
      });
      // 2) 엔드포인트별 proposal 을 자동 생성(이미 같은 이름이 있으면 건너뜀 → 설정 버튼으로 수정)
      const existing = new Set(endpoints.map((e) => e.name));
      const proposals = Array.isArray(d.endpoint_proposals) ? d.endpoint_proposals : [];
      let created = 0;
      for (const p of proposals) {
        if (!p?.name || existing.has(p.name)) continue;
        // bid 적재 종류: 정제 결과(이름 휴리스틱) 우선 — 발주계획을 입찰공고 테이블에 넣는 오적재 방지.
        const epBidType = (p.bid_type as string | undefined) ?? bidType;
        await jfetch(`/api/scraper/sources/${sel.sourceId}/endpoints`, {
          method: "POST",
          body: JSON.stringify({
            name: p.name,
            apiConfig: p.api_config,
            fieldMapping: p.field_mapping ?? {},
            sinkConfig: isBid ? { bid_type: epBidType } : { signal_grade: "monitoring", signal_type: "other" },
          }),
        });
        created++;
      }
      setCatalogSel([]);
      await loadDetail(sel.sourceId);
      const warnings = Array.isArray(d.warnings) ? (d.warnings as string[]) : [];
      const done = `정제 완료 — 프로파일 저장 + 엔드포인트 ${created}개 생성. 각 엔드포인트의 "설정"에서 파라미터·필드를 조정하세요.${warnings.length ? ` · 경고: ${warnings.join(", ")}` : ""}`;
      setMsg(done);
      setBuildMsg(done);
      // 생성 결과가 바로 보이도록 엔드포인트 섹션으로 스크롤.
      setTimeout(() => endpointsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      setMsg(err);
      setBuildMsg(`분석 실패: ${err}`);
    } finally {
      setBusy(false);
      setBuildRunning(false);
    }
  };

  /**
   * 백필 실행 — start 후, 청크마다 step(즉시 202)을 던지고 상태를 폴링해 진행률을 갱신한다.
   * 수집은 서버 백그라운드에서 돌기 때문에 요청이 ALB 한도(300s)에 걸리지 않는다(504 해소).
   */
  const runBackfill = async (ep: Endpoint) => {
    if (!sel || !bfFrom || !bfTo) return;
    const url = `/api/scraper/sources/${sel.sourceId}/endpoints/${ep.endpointId}/backfill`;
    setBfRunning(true);
    bfLoopRef.current = true;
    setBfMsg("백필 시작…");
    setBfChunk(null);
    try {
      const started = await jfetch(url, {
        method: "POST",
        body: JSON.stringify({ action: "start", from: bfFrom, to: bfTo }),
      });
      setBfProgress(started.progress ?? null);

      while (bfLoopRef.current) {
        // 1) 다음 청크 실행 요청(이미 실행 중이면 서버가 busy 로 응답 — 그대로 폴링)
        const step = await jfetch(url, { method: "POST", body: JSON.stringify({ action: "step" }) }).catch(
          (e) => ({ __err: e instanceof Error ? e.message : String(e) }) as Record<string, unknown>
        );
        if (step.__err) {
          setBfMsg(`일시 오류(${step.__err}) — 진행 상태를 다시 확인합니다…`);
        }
        if (step.done) {
          setBfProgress(step.progress ?? null);
          setBfChunk(null);
          setBfMsg("백필 완료 ✓");
          break;
        }

        // 2) 이 청크가 끝날 때까지 3초 간격 폴링 — 진행률 바 갱신
        let finishedChunk = false;
        while (bfLoopRef.current && !finishedChunk) {
          await new Promise((res) => setTimeout(res, 3000));
          const st = await jfetch(url).catch(() => null);
          if (!st?.backfill) continue;
          setBfProgress(st.progress ?? null);
          const cp = (st.backfill.chunk_progress ?? null) as ChunkProgress | null;
          setBfChunk(cp);
          const lr = st.backfill.last_result;
          if (cp) {
            const label =
              cp.phase === "fetch"
                ? `${cp.chunk} 수집 중… ${cp.items.toLocaleString()}건 (${cp.page}p)`
                : `${cp.chunk} 저장 중… ${cp.items.toLocaleString()}/${(cp.total ?? 0).toLocaleString()}건`;
            setBfMsg(label);
            continue;
          }
          // chunk_progress 가 비었으면 청크 종료 — 결과/상태로 다음 동작 결정
          if (lr) {
            setBfMsg(
              `${lr.chunk} 완료: 신규 ${(lr.inserted ?? 0).toLocaleString()} / 갱신 ${(lr.updated ?? 0).toLocaleString()} / 스캔 ${(lr.scanned ?? 0).toLocaleString()}${lr.error ? ` · 오류: ${lr.error}` : ""}`
            );
          }
          if (st.backfill.status === "done") {
            setBfMsg((m) => `${m ? m + " · " : ""}백필 완료 ✓`);
            bfLoopRef.current = false;
            finishedChunk = true;
            break;
          }
          if (st.backfill.status === "idle") {
            // 서버가 중단 처리(지속 오류 등) — 커서 보존. 원인 해결 후 재시작하면 이어서.
            setBfMsg(
              `백필 중단 — ${lr?.error ?? "수집 실패 또는 사용자 중지"} · 같은 기간으로 재시작하면 이어서 진행합니다.`
            );
            bfLoopRef.current = false;
            finishedChunk = true;
            break;
          }
          if (!st.running) finishedChunk = true; // 다음 청크로
        }
      }

      if (bfStopRef.current) {
        await jfetch(url, { method: "POST", body: JSON.stringify({ action: "stop" }) }).catch(() => undefined);
        setBfMsg((m) => `${m ? m + " · " : ""}중지됨(진행 중 청크는 완주 후 정지 · 재시작 시 이어서 진행)`);
      }
      await loadDetail(sel.sourceId);
    } catch (e) {
      setBfMsg(`백필 오류: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      bfLoopRef.current = false;
      bfStopRef.current = false;
      setBfRunning(false);
      setBfChunk(null);
    }
  };

  /** 설정 빌더 저장 — 엔드포인트 api_config + field_mapping 갱신. */
  const saveEndpointConfig = async (ep: Endpoint, name: string, config: ApiConfig, fieldMapping: FieldMapping) => {
    if (!sel) return;
    setBusy(true);
    try {
      await jfetch(`/api/scraper/sources/${sel.sourceId}/endpoints/${ep.endpointId}`, {
        method: "PUT",
        body: JSON.stringify({ name, apiConfig: config, fieldMapping }),
      });
      setBuilderEpId(null);
      setMsg("엔드포인트 설정이 저장되었습니다. 미리보기로 확인하세요.");
      await loadDetail(sel.sourceId);
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
          sinkConfig: isBid ? { bid_type: bidType } : { signal_grade: "monitoring", signal_type: "other" },
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
        setMsg(
          `미리보기: 수집 ${d.scanned}건${isBid ? "" : `, 매칭 ${d.matched ?? 0}건`}${d.error ? ` · 오류: ${d.error}` : ""}`
        );
      } else {
        setMsg(
          `수집 완료: 신규 ${d.inserted}건${isBid ? ` / 갱신 ${d.updated ?? 0}건` : ` / 매칭 ${d.matched ?? 0}건`} / 스캔 ${d.scanned}건${d.error ? ` · 오류: ${d.error}` : ""}`
        );
        loadRuns(sel.sourceId); // 실행 로그 카드 갱신
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

  const saveBatchHour = async (hour: number) => {
    if (!sel) return;
    setBusy(true);
    try {
      await jfetch(`/api/scraper/sources/${sel.sourceId}`, {
        method: "PUT",
        body: JSON.stringify({ batchHour: hour }),
      });
      setMsg(`배치 실행 시각을 ${String(hour).padStart(2, "0")}:00 (KST)로 저장했습니다.`);
      await loadDetail(sel.sourceId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveSecret = async () => {
    if (!sel || !secretInput.trim()) return;
    setBusy(true);
    try {
      await jfetch(`/api/scraper/sources/${sel.sourceId}`, {
        method: "PUT",
        body: JSON.stringify({ authSecret: secretInput.trim() }),
      });
      setSecretInput("");
      setMsg("인증키가 암호화 저장되었습니다.");
      await loadDetail(sel.sourceId);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
        eyebrow={isBid ? "Bid · Custom Sources" : "Intel · Custom Sources"}
        title={isBid ? "공공입찰 API 소스" : "커스텀 API 소스"}
        subtitle={
          isBid
            ? "나라장터 등 공공입찰 API를 등록하면 API Profile을 AI가 자동 생성해 수집합니다. 결과는 공공입찰 종류별 테이블로 적재됩니다."
            : "임의의 공개 API를 등록하면 API Profile을 AI가 자동 생성해 수집합니다. 결과는 인텔 신호로 적재됩니다."
        }
        actions={
          <div className="flex items-center gap-2">
            <Link href={isBid ? "/sales/bids" : "/sales/intel"} className="cd-chip">
              <ArrowLeft className="w-3.5 h-3.5" /> {isBid ? "공공입찰" : "인텔"}
            </Link>
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
            <input className="cd-input text-[13px]" placeholder="식별자 slug (선택, 영문·숫자, 예: narajangteo)" value={newSlug} onChange={(e) => setNewSlug(e.target.value)} />
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
              {/* 상단 2열: (소스 정보 + 인증키 | 야간배치 실행 로그) | API Profile 자동생성 — 좌측 합계 높이 = 우측 높이 */}
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
                  <div className="flex flex-col gap-4 min-w-0">
                    {/* 소스 정보 | 배치 설정 — 가운데 세로 구분선으로 2열 */}
                    <div className="cd-card p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="flex flex-col items-center gap-2 text-center min-w-0">
                        <div className="min-w-0">
                          <div className="text-sm font-bold cd-text truncate">{sel.name}</div>
                          <div className="text-[11px] cd-text-faint truncate">custom:{sel.slug}{sel.baseUrl ? ` · ${sel.baseUrl}` : ""}</div>
                        </div>
                        <button type="button" onClick={toggleSource} className={"cd-btn text-[12px] " + (sel.enabled ? "cd-btn-soft" : "cd-btn-primary")}>
                          {sel.enabled ? "배치 비활성화" : "배치 활성화"}
                        </button>
                        <button type="button" onClick={deleteSource} className="cd-btn cd-btn-danger text-[12px]">
                          <Trash2 className="w-3.5 h-3.5" /> 삭제
                        </button>
                      </div>

                      <div className="flex flex-col gap-2 md:pl-4 min-w-0 md:border-l cd-border-c">
                        <h3 className="text-sm font-bold cd-text flex items-center gap-1.5">
                          <Clock className="w-4 h-4" /> 배치 실행 시각
                        </h3>
                        <p className="text-[11px] cd-text-faint leading-snug">
                          매일 이 시각(KST)에 1회 자동 수집합니다. 나라장터 등 공공 API는 새벽에 점검으로 응답하지 않는 경우가 있어 기본값은 07시입니다.
                        </p>
                        <div className="flex items-center gap-2">
                          <select
                            className="cd-select text-[13px]"
                            style={{ width: "auto" }}
                            value={String(sel.batchHour ?? DEFAULT_BATCH_HOUR)}
                            disabled={busy}
                            onChange={(e) => saveBatchHour(Number(e.target.value))}
                          >
                            {Array.from({ length: 24 }, (_, h) => (
                              <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                            ))}
                          </select>
                          {sel.batchHour == null && <span className="text-[11px] cd-text-faint">기본값</span>}
                        </div>
                        <div className="text-[11px] cd-text-faint">
                          마지막 수집일: {sel.lastBatchDate ?? "—"}
                        </div>
                      </div>
                    </div>

                    {/* 인증키 */}
                    <div className="cd-card p-4 flex flex-col gap-2 flex-1">
                      <h3 className="text-sm font-bold cd-text flex items-center gap-1.5">
                        <KeyRound className="w-4 h-4" /> 인증키
                        {sel.hasSecret && <span className="text-[11px]" style={{ color: "#13DEB9" }}>· 저장됨</span>}
                      </h3>
                      <p className="text-[11px] cd-text-faint">
                        인증키가 필요한 API(공공데이터포털 등)는 여기 입력하면 암호화 저장됩니다 — 재배포 불필요. 나라장터는 Decoding 키를 사용하세요.
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          type="password"
                          className="cd-input text-[13px] flex-1"
                          placeholder={sel.hasSecret ? "변경할 때만 새로 입력" : "인증키 입력"}
                          value={secretInput}
                          onChange={(e) => setSecretInput(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={saveSecret}
                          disabled={busy || !secretInput.trim()}
                          className="cd-btn cd-btn-primary text-[13px] disabled:opacity-50"
                        >
                          <KeyRound className="w-4 h-4" /> 저장
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 야간배치 실행 로그 — 최근 5일 실행 내역(성공/실패·수집 건수·실행 시각) */}
                  <div className="cd-card p-4 flex flex-col gap-2 min-w-0">
                    <h3 className="text-sm font-bold cd-text flex items-center gap-1.5">
                      <History className="w-4 h-4" /> 배치 실행 로그
                      <span className="text-[11px] cd-text-faint font-normal">· 최근 5일</span>
                    </h3>
                    {sel.enabled && endpoints.length > 0 && endpoints.every((e) => !e.enabled) && (
                      <div className="rounded-lg px-3 py-2 text-[11.5px]" style={{ background: "var(--cd-error-soft)", color: "var(--cd-error)" }}>
                        배치가 켜져 있지만 <b>활성화된 엔드포인트가 없어</b> 수집이 실행되지 않습니다. 아래 엔드포인트 목록에서 활성화하세요.
                      </div>
                    )}
                    {sel.enabled && endpoints.length === 0 && (
                      <div className="rounded-lg px-3 py-2 text-[11.5px]" style={{ background: "var(--cd-error-soft)", color: "var(--cd-error)" }}>
                        배치가 켜져 있지만 등록된 엔드포인트가 없어 수집이 실행되지 않습니다.
                      </div>
                    )}
                    {runs === null ? (
                      <div className="text-[12px] cd-text-faint p-3 text-center">불러오는 중…</div>
                    ) : runs.length === 0 ? (
                      <div className="text-[12px] cd-text-faint p-3 text-center border cd-border-c rounded-lg">
                        최근 5일 실행 내역이 없습니다.
                      </div>
                    ) : (
                      <div className="flex flex-col overflow-y-auto" style={{ maxHeight: 240 }}>
                        {runs.map((r) => (
                          <div key={r.runId} className="flex flex-col gap-0.5 py-1.5 border-b cd-border-c last:border-b-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={"cd-pill " + (r.status === "success" ? "cd-pill-success" : "cd-pill-error")}>
                                {r.status === "success" ? "성공" : "실패"}
                              </span>
                              <span className="cd-pill cd-pill-idle">{RUN_TRIGGER_LABEL[r.trigger] ?? r.trigger}</span>
                              <span className="cd-text text-[12px] font-bold">
                                수집 {r.scanned.toLocaleString()}건
                                {r.inserted > 0 ? ` · 신규 ${r.inserted.toLocaleString()}` : ""}
                                {r.updated > 0 ? ` · 갱신 ${r.updated.toLocaleString()}` : ""}
                              </span>
                              <span className="cd-text-faint text-[11px] ml-auto shrink-0">{fmtRunTime(r.startedAt)}</span>
                            </div>
                            {r.endpointName && <div className="text-[11px] cd-text-faint truncate">{r.endpointName}</div>}
                            {r.error && <div className="text-[11px] truncate" style={{ color: "var(--cd-error)" }} title={r.error}>{r.error}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* analyze */}
                <div className="cd-card p-4 flex flex-col gap-2 min-w-0">
                <h3 className="text-sm font-bold cd-text flex items-center gap-1.5"><Wand2 className="w-4 h-4" /> API Profile 자동생성</h3>
                <p className="text-[11px] cd-text-faint">가이드 문서(docx)를 올리거나, 명세 페이지 URL·원문을 넣으면 AI가 요청변수·응답필드·인증방식을 분석합니다.</p>
                <label className="flex items-center gap-2 text-[12px] cd-text-muted">
                  <input type="file" accept=".docx" className="text-[12px]" onChange={(e) => setAnFile(e.target.files?.[0] ?? null)} />
                  {anFile && <span className="cd-text-faint truncate">{anFile.name}</span>}
                </label>
                <input className="cd-input text-[13px]" placeholder="API 가이드/명세 URL (실제 호출 URL 아님)" value={anUrl} onChange={(e) => setAnUrl(e.target.value)} />
                <textarea className="cd-textarea text-[13px] font-mono" rows={3} placeholder="또는 명세/응답 예시 원문 붙여넣기" value={anRaw} onChange={(e) => setAnRaw(e.target.value)} />
                <input className="cd-input text-[13px]" placeholder="추가 설명(선택, 예: 발주계획 목록 조회)" value={anContext} onChange={(e) => setAnContext(e.target.value)} />
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" onClick={() => runAnalyze("catalog")} disabled={busy} className="cd-btn cd-btn-primary text-[13px] disabled:opacity-50">
                    <ListTree className="w-4 h-4" /> 카탈로그 추출 (엔드포인트·파라미터 선택형)
                  </button>
                  <button type="button" onClick={() => runAnalyze("quick")} disabled={busy} className="cd-btn cd-btn-soft text-[13px] disabled:opacity-50">
                    <Wand2 className="w-4 h-4" /> 빠른 자동생성 (원샷)
                  </button>
                </div>

                {proposal && (
                  <div className="mt-2 flex flex-col gap-2 border-t cd-border-c pt-3">
                    {proposal.summary && <p className="text-[12px] cd-text-muted">{proposal.summary}</p>}
                    {proposal.warnings?.length > 0 && (
                      <p className="text-[12px]" style={{ color: "#FA896B" }}>⚠ {proposal.warnings.join(", ")}</p>
                    )}
                    {(() => {
                      const w = (proposal.warnings ?? []).join(" ").toLowerCase();
                      const isPortal =
                        (sel.baseUrl ?? "").includes("data.go.kr") ||
                        /data_go_kr|portal|approval|승인|인증키|활용신청/.test(w);
                      return isPortal ? (
                        <a
                          href="https://www.data.go.kr/iim/api/selectAPIAcountList.do"
                          target="_blank"
                          rel="noreferrer"
                          className="cd-chip self-start"
                          style={{ color: "var(--cd-primary)" }}
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> 공공데이터포털 마이페이지(활용신청·인증키 확인)
                        </a>
                      ) : null;
                    })()}
                    <label className="text-[11px] cd-text-faint">field_mapping</label>
                    <pre className="text-[11px] cd-text-muted bg-[color:var(--cd-surface)] rounded p-2 overflow-x-auto">{JSON.stringify(proposal.field_mapping, null, 2)}</pre>
                    <label className="text-[11px] cd-text-faint">api_config</label>
                    <pre className="text-[11px] cd-text-muted bg-[color:var(--cd-surface)] rounded p-2 overflow-x-auto max-h-40">{JSON.stringify(proposal.api_config, null, 2)}</pre>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input className="cd-input text-[13px] flex-1 min-w-[120px]" placeholder="엔드포인트명" value={endpointName} onChange={(e) => setEndpointName(e.target.value)} />
                      {isBid && (
                        <select
                          className="cd-select text-[13px]"
                          value={bidType}
                          onChange={(e) => setBidType(e.target.value as "order_plan" | "prior_spec" | "bid_notice")}
                        >
                          <option value="order_plan">발주계획</option>
                          <option value="prior_spec">사전규격</option>
                          <option value="bid_notice">입찰공고</option>
                        </select>
                      )}
                      <button type="button" onClick={saveProposal} disabled={busy} className="cd-btn cd-btn-primary text-[13px] disabled:opacity-50">
                        <Check className="w-4 h-4" /> 프로파일 저장
                      </button>
                    </div>
                  </div>
                )}
                </div>
              </div>

              {/* 카탈로그 — 엔드포인트 취사선택 */}
              {sel.catalog && sel.catalog.endpoints.length > 0 && (
                <div className="cd-card p-4 flex flex-col gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold cd-text flex items-center gap-1.5 flex-1">
                      <ListTree className="w-4 h-4" /> 카탈로그 ({sel.catalog.total_endpoints}개 엔드포인트)
                    </h3>
                    <button
                      type="button"
                      className="cd-btn cd-btn-soft text-[11px]"
                      onClick={() =>
                        setCatalogSel(
                          catalogSel.length === sel.catalog!.endpoints.length ? [] : sel.catalog!.endpoints.map((e) => e.title)
                        )
                      }
                    >
                      {catalogSel.length === sel.catalog.endpoints.length ? "전체 해제" : "전체 선택"}
                    </button>
                  </div>
                  <p className="text-[11px] cd-text-faint">
                    가이드에서 추출한 오퍼레이션 목록입니다. 수집할 항목을 선택하고 &quot;선택 항목 분석&quot;을 누르면 프로파일과 엔드포인트가 생성됩니다.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {sel.catalog.endpoints.map((ce) => {
                      const on = catalogSel.includes(ce.title);
                      return (
                        <button
                          key={ce.title}
                          type="button"
                          onClick={() =>
                            setCatalogSel((prev) => (on ? prev.filter((t) => t !== ce.title) : [...prev, ce.title]))
                          }
                          className={
                            "text-left rounded-lg border px-3 py-2 transition-colors " +
                            (on ? "cd-tint-primary border-[color:var(--cd-primary)]" : "cd-border-c hover:bg-[color:var(--cd-surface)]")
                          }
                        >
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] cd-text font-semibold truncate flex-1">{ce.title}</span>
                            {on && <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--cd-primary)" }} />}
                          </div>
                          {ce.category && <div className="text-[10px]" style={{ color: "var(--cd-primary)" }}>{ce.category}</div>}
                          <div className="text-[11px] cd-text-faint">
                            {ce.request_params.length || ce.response_fields.length ? (
                              <>요청변수 <strong>{ce.request_params.length}</strong>개 · 응답필드 <strong>{ce.response_fields.length}</strong>개</>
                            ) : (
                              <>목록만 추출됨 — 선택 항목 분석 시 상세 분석</>
                            )}
                          </div>
                          {ce.request_url && <div className="text-[10px] cd-text-faint font-mono truncate">{ce.request_url}</div>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={buildSelected}
                      disabled={busy || catalogSel.length === 0}
                      className="cd-btn cd-btn-primary text-[13px] disabled:opacity-50"
                    >
                      <Wand2 className={"w-4 h-4" + (buildRunning ? " animate-spin" : "")} />
                      {buildRunning ? "정제 분석 중… (1~2분)" : `선택 항목 분석 (${catalogSel.length}개)`}
                    </button>
                  </div>
                  {buildMsg && (
                    <div
                      className="rounded-lg border cd-border-c px-3 py-2 text-[12px] cd-text-muted"
                      style={buildRunning ? { borderColor: "var(--cd-primary)" } : undefined}
                    >
                      {buildMsg}
                    </div>
                  )}
                </div>
              )}

              {/* 엔드포인트 목록 */}
              <div ref={endpointsRef} className="cd-card p-4 flex flex-col gap-2">
                <h3 className="text-sm font-bold cd-text">엔드포인트</h3>
                {endpoints.length === 0 && <p className="text-[13px] cd-text-faint">아직 없습니다. 위에서 분석 후 프로파일을 저장하세요.</p>}
                {endpoints.map((ep) => {
                  const profileEps = sel.apiProfile?.endpoints ?? [];
                  const canBuild = profileEps.length > 0;
                  const building = builderEpId === ep.endpointId;
                  return (
                    <div key={ep.endpointId} className="rounded-lg border cd-border-c p-3 flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] cd-text flex-1 truncate">{ep.name}</span>
                        {isBid && (
                          <select
                            className="cd-select text-[11px]"
                            title="적재 테이블 종류"
                            value={(ep.sinkConfig?.bid_type as string) ?? "bid_notice"}
                            onChange={async (e) => {
                              await jfetch(`/api/scraper/sources/${sel.sourceId}/endpoints/${ep.endpointId}`, {
                                method: "PUT",
                                body: JSON.stringify({ sinkConfig: { bid_type: e.target.value } }),
                              }).catch((err) => setMsg(String(err)));
                              await loadDetail(sel.sourceId);
                            }}
                          >
                            <option value="order_plan">발주계획</option>
                            <option value="prior_spec">사전규격</option>
                            <option value="bid_notice">입찰공고</option>
                          </select>
                        )}
                        <span className="text-[11px] cd-text-faint whitespace-nowrap shrink-0">{ep.enabled ? "수집 대상" : "비활성"}</span>
                        <button type="button" onClick={() => toggleEndpoint(ep)} className="cd-btn cd-btn-soft text-[11px] shrink-0">
                          {ep.enabled ? "끄기" : "켜기"}
                        </button>
                        <button
                          type="button"
                          title="엔드포인트 삭제"
                          className="cd-btn cd-btn-soft text-[11px] shrink-0"
                          onClick={async () => {
                            if (!confirm(`엔드포인트 "${ep.name}"를 삭제할까요?`)) return;
                            await jfetch(`/api/scraper/sources/${sel.sourceId}/endpoints/${ep.endpointId}`, { method: "DELETE" }).catch((err) => setMsg(String(err)));
                            if (builderEpId === ep.endpointId) setBuilderEpId(null);
                            await loadDetail(sel.sourceId);
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button type="button" onClick={() => runEndpoint(ep, true)} disabled={busy} className="cd-btn cd-btn-soft text-[12px] disabled:opacity-50">
                          <Eye className="w-3.5 h-3.5" /> 미리보기
                        </button>
                        <button type="button" onClick={() => runEndpoint(ep, false)} disabled={busy} className="cd-btn cd-btn-primary text-[12px] disabled:opacity-50">
                          <Play className="w-3.5 h-3.5" /> 지금 수집
                        </button>
                        {canBuild && (
                          <button
                            type="button"
                            onClick={() => setBuilderEpId(building ? null : ep.endpointId)}
                            className={"cd-btn text-[12px] " + (building ? "cd-btn-primary" : "cd-btn-soft")}
                          >
                            <Settings2 className="w-3.5 h-3.5" /> {building ? "설정 닫기" : "설정"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const opening = backfillEpId !== ep.endpointId;
                            setBackfillEpId(opening ? ep.endpointId : null);
                            if (opening) {
                              setBfFrom(ep.backfill?.from ?? "");
                              setBfTo(ep.backfill?.to ?? "");
                              setBfMsg(null);
                              const st = ep.backfill;
                              setBfProgress(st?.from && st?.to && st?.cursor ? null : null);
                            }
                          }}
                          className={"cd-btn text-[12px] " + (backfillEpId === ep.endpointId ? "cd-btn-primary" : "cd-btn-soft")}
                        >
                          <History className="w-3.5 h-3.5" /> 백필
                        </button>
                      </div>
                      {backfillEpId === ep.endpointId && (
                        <div className="border-t cd-border-c pt-3 flex flex-col gap-2">
                          <p className="text-[11px] cd-text-faint">
                            과거 데이터를 월 단위로 끊어 순차 수집합니다(호출량 분산·중단 시 이어서 재개). 조회기간 필터가 설정된 엔드포인트에서만 동작합니다.
                            <br />※ 진행 중에는 이 화면을 열어 두세요 — 벗어나면 일시 정지되며, 진행 중 상태로 두면 야간배치가 매일 이어서 수집합니다.
                          </p>
                          <div className="flex items-center gap-2 flex-wrap text-[12px] cd-text-muted">
                            <input type="month" className="cd-input text-[12px]" style={{ width: 150 }} value={bfFrom} onChange={(e) => setBfFrom(e.target.value)} disabled={bfRunning} />
                            ~
                            <input type="month" className="cd-input text-[12px]" style={{ width: 150 }} value={bfTo} onChange={(e) => setBfTo(e.target.value)} disabled={bfRunning} />
                            {!bfRunning ? (
                              <button
                                type="button"
                                onClick={() => runBackfill(ep)}
                                disabled={busy || !bfFrom || !bfTo}
                                className="cd-btn cd-btn-primary text-[12px] disabled:opacity-50"
                              >
                                <Play className="w-3.5 h-3.5" />
                                {ep.backfill?.status === "idle" && ep.backfill?.from === bfFrom && ep.backfill?.to === bfTo ? "이어서 진행" : "백필 시작"}
                              </button>
                            ) : (
                              <button type="button" onClick={() => { bfStopRef.current = true; bfLoopRef.current = false; }} className="cd-btn cd-btn-danger text-[12px]">
                                중지
                              </button>
                            )}
                          </div>
                          {bfProgress && bfProgress.total > 0 && (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--cd-surface)" }}>
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{ width: `${Math.round((bfProgress.done / bfProgress.total) * 100)}%`, background: "var(--cd-primary)" }}
                                />
                              </div>
                              <span className="text-[11px] cd-text-faint whitespace-nowrap">{bfProgress.done}/{bfProgress.total}개월</span>
                            </div>
                          )}
                          {/* 실행 중 청크의 세부 진행 — 대량 월(1~2만 건)에서 멈춘 듯 보이지 않게 실시간 표시 */}
                          {bfChunk && (
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--cd-surface)" }}>
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width:
                                      bfChunk.phase === "save" && bfChunk.total
                                        ? `${Math.min(100, Math.round((bfChunk.items / bfChunk.total) * 100))}%`
                                        : "100%",
                                    background: bfChunk.phase === "save" ? "var(--cd-success)" : "var(--cd-secondary)",
                                    opacity: bfChunk.phase === "fetch" ? 0.5 : 1,
                                  }}
                                />
                              </div>
                              <span className="text-[11px] cd-text-faint whitespace-nowrap">
                                {bfChunk.chunk} · {bfChunk.phase === "fetch" ? "조회" : "저장"}{" "}
                                {bfChunk.items.toLocaleString()}
                                {bfChunk.phase === "save" && bfChunk.total ? `/${bfChunk.total.toLocaleString()}` : ""}건
                              </span>
                            </div>
                          )}
                          {bfMsg && <p className="text-[12px] cd-text-muted">{bfMsg}</p>}
                          {!bfMsg && ep.backfill?.last_result && (
                            <p className="text-[11px] cd-text-faint">
                              마지막 실행: {ep.backfill.last_result.chunk} — 신규 {ep.backfill.last_result.inserted ?? 0} / 스캔 {ep.backfill.last_result.scanned ?? 0}
                              {ep.backfill.status === "done" ? " · 완료" : ep.backfill.status === "idle" ? " · 중지됨" : ""}
                            </p>
                          )}
                        </div>
                      )}
                      {building && canBuild && (
                        <div className="border-t cd-border-c pt-3">
                          <EndpointConfigBuilder
                            profileEndpoints={profileEps}
                            purpose={isBid ? "bid" : "intel"}
                            initialEpName={ep.name}
                            initialConfig={ep.apiConfig}
                            initialFieldMapping={ep.fieldMapping}
                            busy={busy}
                            onSave={(name, config, fieldMapping) => saveEndpointConfig(ep, name, config, fieldMapping)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 미리보기 결과 */}
              {samples && (
                <div className="cd-card p-4 flex flex-col gap-2">
                  <h3 className="text-sm font-bold cd-text">미리보기 ({samples.length}건)</h3>
                  <div className="overflow-x-auto">
                    {isBid ? (
                      <table className="cd-table text-[12px] w-full">
                        <thead>
                          <tr>
                            <th className="text-left">발주기관</th>
                            <th className="text-left">사업명</th>
                            <th className="text-left">게시일</th>
                            <th className="text-left">마감</th>
                            <th className="text-left">조달방식</th>
                            <th className="text-left">원문</th>
                          </tr>
                        </thead>
                        <tbody>
                          {samples.map((s) => (
                            <tr key={s.externalId}>
                              <td className="truncate max-w-[140px]">{s.orgName ?? "-"}</td>
                              <td className="truncate max-w-[260px]">{s.title ?? "-"}</td>
                              <td>{s.postedAt ?? "-"}</td>
                              <td>{s.deadline ?? "-"}</td>
                              <td>{s.method ?? "-"}</td>
                              <td>
                                {s.url ? (
                                  <a href={s.url} target="_blank" rel="noreferrer" className="cd-text-muted hover:cd-text">
                                    열기
                                  </a>
                                ) : (
                                  "-"
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
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
                    )}
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
