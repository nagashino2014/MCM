"use client";

// 새 사업 분야 추가(P6, 블루프린트 §7-2 6) — 분야명·메모·관련 계약 분류 → page_compose 가 C09 쪽 구성을 제안(실패 시 규칙 초안) →
// 렌더 후 넘침 실측(넘치면 리드·서비스·절차를 1–2회 자동 축약) → 부분별로 AI 제안/규칙 초안을 골라 추가. 분야 색은 빈 area 슬롯.

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { useCdToast } from "@/components/cdash/CdToast";
import { CATALOG_CATEGORIES } from "@/lib/catalog/areas";
import { charLen, type CaseCandidate, type Flag, type MetricBrief } from "@/lib/catalog/ai/patch";
import type { CustomAreaContent } from "@/lib/catalog/custom-area-types";
import { INFO_TYPE_META } from "@/lib/catalog/render/infographic/types";
import { CustomAreaPage } from "@/lib/catalog/render/components/pages-business";
import type { CustomAreaInfo } from "@/lib/catalog/render/types";
import { elementToTree } from "@/lib/catalog/studio/convert";
import { renderNode } from "@/lib/catalog/studio/render-tree";
import { catalogFetch } from "../catalogFetch";
import { metricValues, pageOverflow, type Overflow } from "./aiClient";
import { StaticFrame } from "./Frames";
import type { StudioKit } from "./kit";
import type { Studio } from "./useStudio";

type PartKey = "lead" | "services" | "process" | "kpis" | "featured" | "hero";

interface AreaProposal {
  source: "ai" | "rule";
  fallback?: string;
  name: string;
  content: CustomAreaContent;
  rule: CustomAreaContent;
  parts: Array<{ key: PartKey; label: string; ai: string[]; rule: string[]; flags: Flag[] }>;
  notes: string[];
  slot: number;
  sharedSlot: boolean;
  candidates: CaseCandidate[];
  metrics: Record<string, MetricBrief>;
}

/** 부분 채택 — 서버 mergeAreaParts 와 같은 규칙 */
function merge(ai: CustomAreaContent, rule: CustomAreaContent, accepted: Set<PartKey>): CustomAreaContent {
  const out: CustomAreaContent = { ...rule };
  if (accepted.has("lead")) out.lead = ai.lead;
  if (accepted.has("services")) out.services = ai.services;
  if (accepted.has("process")) Object.assign(out, { process: ai.process, processTitle: ai.processTitle, infoType: ai.infoType });
  if (accepted.has("kpis")) out.kpis = ai.kpis;
  if (accepted.has("featured")) out.featured = ai.featured;
  if (accepted.has("hero")) Object.assign(out, { icon: ai.icon, heroCaption: ai.heroCaption });
  out.source = accepted.size === 0 ? "rule" : accepted.size === 6 ? "ai" : "mixed";
  return out;
}

