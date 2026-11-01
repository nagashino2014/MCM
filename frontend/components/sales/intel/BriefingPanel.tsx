"use client";

// 브리핑 — 정기 발행본(목록 + 읽기)과 AI 질의(기존 질문형 RAG 화면, 구조 보존)를 한 탭에서 오간다.

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, History, RefreshCw, Send } from "lucide-react";
import { CdButton, CdModal, useCdashTheme, useCdToast } from "@/components/cdash";
import type { BriefingChannel, BriefingDelivery, BriefingProfile, BriefingRun } from "@/lib/intel/briefing-types";
import type { Briefing, IntelSignal } from "./intel-shared";
import { RagBoard } from "./RagBoard";
import { BriefingReportView } from "./BriefingReportView";
import { IntelCard, IntelChips, IntelEmpty, IntelError, IntelNotice, IntelTile } from "./intel-ui-kit";
import { BriefingTree } from "./BriefingTree";
import type { BriefingTreeIndustry } from "@/lib/intel/briefing-tree";
import { IntelSignalModal } from "./IntelSignalModal";
import { intelApi, intelTime, jsonBody, safeIntelUrl } from "./intelligence-client";

type View = "published" | "ask";
type RunDetail = { run: BriefingRun; briefing?: Briefing | null; deliveries: BriefingDelivery[] };
type RecipientUser = { userId: string; name: string };

export const RUN_STATUS: Record<BriefingRun["status"], string> = { queued: "실행 대기", waiting_sources: "자료 수집 대기", running: "작성 중", ready: "발행 준비", published: "발행", no_change: "새로운 주요 변동 없음", failed: "실패", blocked_budget: "AI 예산 한도", canceled: "취소" };
const ACTIVE = ["queued", "waiting_sources", "running", "ready"];
const DELIVERY: Record<BriefingDelivery["status"], string> = { pending: "대기", sending: "전달 중", sent: "전달 완료", failed: "실패", unknown: "전달 확인 필요", skipped: "생략" };
const CHANNEL: Record<BriefingChannel, string> = { inbox: "사내 메일함", email: "이메일", app: "앱 알림" };

export function RunStatusPill({ status }: { status: BriefingRun["status"] }) {
  if (status === "published") return null;
  const tone = status === "failed" || status === "blocked_budget" ? "cd-pill-error" : ACTIVE.includes(status) ? "cd-pill-info" : "cd-pill-idle";
  return <span className={`cd-pill ${tone} shrink-0`}>{status === "no_change" ? "변동 없음" : RUN_STATUS[status]}</span>;
}

export function BriefingPanel({ initialView, initialRunId, canViewSales, onOpenProject }: { initialView: View; initialRunId?: string | null; canViewSales: boolean; onOpenProject: (projectId: string) => void }) {
  const [view, setView] = useState<View>(initialView);
  return (
    <div className="flex flex-col gap-3 min-w-0">
      <IntelChips active={view} onChange={setView} items={[
        { key: "published" as View, label: "정기 발행본" },
        { key: "ask" as View, label: "AI 질의" },
      ]} />
      {view === "published"
        ? <PublishedBriefings initialRunId={initialRunId} canViewSales={canViewSales} onOpenProject={onOpenProject} />
        : <RagBoard embedded hideDiscovery />}
    </div>
  );
}

