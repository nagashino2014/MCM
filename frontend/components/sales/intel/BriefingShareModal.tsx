"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RefreshCw, Send, Share2, X } from "lucide-react";
import OrganizationTree from "@/components/admin/users/OrganizationTree";
import type { OrganizationEmployeeRow, OrganizationSnapshot } from "@/components/admin/users/types";
import type { BriefingShareChannel as ShareChannel, BriefingShareDelivery as Delivery, BriefingShareResult as ShareResult } from "@/lib/intel/briefing-share-types";

const CHANNEL: Record<ShareChannel, string> = { shared: "RAG 공유 목록", inbox: "앱 메일함", push: "모바일 푸시", messenger: "메신저" };
const STATUS: Record<Delivery["status"], string> = { pending: "대기", sending: "전송 중", sent: "완료", failed: "실패", skipped: "생략", unknown: "전달 확인 필요" };

export function BriefingShareModal({ briefingId, theme, onClose }: { briefingId: string; theme: string; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [picks, setPicks] = useState<Array<{ userId: string; name: string }>>([]);
  const [channels, setChannels] = useState<ShareChannel[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ShareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windowNotice, setWindowNotice] = useState<string | null>(null);
  const requestKey = useRef<string | null>(null);
  const openedRooms = useRef(new Set<number>());
  const dialog = useRef<HTMLDivElement | null>(null);
  const close = useRef(onClose); close.current = onClose;
  const endpoint = `/api/sales/rag/briefings/${encodeURIComponent(briefingId)}/share`;
  const pending = !!result?.deliveries.some(item => item.status === "pending" || item.status === "sending");
  const canRetry = !!result?.deliveries.some(item => item.status === "failed");
  const locked = busy || result !== null;

  useEffect(() => {
    let active = true;
    void fetch(`${endpoint}?recipients=1`, { cache: "no-store" }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "공유할 수 있는 인원을 불러오지 못했습니다.");
      if (active) setSnapshot(data.snapshot);
    }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [endpoint]);
  useEffect(() => {
    if (!pending || !result?.requestId) return;
    const timer = setInterval(() => {
      void fetch(`${endpoint}?requestId=${encodeURIComponent(result.requestId)}`, { cache: "no-store" }).then(async response => {
        const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "전달 상태를 확인하지 못했습니다."); setResult(data);
      }).catch(e => setError(e.message));
    }, 3000);
    return () => clearInterval(timer);
  }, [endpoint, pending, result?.requestId]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const targets = () => [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),a[href],[tabindex="0"]') ?? [])].filter(element => element.getClientRects().length);
    targets()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); close.current(); return; }
      if (event.key !== "Tab") return;
      const focusable = targets(), first = focusable[0], last = focusable[focusable.length - 1];
      if (!first) return;
      if (!dialog.current?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); }
    };
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("keydown", key, true); document.body.style.overflow = previousOverflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { for (const item of result?.deliveries ?? []) if (item.channel === "messenger" && item.status === "sent" && Number.isSafeInteger(item.roomId) && Number(item.roomId) > 0 && !openedRooms.current.has(Number(item.roomId))) { openedRooms.current.add(Number(item.roomId)); openMessenger(Number(item.roomId)); } }, [result]);

  function openMessenger(roomId: number) {
    const chat = window.open(`/m-app/chat/${roomId}`, `mcm-chat-${roomId}`);
    if (chat) { chat.opener = null; chat.focus(); setWindowNotice(null); }
    else setWindowNotice("메신저로 전달했습니다. 창이 열리지 않으면 아래 ‘메신저에서 보기’를 눌러 주세요.");
  }

  function toggle(emp: OrganizationEmployeeRow) {
    if (locked || !emp.userId) return;
    const userId = emp.userId;
    requestKey.current = null;
    setPicks(previous => previous.some(pick => pick.userId === userId) ? previous.filter(pick => pick.userId !== userId) : [...previous, { userId, name: emp.name }]);
  }
  async function share() {
    if (!picks.length || busy || pending || (result && !canRetry)) return;
    setBusy(true); setError(null); requestKey.current ??= crypto.randomUUID();
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestKey: requestKey.current, recipients: picks, channels: ["shared", ...channels] }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "공유 요청을 완료하지 못했습니다."); setResult(data);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function startNew() { requestKey.current = null; setResult(null); setPicks([]); setChannels([]); setError(null); setWindowNotice(null); }

  if (typeof document === "undefined") return null;
  return createPortal(<div className="cdash-vars cd-fields-white fixed inset-0 z-[140] flex items-center justify-center p-4" data-theme={theme} style={{ background: "rgba(16,22,36,0.45)" }} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="briefing-share-title" className="cd-card-bg rounded-[10px] border cd-border-c w-full max-w-md flex flex-col" style={{ maxHeight: "86vh" }}>
      <div className="flex items-center gap-2 px-5 py-4 border-b cd-border-c"><Share2 className="w-4 h-4 cd-text-faint" /><h3 id="briefing-share-title" className="cd-text text-base font-semibold flex-1">브리핑 공유</h3><button className="cd-btn cd-btn-ghost cd-btn-sm" aria-label="닫기" onClick={onClose}><X className="w-4 h-4" /></button></div>
      <div className="px-5 py-4 flex flex-col gap-3 overflow-y-auto">
        <p className="cd-text-muted text-xs">브리핑을 볼 수 있는 인원을 선택하세요. 선택한 인원의 공유받은 브리핑 목록에 항상 등록됩니다.</p>
        {error && <div role="alert" className="cd-error-bg cd-error-text rounded-[10px] px-3 py-2 text-xs">{error}</div>}
        {windowNotice && <p className="cd-text-muted text-xs">{windowNotice}</p>}
        <fieldset disabled={locked} className="flex flex-col gap-2"><legend className="cd-text text-xs font-semibold mb-2">전달 방법</legend>
          <label className="flex items-center gap-2 cd-text text-xs"><input type="checkbox" checked disabled />RAG 공유 목록 (항상 등록)</label>
          {(["inbox", "push", "messenger"] as const).map(channel => <label key={channel} className="flex items-center gap-2 cd-text text-xs"><input type="checkbox" checked={channels.includes(channel)} onChange={event => { requestKey.current = null; setChannels(previous => event.target.checked ? [...previous, channel] : previous.filter(item => item !== channel)); }} />{CHANNEL[channel]}</label>)}
        </fieldset>
        <p className="cd-text-faint text-xs">메신저는 기존 1:1 대화방에 보고서 링크를 보냅니다. 대화방이 없으면 새로 만듭니다.</p>
        <div className="flex flex-wrap gap-1">{picks.map(pick => <span key={pick.userId} className="cd-action cd-pill cd-pill-info inline-flex items-center gap-1">{pick.name}<button disabled={locked} aria-label={`${pick.name} 선택 해제`} onClick={() => { requestKey.current = null; setPicks(previous => previous.filter(item => item.userId !== pick.userId)); }}><X className="w-3 h-3" /></button></span>)}{!picks.length && <span className="cd-text-faint text-xs">선택된 인원이 없습니다.</span>}</div>
        {!locked && (loading ? <p className="cd-text-faint text-sm p-4 text-center">공유할 인원을 불러오는 중…</p> : snapshot?.employees.length ? <OrganizationTree snapshot={snapshot} embedded title="조직도" onSelectEmployee={toggle} /> : <p className="cd-text-faint text-sm p-4 text-center">공유할 수 있는 인원이 없습니다.</p>)}
        {result && <section aria-label="공유 결과" className="flex flex-col gap-2"><p className="cd-text text-xs font-semibold">공유 목록 등록 {result.shared}명 · 전달 완료 {result.summary.sent}건{result.summary.failed ? ` · 실패 ${result.summary.failed}건` : ""}{result.summary.skipped ? ` · 생략 ${result.summary.skipped}건` : ""}{result.summary.unknown ? ` · 확인 필요 ${result.summary.unknown}건` : ""}{result.summary.pending ? ` · 대기 ${result.summary.pending}건` : ""}</p>
          {result.deliveries.map(item => <div key={item.deliveryId} className="border-b cd-border-c py-2 text-xs"><p className="cd-text">{picks.find(pick => pick.userId === item.userId)?.name ?? "수신자"} · {CHANNEL[item.channel]} · {STATUS[item.status]}</p>{item.error && <p className="cd-text-muted mt-1">{item.error}</p>}{item.channel === "messenger" && item.status === "sent" && Number.isSafeInteger(item.roomId) && Number(item.roomId) > 0 && <button className="cd-text mt-1 inline-block underline" onClick={() => openMessenger(Number(item.roomId))}>메신저에서 보기</button>}</div>)}
          {result.summary.unknown > 0 && <p className="cd-text-muted text-xs">전달 확인 필요 항목은 이미 도착했을 수 있어 자동으로 다시 보내지 않습니다.</p>}
        </section>}
      </div>
      <div className="flex items-center justify-end gap-2 px-5 py-4 border-t cd-border-c">{result && <button className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy || pending} onClick={startNew}>새 공유 설정</button>}<button className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>닫기</button><button className="cd-btn cd-btn-primary cd-btn-sm" disabled={busy || pending || !picks.length || (!!result && !canRetry)} onClick={() => void share()}>{busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}{busy ? "공유 중…" : result ? canRetry ? "실패 전송 재시도" : pending ? "전달 확인 중…" : result.ok ? "공유 완료" : "전달 결과 확인" : `공유 (${picks.length}명)`}</button></div>
    </div>
  </div>, document.body);
}
