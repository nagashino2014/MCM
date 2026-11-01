"use client";

// 용역 제안서 [AI로 고치기](P1, docs/proposal-ai-editing-plan.md §3) — 블록·쪽에 지시 → 서버가 op 를 검증해 제안 →
// 쪽 넘침 실측(넘치면 넘침 문구 줄이기 1~2회) → 전·후와 검토 표시 → 미리보기에서 보기 → 고른 것만 채택(실행 취소 한 단계).
// 채택 직전 원문 대조로, 기다리는 동안 사용자가 고친 칸은 덮어쓰지 않는다. 응답 원문은 저장하지 않는다.
import { useEffect, useRef, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdHelp } from "@/components/cdash/CdHelp";
import { AI_ACTIONS, applyOps, hasReview, type AiAction, type AiScope, type CheckedOp } from "@/lib/proposal/ai/ops";
import type { ProposalAiResult } from "@/lib/proposal/ai/service";
import { measurePageOverflow } from "@/lib/proposal/measure";
import type { ProposalBlock, ProposalDocument } from "@/lib/proposal/types";
import type { StudioKit } from "../catalog/studio/kit";

export interface AiTarget { scope: AiScope; sectionId: string; blockId?: string; label: string }
type Phase = "idle" | "asking" | "checking" | "fitting" | "done";
interface FitState { over: boolean; wasOver: boolean; rounds: number; note?: string }

