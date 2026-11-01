import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { CdButton, CdModal, CdTable, CdToastProvider, useCdashTheme } from "@/components/cdash";
import { SalesIntelligenceBoard } from "@/components/sales/intel/SalesIntelligenceBoard";
import { intelApi, intelTime } from "@/components/sales/intel/intelligence-client";
import "@/app/globals.css";

type LocalMeta = { mode: "real" | "demo"; useStoredData?: boolean; aiConfigured: boolean; aiModel: string; counts: { signals: number; projects: number; sourceDocuments: number }; import: { importedAt: string; lookbackDays: number; importedSignals: number; sourceTotal: number; coverage: unknown } | null; lastAiCall: { model: string; status: string; costUsd: number | null; calledAt: string } | null };

function LocalChat({ roomId }: { roomId: string }) {
  const { theme, toggleTheme } = useCdashTheme();
  const [room, setRoom] = useState<{ name: string | null; messages: Array<{ messageId: number; senderName: string; body: string; sharedRecord?: { id: string; title: string; href: string } | null }> } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    window.name = `mcm-chat-${roomId}`;
    const refresh = () => void intelApi<NonNullable<typeof room>>(`/api/local-demo/chat/${roomId}`).then(value => { setRoom(value); setError(""); }).catch(error => setError(error.message));
    refresh(); const timer = setInterval(refresh, 3000); return () => clearInterval(timer);
  }, [roomId]);
  return <main className="cdash cd-fields-white intel-ui min-h-screen p-5" data-theme={theme}><section className="cd-card p-5"><div className="flex justify-between gap-4 mb-5"><h1 className="intel-section">{room?.name || "브리핑 공유 대화방"}</h1><CdButton onClick={toggleTheme}>{theme === "dark" ? "라이트 모드" : "다크 모드"}</CdButton></div><p className="intel-table cd-text-muted mb-5">로컬 시험 대화방 · 공유 메시지를 실제 DB에서 조회합니다.</p>{error ? <p role="alert" className="intel-error">{error}</p> : room?.messages.map(message => <article key={message.messageId} className="intel-row"><p className="intel-table cd-text-muted mb-3">{message.senderName}</p>{message.sharedRecord && message.sharedRecord.href === `/sales/rag?briefingId=${encodeURIComponent(message.sharedRecord.id)}` ? <a className="cd-action intel-link inline-flex p-3" href={message.sharedRecord.href} target="_blank" rel="noreferrer">공유 브리핑 · {message.sharedRecord.title}</a> : <p className="intel-prose whitespace-pre-wrap">{message.body}</p>}</article>)}</section></main>;
}
const AI_CALL_STATUS_LABELS: Record<string, string> = { ok: "정상", error: "오류", timeout: "시간 초과", refusal: "응답 거절", truncated: "응답 길이 제한", budget_blocked: "예산 한도 초과", disabled: "사용 중지" };
function Demo() {
  const { theme, toggleTheme } = useCdashTheme();
  const [inbox, setInbox] = useState<Array<{ messageId: string; subject: string; bodyText: string; receivedAt: string }> | null>(null);
  const [linked, setLinked] = useState<{ project: Record<string, unknown>; activities: Record<string, unknown>[] } | null>(null);
  const [error, setError] = useState("");
  const [meta, setMeta] = useState<LocalMeta | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const linkedId = window.location.pathname.match(/^\/sales\/([^/]+)$/)?.[1];
  useEffect(() => { if (linkedId && linkedId !== "rag") void intelApi<typeof linked>(`/api/local-demo/sales/${encodeURIComponent(linkedId)}`).then(setLinked).catch((error) => setError(error.message)); }, [linkedId]);
  useEffect(() => { const refresh = () => void intelApi<LocalMeta>("/api/local-demo/meta").then(setMeta).catch((error) => setError(error.message)); refresh(); const timer = setInterval(refresh, 15000); return () => clearInterval(timer); }, []);
  async function refreshData() { setRefreshing(true); setError(""); try { await intelApi("/api/local-demo/refresh-data", { method: "POST", body: "{}" }); window.location.reload(); } catch (error) { setError((error as Error).message); } finally { setRefreshing(false); } }
  async function openInbox() { try { setInbox((await intelApi<{ messages: NonNullable<typeof inbox> }>("/api/local-demo/inbox")).messages); setError(""); } catch (error) { setError((error as Error).message); } }
  return <main className="cdash cd-fields-white intel-ui min-h-screen p-5" data-theme={theme}>
    <section className="cd-card p-5 mb-5"><div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="intel-section">{!meta ? "로컬 실증 상태 확인 중" : meta.mode === "real" ? "실제 수집 자료 · AI 브리핑 로컬 실증" : "로컬 실증 · 가상 자료"}</h1><p className="intel-prose cd-text-muted mt-2">{meta?.mode === "real" ? "기존 수집 DB의 공개 자료와 공식 정보원을 분석해 AI가 보고서를 작성합니다. 생성·수정 결과는 이 컴퓨터에 저장되며 전달은 로컬 수신함을 사용합니다." : meta ? "입력은 이 컴퓨터의 시험 DB에 저장됩니다. 예시 보고서는 AI를 호출하지 않으며 이메일·앱 발송과 실제 정보 수집은 연결하지 않았습니다." : "자료와 AI 연결 상태를 확인하고 있습니다."}</p>{meta?.mode === "real" && <><p className="intel-table cd-text-muted mt-2">가져온 신호 {meta.counts.signals.toLocaleString()}건 · 투자 프로젝트 {meta.counts.projects.toLocaleString()}개 · 공식 자료 {meta.counts.sourceDocuments}건 · {meta.aiConfigured ? meta.aiModel : "AI 인증 설정 필요"}</p>{meta.import && <p className="intel-table cd-text-muted mt-2">자료 갱신 {intelTime(meta.import.importedAt)} · 최근 {meta.import.lookbackDays}일 원본 {meta.import.sourceTotal.toLocaleString()}건 중 {meta.import.importedSignals.toLocaleString()}건 · 비뉴스 우선, 뉴스 최신순</p>}{meta.lastAiCall && <p className="intel-table cd-text-muted mt-2">최근 AI 호출 {intelTime(meta.lastAiCall.calledAt)} · {AI_CALL_STATUS_LABELS[meta.lastAiCall.status] ?? "상태 확인 필요"} · {meta.lastAiCall.costUsd == null ? "비용 집계 대기" : `$${meta.lastAiCall.costUsd.toFixed(4)}`}</p>}</>}<p className="intel-table cd-text-muted mt-2">실증 사용자: 로컬 담당자 · 정기 예약 확인: 30초마다</p></div><div className="flex flex-wrap gap-2">{meta?.mode === "real" && <CdButton disabled={refreshing} onClick={() => void refreshData()}>{refreshing ? "자료 갱신 중…" : "수집 DB 자료 갱신"}</CdButton>}<CdButton onClick={() => void openInbox()}>시험 수신함</CdButton><CdButton onClick={toggleTheme}>{theme === "dark" ? "라이트 모드" : "다크 모드"}</CdButton></div></div></section>
    {meta?.mode === "real" && meta.useStoredData && <p className="intel-prose cd-text-muted mb-5">보존된 실제 수집 자료를 사용 중입니다. 최신 자료를 갱신하려면 원본 DB 로그인을 다시 연결해야 합니다.</p>}
    {error && <p className="intel-error mb-5" role="alert">{error}</p>}
    {linkedId && linkedId !== "rag" ? <section className="cd-card p-5"><a className="intel-link" href="/sales/rag?tab=projects">투자 프로젝트로 돌아가기</a><h2 className="intel-section mt-5 mb-5">영업 연결 결과</h2>{linked ? <><p className="font-medium">{String(linked.project.title ?? "영업건")}</p><p className="intel-prose cd-text-muted mt-2">여기에 표시한 영업건과 활동은 시험 DB에 실제 저장된 내용입니다.</p><CdTable bare className="mt-5" rows={linked.activities} rowKey={(item) => String(item.activityId ?? item.activity_id)} columns={[{ key: "title", header: "활동", render: (item) => String(item.summary ?? item.title ?? "") }, { key: "type", header: "유형", render: (item) => String(item.activityType ?? item.activity_type ?? "") }, { key: "status", header: "상태", render: (item) => String(item.status ?? "") }, { key: "date", header: "일정 (KST)", render: (item) => String(item.scheduledAt ?? item.scheduled_at ?? "") }]} /></> : <p>불러오는 중…</p>}</section> : <SalesIntelligenceBoard />}
    <CdModal open={inbox !== null} onClose={() => setInbox(null)} title="시험 수신함" size="lg"><div className="intel-ui intel-form">{inbox?.length ? inbox.map((message) => <article key={message.messageId} className="intel-row"><h3 className="font-medium">{message.subject}</h3><p className="intel-table cd-text-muted mt-2">{intelTime(message.receivedAt)}</p><p className="intel-prose whitespace-pre-wrap mt-3">{message.bodyText}</p></article>) : <p>아직 수신한 자료가 없습니다. 정기 브리핑에서 관심 분야를 선택하고 지금 생성해 보세요.</p>}</div></CdModal>
  </main>;
}
const chatRoomId = window.location.pathname.match(/^\/m-app\/chat\/(\d+)$/)?.[1];
createRoot(document.getElementById("root")!).render(<CdToastProvider>{chatRoomId ? <LocalChat roomId={chatRoomId} /> : <Demo />}</CdToastProvider>);
