"use client";

// 브리핑 — 정기 발행본(목록 + 읽기)과 AI 질의(기존 질문형 RAG 화면, 구조 보존)를 한 탭에서 오간다.

import { useCallback, useEffect, useRef, useState } from "react";
import { CdBadge, CdButton, CdModal, CdSelect, CdTable, CdTabs, useCdashTheme, useCdToast } from "@/components/cdash";
import type { BriefingChannel, BriefingDelivery, BriefingProfile, BriefingRun } from "@/lib/intel/briefing-types";
import type { Briefing, IntelSignal } from "./intel-shared";
import { RagBoard } from "./RagBoard";
import { ScheduledBriefingReport } from "./ScheduledBriefingReport";
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
  const tone = status === "failed" || status === "blocked_budget" ? "error" : ACTIVE.includes(status) ? "info" : "idle";
  return <CdBadge tone={tone}>{status === "no_change" ? "변동 없음" : RUN_STATUS[status]}</CdBadge>;
}

export function BriefingPanel({ initialView, initialRunId, canViewSales, onOpenProject }: { initialView: View; initialRunId?: string | null; canViewSales: boolean; onOpenProject: (projectId: string) => void }) {
  const [view, setView] = useState<View>(initialView);
  return (
    <div className="intel-stack">
      <CdTabs variant="underline" active={view} onChange={setView} items={[
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
  const readerRef = useRef<HTMLElement>(null);

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
    <div className="intel-split">
      <section className="cd-card">
        <div className="intel-card-head">
          <div><h2 className="intel-section">발행 이력</h2><span className="intel-table cd-text-muted">{runs.length}건</span></div>
        </div>
        <div className="intel-toolbar">
          <CdSelect label="관심 분야" value={profileId} className="w-full" onChange={(event) => { setProfileId(event.target.value); setSelectedId(null); }}>
            <option value="">전체 관심 분야</option>
            {profiles.map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.name}</option>)}
          </CdSelect>
        </div>
        <div className="intel-split-list">
          {runs.length ? (
            <ul className="intel-rows">
              {runs.map((item) => (
                <li key={item.runId}>
                  <button type="button" className="intel-row-item" aria-current={item.runId === selectedId} onClick={() => { setSelectedId(item.runId); if (window.matchMedia("(max-width: 1199px)").matches) readerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
                    <div className="intel-row-main">
                      <p className="intel-row-title">{item.profileName}</p>
                      <p className="intel-row-meta">{item.trigger === "scheduled" ? "정기" : "수동"} · {intelTime(item.scheduledFor)}</p>
                    </div>
                    <div className="intel-row-side"><RunStatusPill status={item.status} /></div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="intel-empty">{loading ? "불러오는 중…" : "발행된 브리핑이 없습니다. 관심 설정에서 관심 분야를 등록하고 지금 생성을 누르세요."}</p>
          )}
        </div>
      </section>

      <section ref={readerRef} className="cd-card min-w-0">
        {error && <div className="intel-card-body pt-5"><div className="intel-error" role="alert">{error}</div></div>}
        {run ? <>
          <div className="intel-card-head">
            <div className="flex-col !items-start">
              <h2 className="intel-section">{detail?.briefing?.question ?? run.profileName}</h2>
              <p className="intel-table cd-text-muted">{run.trigger === "scheduled" ? "정기" : "수동"} · 기준 {intelTime(run.scheduledFor)}{run.status !== "published" ? ` · ${RUN_STATUS[run.status]}` : ""}</p>
            </div>
            {canManage && (run.status === "failed" || detail?.deliveries.some((item) => item.status === "failed" || item.status === "unknown")) && (
              <div className="flex gap-2">
                <CdButton size="sm" disabled={busy} onClick={() => void retry()}>실패 건 재시도</CdButton>
                {detail?.deliveries.some((item) => item.status === "unknown") && <CdButton size="sm" variant="ghost" disabled={busy} onClick={() => setResendOpen(true)}>확인 필요 건 재전송</CdButton>}
              </div>
            )}
          </div>
          <div className="intel-card-body intel-stack">
            {run.error && <div className="intel-error" role="alert">{run.error}</div>}
            {detail?.briefing
              ? <ScheduledBriefingReport briefing={detail.briefing} onOpenSource={(id) => void openEvidence(id)} canOpenProject={canViewSales} />
              : <p className="intel-notice">{run.status === "no_change" ? "직전 발행 이후 새로운 주요 변동이 없어 보고서를 만들지 않았습니다." : ACTIVE.includes(run.status) ? "보고서를 작성하고 있습니다. 15초마다 상태를 확인합니다." : "열람할 보고서가 없습니다."}</p>}
            {detail && detail.deliveries.length > 0 && <section className="intel-subsection">
              <h3 className="intel-section mb-3">전달 현황</h3>
              <CdTable bare rows={detail.deliveries} rowKey={(item) => item.deliveryId} columns={[
                { key: "user", header: "수신자", render: (item) => users.find((user) => user.userId === item.userId)?.name ?? "알 수 없는 사용자" },
                { key: "channel", header: "채널", render: (item) => CHANNEL[item.channel] },
                { key: "status", header: "상태", render: (item) => item.status === "failed" ? <CdBadge tone="error" title={item.error ?? undefined}>실패</CdBadge> : item.status === "unknown" ? <CdBadge tone="warn">확인 필요</CdBadge> : DELIVERY[item.status] },
              ]} />
            </section>}
          </div>
        </> : <p className="intel-empty">{loading ? "불러오는 중…" : "왼쪽 목록에서 브리핑을 선택하세요."}</p>}
      </section>

      <CdModal open={resendOpen} onClose={() => !busy && setResendOpen(false)} title="전달 확인 필요 건 재전송" footer={<><CdButton onClick={() => setResendOpen(false)} disabled={busy}>취소</CdButton><CdButton variant="primary" disabled={busy} onClick={() => void retry(true)}>재전송</CdButton></>}>
        <p className="intel-ui intel-prose">발송 중 연결이 끊긴 건은 이미 전달되었을 수 있습니다. 채널 기록을 확인한 뒤 재전송하면 같은 알림이 다시 전달될 수 있습니다.</p>
      </CdModal>
      {signal && <IntelSignalModal signal={signal} theme={theme} onClose={() => setSignal(null)} onChanged={() => {}} onConverted={() => {}} canEdit={false} />}
    </div>
  );
}