async function post<T>(url: string, body: unknown, signal?: AbortSignal, method = "POST"): Promise<T> {
  const r = await fetch(url, { method, cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.error === "string" ? data.error : `요청 실패 (${r.status})`);
  return data as T;
}

/** 서버로 보내는 쪽 — 그림 데이터는 빼서 본문을 작게(서버는 글만 본다) */
function sectionForRequest(doc: ProposalDocument, sid: string) {
  const s = doc.sections.find((x) => x.id === sid);
  return s && { ...s, blocks: s.blocks.map((b): ProposalBlock => (b.kind === "image" ? { ...b, dataUrl: "" } : b)) };
}

/** 줄이기 대상 글 — 칸 고치기 값, 새 블록의 본문·개조식 줄 */
function fitItems(ops: CheckedOp[], ratio: number) {
  const out: Array<{ key: string; text: string; maxChars: number }> = [];
  const add = (key: string, text: string) => { const n = text.replace(/\s/g, "").length; if (n >= 16) out.push({ key, text, maxChars: Math.max(8, Math.floor(n * ratio)) }); };
  for (const o of ops) {
    if (o.op === "set" && o.value) add(`${o.key}|v`, o.value);
    const b = o.next;
    if (!b) continue;
    if (b.kind === "text" || b.kind === "lead" || b.kind === "callout") add(`${o.key}|text`, b.text);
    if (b.kind === "bullets") b.items.forEach((it, i) => add(`${o.key}|i${i}`, it.text));
    if (b.kind === "cards" || b.kind === "steps") b.items.forEach((it, i) => add(`${o.key}|b${i}`, it.body));
  }
  return out;
}
function withFitted(ops: CheckedOp[], got: Map<string, string>): CheckedOp[] {
  return ops.map((o) => {
    if (o.op === "set" && got.has(`${o.key}|v`)) { const v = got.get(`${o.key}|v`)!; return { ...o, value: v, afterLines: [v] }; }
    const b = o.next;
    if (!b) return o;
    let next: ProposalBlock = b;
    if ((b.kind === "text" || b.kind === "lead" || b.kind === "callout") && got.has(`${o.key}|text`)) next = { ...b, text: got.get(`${o.key}|text`)! };
    if (b.kind === "bullets") next = { ...b, items: b.items.map((it, i) => ({ ...it, text: got.get(`${o.key}|i${i}`) ?? it.text })) };
    if (b.kind === "cards" || b.kind === "steps") next = { ...b, items: b.items.map((it, i) => ({ ...it, body: got.get(`${o.key}|b${i}`) ?? it.body })) };
    return next === b ? o : { ...o, next };
  });
}

export function ProposalAiPanel({ target, doc, kit, previewing, onPreview, onAccept, onClose }: {
  target: AiTarget;
  doc: ProposalDocument;
  kit: StudioKit | null;
  previewing: boolean;
  /** 제안을 얹은 문서를 미리보기에(null = 미리보기 끝) */
  onPreview: (next: ProposalDocument | null) => void;
  onAccept: (next: ProposalDocument, note: string) => void;
  onClose: () => void;
}) {
  const [action, setAction] = useState<AiAction>("polish");
  const [instruction, setInstruction] = useState(AI_ACTIONS[0].instruction);
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<ProposalAiResult | null>(null);
  const [ops, setOps] = useState<CheckedOp[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [fit, setFit] = useState<FitState | null>(null);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const docRef = useRef(doc); docRef.current = doc;
  useEffect(() => () => abort.current?.abort(), []);
  const busy = phase === "asking" || phase === "checking" || phase === "fitting";
  const chosen = ops.filter((o) => picked.has(o.key));

  const ask = async () => {
    abort.current?.abort();
    const ctl = new AbortController(); abort.current = ctl;
    setPhase("asking"); setError(""); setResult(null); setOps([]); setFit(null);
    try {
      const d = docRef.current;
      const i = d.sections.findIndex((s) => s.id === target.sectionId);
      const { sections: _s, ...context } = d;
      const r = await post<ProposalAiResult>("/api/sales/proposals/ai/edit", {
        context, section: sectionForRequest(d, target.sectionId), scope: target.scope, blockId: target.blockId, action, instruction,
        neighbors: { prev: d.sections[i - 1]?.title, next: d.sections[i + 1]?.title },
      }, ctl.signal);
      setResult(r); setOps(r.ops); setPicked(new Set(r.ops.map((o) => o.key)));
      if (!r.ops.length || !kit) { setPhase("done"); return; }
      // 쪽 넘침 실측 — 넘치면 줄이기 0.85 → 0.7
      setPhase("checking");
      const was = await measurePageOverflow(kit, d, target.sectionId);
      let cur = r.ops;
      let m = await measurePageOverflow(kit, applyOps(d, cur).doc, target.sectionId);
      let rounds = 0;
      for (const ratio of [0.85, 0.7]) {
        if (!m.over || ctl.signal.aborted) break;
        const items = fitItems(cur, ratio);
        if (!items.length) break;
        setPhase("fitting"); rounds++;
        const f = await post<{ items: Array<{ key: string; text: string }> }>("/api/sales/proposals/ai/fit", { items, subject: `${d.id}:${target.sectionId}` }, ctl.signal);
        cur = withFitted(cur, new Map(f.items.map((x) => [x.key, x.text])));
        m = await measurePageOverflow(kit, applyOps(d, cur).doc, target.sectionId);
      }
      setOps(cur);
      setFit({ over: m.over, wasOver: was.over, rounds, note: m.over ? (was.over ? "원래도 넘치던 쪽입니다. 채택한 뒤 [다음 쪽으로 넘기기]나 직접 줄이기로 정리하세요." : "이 제안을 채택하면 쪽이 넘칩니다. 고를 곳을 줄이거나 [줄이기]로 다시 받아 보세요.") : undefined });
      setPhase("done");
    } catch (e) {
      if (ctl.signal.aborted) return;
      setError(e instanceof Error ? e.message : "제안을 받지 못했습니다."); setPhase("idle");
    }
  };

  const accept = () => {
    const { doc: next, applied, stale } = applyOps(docRef.current, chosen);
    if (!applied.length) { setError(stale.length ? "기다리는 동안 이 칸들이 바뀌어 적용하지 않았습니다. 다시 받아 주세요." : "고른 곳이 없습니다."); onPreview(null); return; }
    const review = applied.filter(hasReview).length;
    onAccept(next, `AI 제안 ${applied.length}곳을 적용했습니다.${stale.length ? ` 기다리는 동안 바뀐 ${stale.length}곳은 건너뛰었습니다.` : ""}${review ? ` 검토 표시 ${review}곳을 확인해 주세요.` : ""} Ctrl+Z 로 한 번에 되돌릴 수 있습니다.`);
    void post("/api/sales/proposals/ai/edit", { documentId: docRef.current.id, applied: applied.length, review, stale: stale.length, source: result?.source, action, scope: target.scope }, undefined, "PUT").catch(() => undefined);
  };
  const preview = () => onPreview(applyOps(docRef.current, chosen).doc);
  const pick = (k: string, on: boolean) => setPicked((p) => { const n = new Set(p); if (on) n.add(k); else n.delete(k); return n; });
  const close = () => { abort.current?.abort(); onPreview(null); onClose(); };

  if (previewing) {
    return <div className="proposal-ai-banner cdash-vars" role="region" aria-label="AI 제안 미리보기">
      <Sparkles size={15} /><span><b>AI 제안을 미리보기에 얹었습니다</b> — {chosen.length}곳. 편집은 잠시 멈춥니다.</span>
      <button type="button" className="cd-btn cd-btn-primary" onClick={accept}>채택</button>
      <button type="button" className="cd-btn" onClick={() => onPreview(null)}>검토로 돌아가기</button>
      <button type="button" className="cd-btn cd-btn-ghost" onClick={close}>거절</button>
    </div>;
  }

  const status = phase === "asking" ? (target.scope === "page" ? "쪽 전체를 읽고 제안을 만드는 중입니다(30초~1분)." : "제안을 만드는 중입니다.") : phase === "checking" ? "쪽 넘침을 재는 중입니다." : phase === "fitting" ? "넘친 문구를 줄이는 중입니다." : "";
  return <CdModal open onClose={close} size="xl" title={<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Sparkles size={16} />AI로 고치기 · {target.label}<CdHelp topic="sales.proposals" /></span>}
    footer={<div className="proposal-ai-foot">
      {result ? <button type="button" className="cd-btn" disabled={busy} onClick={ask}>다시 받기</button> : null}
      <span style={{ flex: 1 }} />
      <button type="button" className="cd-btn" onClick={close}>닫기</button>
      {ops.length ? <>
        <button type="button" className="cd-btn" disabled={busy || !chosen.length} onClick={preview}>미리보기에서 보기</button>
        <button type="button" className="cd-btn cd-btn-primary" disabled={busy || !chosen.length} onClick={accept}>채택({chosen.length})</button>
      </> : <button type="button" className="cd-btn cd-btn-primary" disabled={busy || !instruction.trim()} onClick={ask}>{busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}제안 받기</button>}
    </div>}>
    <div className="proposal-ai">
      <div className="chips" role="group" aria-label="지시">{AI_ACTIONS.map((a) => <button key={a.id} type="button" className={action === a.id ? "on" : ""} disabled={busy}
        onClick={() => { setAction(a.id); setInstruction(a.instruction); }}>{a.label}</button>)}</div>
      <label className="f">지시(고쳐 써도 됩니다)
        <textarea className="cd-input" rows={2} value={instruction} disabled={busy} maxLength={1000} onChange={(e) => { setInstruction(e.target.value); if (!AI_ACTIONS.some((a) => a.instruction === e.target.value)) setAction("free"); }} /></label>
      <p className="proposal-muted">회사 수치는 원장 값만 쓰고, 모르는 사실은 [작성 필요]로 남깁니다. [작성 필요] 칸·성명 표·적용 예시 쪽은 고치지 않습니다.</p>
      {status ? <p role="status" className="proposal-muted"><Loader2 size={13} className="spin" /> {status}</p> : null}
      {error ? <div className="proposal-alert" role="alert">{error}</div> : null}
      {result ? <div className="proposal-ai-result">
        <p><span className={`cd-pill ${result.source === "ai" ? "cd-pill-info" : "cd-pill-idle"}`}>{result.source === "ai" ? "AI 제안" : "규칙 제안"}</span> {result.summary}{result.fallback ? <small className="proposal-muted"> — {result.fallback}</small> : null}</p>
        {result.notes.length ? <ul className="notes">{result.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
        {fit ? <p className={fit.over ? "proposal-alert" : "proposal-muted"} role="status">{fit.over ? fit.note : `쪽 넘침 없음${fit.rounds ? ` — 넘친 문구를 ${fit.rounds}번 줄였습니다` : ""}.`}</p> : null}
        {ops.length ? <ol className="changes">{ops.map((o) => <li key={o.key}>
          <label className="hd"><input type="checkbox" checked={picked.has(o.key)} disabled={busy} onChange={(e) => pick(o.key, e.target.checked)} /><b>{o.label}</b>
            {o.flags.map((f, i) => <span key={i} className={`cd-pill ${f.severity === "review" ? "cd-pill-warn" : "cd-pill-idle"}`} title={f.message}>{f.message}</span>)}</label>
          <div className="diff">
            <div className="b" aria-label="지금">{o.before.length ? o.before.map((l, i) => <div key={i}>{l}</div>) : <em>(새로 넣음)</em>}</div>
            <div className="a" aria-label="제안">{o.afterLines.length ? o.afterLines.map((l, i) => <div key={i}>{l}</div>) : <em>(지움)</em>}</div>
          </div>
        </li>)}</ol> : null}
        {result.dropped.length ? <details className="dropped"><summary>받지 않은 제안 {result.dropped.length}건</summary><ul>{result.dropped.map((d, i) => <li key={i}>{d}</li>)}</ul></details> : null}
      </div> : null}
    </div>
  </CdModal>;
}