export function AiAreaPanel({ studio, kit, docId, onDone }: { studio: Studio; kit: StudioKit; docId: string; onDone: (pageKey: string) => void }) {
  const { toast } = useCdToast();
  const [name, setName] = useState("");
  const [memo, setMemo] = useState("");
  const [cats, setCats] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [p, setP] = useState<AreaProposal | null>(null);
  const [accepted, setAccepted] = useState<Set<PartKey>>(new Set());
  const [ai, setAi] = useState<CustomAreaContent | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // 입력 → 검토로 바뀌면 초점을 검토 화면으로(대화상자 Esc·Tab 유지)
  useEffect(() => {
    if (p) rootRef.current?.focus();
  }, [p]);
  const [ov, setOv] = useState<{ phase: "idle" | "checking" | "fitting" | "done"; result?: Overflow; round: number; fit?: string }>({ phase: "idle", round: 0 });

  const ask = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await catalogFetch<AreaProposal>("/api/catalog/ai/area", { method: "POST", body: JSON.stringify({ name, memo, categories: cats }) });
      setP(res);
      setAi(res.content);
      setAccepted(new Set(res.source === "ai" ? res.parts.filter((x) => !x.flags.some((f) => f.severity === "review")).map((x) => x.key) : []));
      setOv({ phase: "idle", round: 0 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const content = useMemo(() => (p && ai ? merge(ai, p.rule, accepted) : null), [p, ai, accepted]);
  const treeOf = (c: CustomAreaContent) => {
    if (!p || !studio.ctx || !studio.data) return null;
    const area: CustomAreaInfo = {
      id: "xpreview",
      key: "area-xpreview",
      name: p.name,
      slot: p.slot,
      content: c,
      featured: c.featured.map((id) => p.candidates.find((x) => x.id === id)).filter((x): x is CaseCandidate => x != null).sort((a, b) => a.year.localeCompare(b.year)).map((x) => ({ year: x.year, title: x.title, meta: x.meta })),
    };
    return elementToTree(<CustomAreaPage ctx={studio.ctx} data={studio.data} area={area} />, area.key);
  };
  const tree = content ? treeOf(content) : null;

  // 제안이 오면 렌더 후 넘침 실측 → 넘치면 AI 제안 문안을 1–2회 줄인다
  useEffect(() => {
    if (!p || !ai || ov.phase !== "idle" || !studio.env) return;
    void (async () => {
      setOv({ phase: "checking", round: 0 });
      let cur = ai;
      let t = treeOf(merge(cur, p.rule, accepted));
      if (!t) return;
      let res = await pageOverflow(kit, studio.fontSet, studio.env!, t, "area-xpreview");
      let round = 0;
      let fitNote: string | undefined;
      while (res.count > 0 && round < 2) {
        round += 1;
        setOv({ phase: "fitting", result: res, round });
        const ratio = round === 1 ? 0.85 : 0.7;
        const items = [
          { key: "lead", text: cur.lead, maxChars: Math.floor(charLen(cur.lead) * ratio) },
          ...cur.services.map((s, i) => ({ key: `s${i}`, text: s, maxChars: Math.max(8, Math.floor(charLen(s) * ratio)) })),
          ...cur.process.map((s, i) => ({ key: `d${i}`, text: s.desc, maxChars: Math.max(8, Math.floor(charLen(s.desc) * ratio)) })).filter((x) => x.text),
        ];
        try {
          const r = await catalogFetch<{ source: "ai" | "rule"; fallback?: string; items: Array<{ key: string; text: string }> }>("/api/catalog/ai/fit", {
            method: "POST",
            body: JSON.stringify({ items, metricValues: metricValues(p.metrics), subject: `${docId}:new-area` }),
          });
          const got = new Map(r.items.map((x) => [x.key, x.text]));
          cur = { ...cur, lead: got.get("lead") ?? cur.lead, services: cur.services.map((s, i) => got.get(`s${i}`) ?? s), process: cur.process.map((s, i) => ({ ...s, desc: got.get(`d${i}`) ?? s.desc })) };
          fitNote = r.source === "ai" ? "넘침 → AI 로 줄임" : `넘침 → 규칙으로 줄임${r.fallback ? `(${r.fallback})` : ""}`;
        } catch {
          break;
        }
        t = treeOf(merge(cur, p.rule, accepted));
        if (!t) break;
        res = await pageOverflow(kit, studio.fontSet, studio.env!, t, "area-xpreview");
      }
      if (cur !== ai) setAi(cur);
      setOv({ phase: "done", result: res, round, fit: fitNote });
    })();
    // 제안이 바뀔 때 한 번
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);

  const add = async () => {
    if (!p || !content) return;
    setBusy(true);
    try {
      await studio.save();
      const res = await catalogFetch<{ pageKey: string }>("/api/catalog/ai/area", { method: "PUT", body: JSON.stringify({ name: p.name, content }) });
      const v = await catalogFetch<{ version: number; rev: string }>(`/api/catalog/studio/versions?doc=${encodeURIComponent(docId)}`, {
        method: "POST",
        body: JSON.stringify({ note: `새 사업 분야 추가 · ${p.name}` }),
      });
      studio.adoptRev(v.rev, v.version);
      await studio.reload();
      toast(`'${p.name}' 분야 쪽을 더했습니다(버전 ${v.version}). 작업본에는 '초안' 표시가 붙습니다.`, "success");
      onDone(res.pageKey);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (!p) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-xs cd-text-muted">
          분야 상세(C09)와 같은 틀로 새 쪽을 만듭니다. 숫자는 고른 계약 분류의 지표로, 대표 실적은 그 분류의 실제 계약에서만 고릅니다.
        </p>
        <label className="flex flex-col gap-1 text-xs cd-text-muted">
          분야 이름(소개서 표기)
          <input className="cd-input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="예: 토양·지하수 조사" />
        </label>
        <label className="flex flex-col gap-1 text-xs cd-text-muted">
          설명 메모(하는 일·대상·특징 — 자유롭게)
          <textarea className="cd-input" rows={4} maxLength={1500} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 토양오염도 조사, 정화 계획 수립, 지하수 영향 조사…" />
        </label>
        <fieldset className="flex flex-col gap-1 border-0 p-0 m-0">
          <legend className="text-xs cd-text-muted mb-1">관련 계약 분류(지표·대표 실적 후보의 범위)</legend>
          <div className="flex flex-wrap gap-1.5">
            {CATALOG_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                className="cd-chip cd-chip-sm"
                data-active={cats.includes(c) ? "true" : undefined}
                aria-pressed={cats.includes(c)}
                onClick={() => setCats((list) => (list.includes(c) ? list.filter((x) => x !== c) : [...list, c].slice(0, 3)))}
              >
                {studio.data?.areas.find((a) => a.category === c)?.name ?? c}
              </button>
            ))}
          </div>
        </fieldset>
        {error ? <p className="cd-error-text">{error}</p> : null}
        <button type="button" className="cd-btn cd-btn-primary self-start" onClick={() => void ask()} disabled={busy || !name.trim()}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {busy ? "쪽 구성 중…(30초 안팎)" : "쪽 구성 제안 받기"}
        </button>
      </div>
    );
  }

  const env = studio.env!;
  return (
    <div ref={rootRef} tabIndex={-1} className="flex flex-col gap-3 outline-none" aria-label="새 사업 분야 제안 검토">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={p.source === "ai" ? "cd-pill cd-pill-info" : "cd-pill cd-pill-warn"}>{p.source === "ai" ? "AI 제안" : "규칙 초안"}</span>
        {p.fallback ? <span className="cd-text-muted">AI 대신 규칙으로 만들었습니다 — {p.fallback}</span> : null}
        <span className="cd-text-muted">
          분야 색 area-{p.slot}
          {p.sharedSlot ? " — 빈 분야 색이 없어 첫 관련 분류의 색을 함께 씁니다" : "(빈 슬롯)"}
        </span>
        {ov.fit ? <span className="cd-pill cd-pill-idle">{ov.fit}</span> : null}
      </div>
      {p.notes.length ? (
        <ul className="text-xs cd-text-muted list-disc pl-4">
          {p.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-3" style={{ gridTemplateColumns: "minmax(0, 520px) minmax(0, 1fr)" }}>
        <figure className="m-0 flex flex-col gap-1">
          <figcaption className="text-xs cd-text-muted flex items-center gap-1.5">
            미리보기
            {ov.phase === "checking" || ov.phase === "fitting" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-label="넘침 검사 중" />
            ) : ov.result ? (
              <span className={ov.result.count > 0 ? "cd-pill cd-pill-error" : "cd-pill cd-pill-success"}>{ov.result.count < 0 ? "검사 실패" : `넘침 ${ov.result.count}`}</span>
            ) : null}
          </figcaption>
          <div className="rounded border cd-border-c overflow-hidden self-start" style={{ background: "#fff" }}>
            {tree ? <StaticFrame kit={kit} fontSet={studio.fontSet} html={renderToStaticMarkup(renderNode(tree, env) as ReactElement)} width={500} title="새 사업 분야 미리보기" /> : null}
          </div>
        </figure>
        <fieldset className="flex flex-col gap-2 border-0 p-0 m-0 min-w-0">
          <legend className="text-xs cd-text-muted mb-1">부분마다 AI 제안을 쓸지 고릅니다(끄면 규칙 초안)</legend>
          {p.parts.map((part) => {
            const lines = ai && part.key !== "featured" && part.key !== "kpis" ? linesOf(ai, part.key, p) : part.ai;
            return (
              <label key={part.key} className="rounded-lg border cd-border-c p-2 flex gap-2 items-start text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  disabled={p.source !== "ai"}
                  checked={accepted.has(part.key)}
                  onChange={(e) =>
                    setAccepted((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(part.key);
                      else n.delete(part.key);
                      return n;
                    })
                  }
                />
                <span className="flex-1 min-w-0 flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <b className="cd-text">{part.label}</b>
                    {part.flags.map((f, i) => (
                      <span key={i} className={f.severity === "review" ? "cd-pill cd-pill-warn" : "cd-pill cd-pill-idle"} title={f.message}>
                        {f.message.length > 40 ? `${f.message.slice(0, 40)}…` : f.message}
                      </span>
                    ))}
                  </span>
                  <span className="cd-text whitespace-pre-line break-words">{(accepted.has(part.key) ? lines : part.rule).join("\n") || "—"}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" className="cd-btn cd-btn-ghost" onClick={() => setP(null)} disabled={busy}>
          다시 입력
        </button>
        <button type="button" className="cd-btn cd-btn-primary" onClick={() => void add()} disabled={busy || ov.phase === "checking" || ov.phase === "fitting"}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} 이 분야 쪽 추가
        </button>
      </div>
    </div>
  );
}

function linesOf(c: CustomAreaContent, key: PartKey, p: AreaProposal): string[] {
  const rd = (t: string) => t.replace(/\{\{metric:([a-z0-9.]{1,40})\}\}/g, (_, id: string) => String(p.metrics[id]?.value ?? "-"));
  if (key === "lead") return [rd(c.lead)];
  if (key === "services") return c.services.map(rd);
  if (key === "process") return [`${c.processTitle} · ${INFO_TYPE_META[c.infoType]?.label ?? c.infoType}`, ...c.process.map((s, i) => `${i + 1}. ${s.label}${s.desc ? ` — ${s.desc}` : ""}`)];
  if (key === "hero") return [`${c.icon} · ${rd(c.heroCaption)}`];
  return [];
}