function PublishedBriefings({ initialRunId, canViewSales, onOpenProject }: { initialRunId?: string | null; canViewSales: boolean; onOpenProject: (projectId: string) => void }) {
  const { theme } = useCdashTheme();
  const { toast } = useCdToast();
  const [profiles, setProfiles] = useState<BriefingProfile[]>([]);
  const [runs, setRuns] = useState<BriefingRun[]>([]);
  const [users, setUsers] = useState<RecipientUser[]>([]);
  const [profileId, setProfileId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialRunId ?? null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [signal, setSignal] = useState<IntelSignal | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resendOpen, setResendOpen] = useState(false);
  const readerRef = useRef<HTMLDivElement>(null);
  const [listView, setListView] = useState<"tree" | "recent">("tree");
  const [tree, setTree] = useState<BriefingTreeIndustry[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  useEffect(() => {
    if (listView !== "tree") return;
    setTreeLoading(true);
    void intelApi<{ industries: BriefingTreeIndustry[] }>("/api/sales/rag/briefing-tree")
      .then((result) => setTree(result.industries))
      .catch((e) => setError((e as Error).message))
      .finally(() => setTreeLoading(false));
  }, [listView, runs.length]);
  /** 목록·트리에서 고른 회차를 연다. 좁은 화면에서는 보고서 위치로 내려간다. */
  const selectRun = (runId: string) => {
    setSelectedId(runId);
    if (window.matchMedia("(max-width: 1279px)").matches) readerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const reload = useCallback(async () => {
    try {
      const [p, r] = await Promise.all([
        intelApi<{ profiles: BriefingProfile[] }>("/api/sales/rag/profiles"),
        intelApi<{ runs: BriefingRun[] }>(`/api/sales/rag/runs${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ""}`),
      ]);
      setProfiles(p.profiles); setRuns(r.runs); setError("");
      setSelectedId((current) => current ?? r.runs.find((run) => run.status === "published")?.runId ?? r.runs[0]?.runId ?? null);
    } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [profileId]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { void intelApi<{ users: RecipientUser[] }>("/api/sales/rag/profiles/recipients").then((result) => setUsers(result.users)).catch(() => {}); }, []);

  const openRun = useCallback(async (id: string) => {
    try { setDetail(await intelApi<RunDetail>(`/api/sales/rag/runs/${encodeURIComponent(id)}`)); setError(""); }
    catch (e) { setDetail(null); setError((e as Error).message); }
  }, []);
  useEffect(() => { if (selectedId) void openRun(selectedId); }, [selectedId, openRun]);
  useEffect(() => {
    if (!runs.some((run) => ACTIVE.includes(run.status))) return;
    const timer = setInterval(() => { void reload(); if (selectedId) void openRun(selectedId); }, 15000);
    return () => clearInterval(timer);
  }, [runs, reload, selectedId, openRun]);

  async function retry(resendUnknown = false) {
    if (!detail) return;
    setBusy(true);
    try { await intelApi(`/api/sales/rag/runs/${detail.run.runId}/retry`, { method: "POST", ...jsonBody({ resendUnknown }) }); setResendOpen(false); await openRun(detail.run.runId); await reload(); toast("재시도를 요청했습니다.", "success"); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function openEvidence(id: string) {
    if (id.startsWith("project:")) { if (canViewSales) onOpenProject(id.slice(8)); else setError("프로젝트 상세를 열려면 영업 열람 권한이 필요합니다."); return; }
    if (!canViewSales || id.startsWith("official:")) {
      const url = safeIntelUrl(detail?.briefing?.sources?.find((item) => item.signalId === id)?.url);
      if (url) window.open(url, "_blank", "noopener,noreferrer"); else setError("열 수 있는 원문 링크가 없습니다.");
      return;
    }
    try { setSignal((await intelApi<{ signal: IntelSignal }>(`/api/sales/intel/signals/${encodeURIComponent(id)}`)).signal); }
    catch (e) { setError((e as Error).message); }
  }

  const canManage = !!detail && !!profiles.find((profile) => profile.profileId === detail.run.profileId)?.canManage;
  const run = detail?.run;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[640px_minmax(0,1fr)] gap-4 items-start">
      <IntelCard icon={History} title="발행 이력" count={runs.length || undefined} desc="관심 서비스·통합허가 업종·사업장으로 나눠 찾습니다. 숫자는 사업장별 발행 보고서 수입니다."
        actions={<IntelChips active={listView} onChange={setListView} items={[{ key: "tree" as const, label: "분류 보기" }, { key: "recent" as const, label: "최근 순" }]} />}>
        {listView === "tree" ? (
          <BriefingTree industries={tree} loading={treeLoading} selectedRunId={selectedId} onSelect={selectRun} />
        ) : <>
          <select className="cd-select w-full mb-2" aria-label="관심 분야" value={profileId} onChange={(event) => { setProfileId(event.target.value); setSelectedId(null); }}>
            <option value="">전체 관심 분야</option>
            {profiles.map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.name}</option>)}
          </select>
          {runs.length ? (
            <div className="flex flex-col gap-1.5 overflow-y-auto pr-0.5" style={{ maxHeight: "calc(100vh - 300px)" }}>
              {runs.map((item) => (
                <IntelTile key={item.runId} active={item.runId === selectedId} onClick={() => selectRun(item.runId)}>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="cd-text text-sm font-bold truncate flex-1">{item.profileName}</span>
                    <RunStatusPill status={item.status} />
                  </div>
                  <p className="cd-text-faint text-[11px] mt-0.5">{item.trigger === "scheduled" ? "정기" : "수동"} · {intelTime(item.scheduledFor)}</p>
                </IntelTile>
              ))}
            </div>
          ) : (
            <IntelEmpty>{loading ? "불러오는 중…" : "발행된 브리핑이 없습니다. 관심 설정에서 관심 분야를 등록하고 지금 생성을 누르세요."}</IntelEmpty>
          )}
        </>}
      </IntelCard>

      <div ref={readerRef} className="flex flex-col gap-4 min-w-0">
        {error && <IntelError>{error}</IntelError>}
        {run ? <>
          {run.error && <IntelError>{run.error}</IntelError>}
          {detail?.briefing
            ? <BriefingReportView briefing={detail.briefing} theme={theme} canOpenProject={canViewSales} onOpenSignal={(id) => void openEvidence(id)} />
            : <IntelCard icon={FileText} title={run.profileName} desc={`${run.trigger === "scheduled" ? "정기" : "수동"} · 기준 ${intelTime(run.scheduledFor)}`} actions={<RunStatusPill status={run.status} />}>
                <IntelNotice>{run.status === "no_change" ? "직전 발행 이후 새로운 주요 변동이 없어 보고서를 만들지 않았습니다." : ACTIVE.includes(run.status) ? "보고서를 작성하고 있습니다. 15초마다 상태를 확인합니다." : "열람할 보고서가 없습니다."}</IntelNotice>
              </IntelCard>}
          {detail && (detail.deliveries.length > 0 || canManage) && (
            <IntelCard icon={Send} title="전달 현황" desc={`${run.trigger === "scheduled" ? "정기" : "수동"} 실행 · 기준 ${intelTime(run.scheduledFor)} · ${RUN_STATUS[run.status]}`}
              actions={canManage && (run.status === "failed" || detail.deliveries.some((item) => item.status === "failed" || item.status === "unknown")) ? <>
                <button className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy} onClick={() => void retry()}><RefreshCw className="w-3.5 h-3.5" />실패 건 재시도</button>
                {detail.deliveries.some((item) => item.status === "unknown") && <button className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={() => setResendOpen(true)}>확인 필요 건 재전송</button>}
              </> : undefined}>
              {detail.deliveries.length ? (
                <div className="flex flex-col">
                  {detail.deliveries.map((item) => (
                    <div key={item.deliveryId} className="flex items-center gap-2 py-1.5 border-b cd-border-c last:border-b-0 text-sm">
                      <span className="cd-text font-bold flex-1 min-w-0 truncate">{users.find((user) => user.userId === item.userId)?.name ?? "알 수 없는 사용자"}</span>
                      <span className="cd-pill cd-pill-outline">{CHANNEL[item.channel]}</span>
                      <span className={`cd-pill ${item.status === "sent" ? "cd-pill-success" : item.status === "failed" ? "cd-pill-error" : item.status === "unknown" ? "cd-pill-warn" : "cd-pill-idle"}`} title={item.error ?? undefined}>{DELIVERY[item.status]}</span>
                    </div>
                  ))}
                </div>
              ) : <IntelEmpty>전달 대상이 없습니다.</IntelEmpty>}
            </IntelCard>
          )}
        </> : (
          <IntelCard icon={FileText} title="보고서"><IntelEmpty>{loading ? "불러오는 중…" : "왼쪽 목록에서 브리핑을 선택하세요."}</IntelEmpty></IntelCard>
        )}
      </div>

      <CdModal open={resendOpen} onClose={() => !busy && setResendOpen(false)} title="전달 확인 필요 건 재전송" footer={<><CdButton onClick={() => setResendOpen(false)} disabled={busy}>취소</CdButton><CdButton variant="primary" disabled={busy} onClick={() => void retry(true)}>재전송</CdButton></>}>
        <p className="cd-text text-sm leading-relaxed">발송 중 연결이 끊긴 건은 이미 전달되었을 수 있습니다. 채널 기록을 확인한 뒤 재전송하면 같은 알림이 다시 전달될 수 있습니다.</p>
      </CdModal>
      {signal && <IntelSignalModal signal={signal} theme={theme} onClose={() => setSignal(null)} onChanged={() => {}} onConverted={() => {}} canEdit={false} />}
    </div>
  );
}
