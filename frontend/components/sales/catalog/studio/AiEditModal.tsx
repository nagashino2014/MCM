"use client";

// 스튜디오 [AI로 수정](P6, 블루프린트 §7-2) — 쪽·고른 요소에 지시 → 서버가 컨텍스트를 묶어 LLM 패치(실패 시 규칙 초안) →
// 검사(숫자·최상급·글자 수) → 렌더 후 넘침 실측(넘치면 copy_fit 1–2회 자동 축약 또는 다른 유형 제안) → 전/후 미리보기 → 전체·부분 채택.
// 채택은 보통 편집과 같은 편집층(실행 취소 가능)에 들어가고 버전으로 남는다. 응답 원문은 어디에도 저장하지 않는다.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Loader2, Sparkles } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdHelp } from "@/components/cdash/CdHelp";
import { useCdToast } from "@/components/cdash/CdToast";
import { applyChanges, hasReview, type ProposedChange } from "@/lib/catalog/ai/patch";
import { matchInfographic } from "@/lib/catalog/render/infographic/match";
import { INFO_TYPE_META, type InfoType } from "@/lib/catalog/render/infographic/types";
import type { PagePlanItem } from "@/lib/catalog/render/components/plan";
import type { CatalogRenderData } from "@/lib/catalog/render/types";
import { composePage, orderedPlan } from "@/lib/catalog/studio/compose";
import { pageState } from "@/lib/catalog/studio/doc";
import type { CNode } from "@/lib/catalog/studio/nodes";
import { renderNode } from "@/lib/catalog/studio/render-tree";
import type { Selection } from "@/lib/catalog/studio/select";
import { catalogFetch } from "../catalogFetch";
import { AiAreaPanel } from "./AiAreaPanel";
import { overflowTargets, pageOverflow, shrinkChanges, type ClientProposal, type Overflow } from "./aiClient";
import { StaticFrame } from "./Frames";
import type { StudioKit } from "./kit";
import type { Studio } from "./useStudio";

type Mode = "page" | "area";

const EXAMPLES = ["리드 문장을 두 문장으로 더 간결하게", "인포그래픽을 5단계 흐름도로 바꾸고 단계 설명을 다듬어", "주요 서비스에 최근 업무를 반영해 정리해"];

const FLAG_CLS = (sev: "review" | "note") => (sev === "review" ? "cd-pill cd-pill-warn" : "cd-pill cd-pill-idle");

export function AiEditModal({
  open,
  onClose,
  studio,
  kit,
  item,
  sel,
  docId,
  initial,
  onOpenPage,
}: {
  open: boolean;
  onClose: () => void;
  studio: Studio;
  kit: StudioKit;
  item: PagePlanItem;
  sel: Selection | null;
  docId: string;
  /** [AI로 줄이기]가 만든 제안 — 있으면 바로 검토 */
  initial?: ClientProposal | null;
  onOpenPage: (key: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("page");
  const [scope, setScope] = useState<"page" | "selection">("page");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ClientProposal | null>(null);
  const [instr, setInstr] = useState("");
  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    setMode("page");
    setProposal(initial ?? null);
    setInstr(initial ? "넘침 줄이기" : "");
    setScope(sel && sel.kind !== "added" ? "selection" : "page");
  }, [open, initial, sel]);

  const canSelection = sel != null && sel.kind !== "added";
  const ask = async () => {
    const text = instruction.trim();
    if (!text) {
      setError("무엇을 고칠지 적어 주세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // 서버는 저장된 편집본 기준으로 쪽을 만든다 — 먼저 저장
      if (!(await studio.save())) throw new Error("먼저 저장하지 못했습니다. 저장 오류를 해결한 뒤 다시 시도하세요.");
      const p = await catalogFetch<ClientProposal>("/api/catalog/ai/edit", {
        method: "POST",
        body: JSON.stringify({ doc: docId, pageKey: item.key, focusId: scope === "selection" && sel ? sel.id : null, instruction: text, edition: studio.view.edition }),
      });
      setInstr(text);
      setProposal(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CdModal open={open} onClose={busy ? () => undefined : onClose} title={<span className="inline-flex items-center gap-1"><Sparkles className="w-4 h-4" /> AI로 수정<CdHelp topic="catalog.studio-ai" /></span>} size="xl" maxHeightClass="max-h-[92vh]">
      <div className="p-4 flex flex-col gap-3 text-sm">
        {!proposal ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="AI 편집 종류">
            <button type="button" className="cd-chip cd-chip-sm" data-active={mode === "page" ? "true" : undefined} aria-pressed={mode === "page"} onClick={() => setMode("page")}>
              이 쪽 고치기
            </button>
            <button type="button" className="cd-chip cd-chip-sm" data-active={mode === "area" ? "true" : undefined} aria-pressed={mode === "area"} onClick={() => setMode("area")}>
              새 사업 분야 추가
            </button>
          </div>
        ) : null}
        {mode === "area" && !proposal ? (
          <AiAreaPanel studio={studio} kit={kit} docId={docId} onDone={(key) => (onClose(), onOpenPage(key))} />
        ) : proposal ? (
          <AiReview
            studio={studio}
            kit={kit}
            item={item}
            docId={docId}
            proposal={proposal}
            instruction={instr}
            onBack={initial ? null : () => setProposal(null)}
            fixOverflow={Boolean(initial)}
            onDone={onClose}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs cd-text-muted">
              {item.label} 쪽의 글·목록·인포그래픽 내용만 바꿉니다. 배치·색·글자 크기는 그대로이고, 숫자는 지표에 묶인 값만 씁니다. 제안을 보고 고른 것만 채택합니다.
            </p>
            <div className="flex flex-wrap gap-3 text-xs" role="radiogroup" aria-label="고칠 범위">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="ai-scope" checked={scope === "page"} onChange={() => setScope("page")} /> 이 쪽 전체
              </label>
              <label className={`flex items-center gap-1.5 ${canSelection ? "" : "cd-text-faint"}`}>
                <input type="radio" name="ai-scope" checked={scope === "selection"} disabled={!canSelection} onChange={() => setScope("selection")} /> 고른 요소만{canSelection ? "" : "(캔버스에서 요소를 먼저 고르세요)"}
              </label>
            </div>
            <label className="flex flex-col gap-1 text-xs cd-text-muted">
              지시
              <textarea
                className="cd-input"
                rows={3}
                maxLength={1000}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void ask();
                }}
                placeholder="예: ESG 분야에 공급망 실사 대응 사례를 추가하고 인포그래픽을 5단계 절차도로"
              />
            </label>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="cd-chip cd-chip-sm" onClick={() => setInstruction(ex)}>
                  {ex}
                </button>
              ))}
            </div>
            {error ? <p className="cd-error-text">{error}</p> : null}
            <div className="flex items-center gap-2">
              <button type="button" className="cd-btn cd-btn-primary" onClick={() => void ask()} disabled={busy}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} {busy ? "제안 만드는 중…(30초 안팎)" : "제안 받기"}
              </button>
              <span className="text-xs cd-text-faint">Ctrl+Enter</span>
            </div>
          </div>
        )}
      </div>
    </CdModal>
  );
}

/** 분야 쪽 대표 실적을 바꾼 데이터(미리보기) */
function withFeatured(data: CatalogRenderData, pageKey: string, rows: Array<{ year: string; title: string; meta: string }>): CatalogRenderData {
  const m = pageKey.match(/^area-([1-5])$/);
  if (!m) return data;
  const idx = Number(m[1]);
  return { ...data, areas: data.areas.map((a) => (a.index === idx ? { ...a, featured: rows, featuredFallback: false } : a)) };
}

type CheckState = { phase: "idle" | "checking" | "fitting" | "done"; before?: Overflow; after?: Overflow; round: number; note?: string; alternatives?: Array<{ type: InfoType; variant: string; label: string; changeId: string }> };

function AiReview({
  studio,
  kit,
  item,
  docId,
  proposal,
  instruction,
  onBack,
  onDone,
  fixOverflow,
}: {
  studio: Studio;
  kit: StudioKit;
  item: PagePlanItem;
  docId: string;
  proposal: ClientProposal;
  instruction: string;
  onBack: (() => void) | null;
  onDone: () => void;
  fixOverflow: boolean;
}) {
  const { toast } = useCdToast();
  const [changes, setChanges] = useState<ProposedChange[]>(proposal.changes);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(proposal.changes.filter((c) => !hasReview(c)).map((c) => c.id)));
  const [check, setCheck] = useState<CheckState>({ phase: "idle", round: 0 });
  const [busy, setBusy] = useState(false);
  const [fitSource, setFitSource] = useState<string | null>(null);
  // 입력 단계가 사라지면 초점이 대화상자 밖으로 빠진다 — 검토 화면으로 옮겨 Esc·Tab 이 계속 되게
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => rootRef.current?.focus(), []);
  const metrics = proposal.metrics;
  const env = studio.env!;
  const pages = studio.state?.pages ?? [];
  const st = pageState(pages, item.key);
  const beforeTree = studio.composedOf(item).tree;

  const afterTreeOf = useCallback(
    (list: ProposedChange[]): CNode => {
      const edits = applyChanges(st.edits, list.filter((c) => c.edit));
      const cases = list.find((c) => c.kind === "cases" && c.featured);
      let it = item;
      if (cases && studio.ctx && studio.data && studio.cover) {
        const rows = cases.featured!.map((id) => proposal.candidates.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => x != null);
        const data2 = withFeatured(studio.data, item.key, rows);
        it = orderedPlan(studio.ctx, data2, studio.cover, pages).find((p) => p.key === item.key) ?? item;
      }
      return composePage(it, { ...st, edits }, { metrics: studio.data?.metrics }).tree;
    },
    [st, item, studio.ctx, studio.data, studio.cover, pages, proposal.candidates]
  );
  const chosen = useMemo(() => changes.filter((c) => picked.has(c.id)), [changes, picked]);
  const afterTree = useMemo(() => afterTreeOf(chosen), [afterTreeOf, chosen]);
  const html = (t: CNode) => renderToStaticMarkup(renderNode(t, env) as ReactElement);

  // 렌더 후 넘침 실측 → 넘치면 1–2회 자동 축약 → 그래도 넘치면 다른 유형 제안
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || changes.length === 0) return;
    ran.current = true;
    void (async () => {
      setCheck({ phase: "checking", round: 0 });
      const before = await pageOverflow(kit, studio.fontSet, env, beforeTree, item.key);
      let list = changes;
      let after = await pageOverflow(kit, studio.fontSet, env, afterTreeOf(list), item.key);
      let round = 0;
      // [AI로 줄이기]는 넘침 0이 목표, [AI로 수정]은 넘침이 늘지 않는 것이 목표
      const base = fixOverflow ? 0 : Math.max(0, before.count);
      // 자리보다 높이가 큰 유형으로 바꾼 인포그래픽은 글을 줄여도 들어가지 않는다 — 줄이지 않고 다른 유형을 제안한다
      const tooTall = (c: ProposedChange) => {
        const t = c.edit?.info?.type as InfoType | undefined;
        const box = c.kind === "info" ? findBox(beforeTree, c.id) : null;
        return Boolean(t && box && INFO_TYPE_META[t].minHeight > box.h + 4);
      };
      while (after.count > base && round < 2) {
        const targets = overflowTargets(list, after.texts).filter((c) => !tooTall(c));
        if (targets.length === 0) break;
        round += 1;
        setCheck({ phase: "fitting", before, after, round });
        try {
          const res = await shrinkChanges(list, targets, beforeTree, metrics, round === 1 ? 0.85 : 0.7, `${docId}:${item.key}`);
          list = res.changes;
          setFitSource(res.source === "ai" ? "AI 로 줄임" : `규칙으로 줄임${res.fallback ? `(${res.fallback})` : ""}`);
        } catch {
          break;
        }
        after = await pageOverflow(kit, studio.fontSet, env, afterTreeOf(list), item.key);
      }
      setChanges(list);
      let alternatives: CheckState["alternatives"];
      if (after.count > base) {
        // 인포그래픽 바꿈이 있으면 같은 내용으로 그릴 수 있는 다른 유형을 제안
        const info = list.find((c) => c.kind === "info" && c.edit?.info?.content);
        if (info?.edit?.info?.content) {
          const slotBox = findBox(beforeTree, info.id);
          const { candidates } = matchInfographic(info.edit.info.content, { box: slotBox ?? { w: 490, h: 90 }, current: info.edit.info.type as InfoType });
          alternatives = candidates.filter((c) => c.type !== info.edit!.info!.type).slice(0, 3).map((c) => ({ type: c.type, variant: c.variant, label: c.label, changeId: info.id }));
        }
      }
      setCheck({ phase: "done", before, after, round, alternatives, note: after.count > base ? "줄여도 넘칩니다 — 채택 전 글을 더 줄이거나 다른 유형을 고르세요." : undefined });
    })();
    // 처음 한 번만(제안이 도착했을 때)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recheck = async () => {
    setCheck((c) => ({ ...c, phase: "checking" }));
    const after = await pageOverflow(kit, studio.fontSet, env, afterTree, item.key);
    setCheck((c) => ({ ...c, phase: "done", after, note: c.before && after.count > Math.max(0, c.before.count) ? "넘침이 남아 있습니다." : undefined }));
  };

  const switchType = (changeId: string, type: InfoType, variant: string) => {
    setChanges((list) =>
      list.map((c) =>
        c.id === changeId && c.edit?.info
          ? { ...c, edit: { ...c.edit, info: { ...c.edit.info, type, variant } }, after: [`유형: ${INFO_TYPE_META[type].label}`, ...c.after.slice(1)] }
          : c
      )
    );
    setCheck((c) => ({ ...c, alternatives: undefined, note: "유형을 바꿨습니다 — [다시 검사]로 확인하세요." }));
  };

  const adopt = async () => {
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      const edits = chosen.filter((c) => c.edit);
      if (edits.length) studio.setPageEdits(item.key, (e) => applyChanges(e, edits));
      if (!(await studio.save())) throw new Error("저장하지 못했습니다.");
      const cases = chosen.find((c) => c.kind === "cases" && c.featured);
      if (cases) await catalogFetch("/api/catalog/ai/edit", { method: "PUT", body: JSON.stringify({ pageKey: item.key, featured: cases.featured }) });
      const note = `AI 수정 · ${item.label} · ${instruction}`.slice(0, 190);
      const v = await catalogFetch<{ version: number; rev: string }>(`/api/catalog/studio/versions?doc=${encodeURIComponent(docId)}`, { method: "POST", body: JSON.stringify({ note }) });
      studio.adoptRev(v.rev, v.version);
      if (cases) await studio.reload();
      toast(`${chosen.length}곳을 채택하고 버전 ${v.version}으로 남겼습니다.${cases ? " 대표 실적 지정도 바꿨습니다." : " 실행 취소로 되돌릴 수 있습니다."}`, "success");
      onDone();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const reviewCount = changes.filter(hasReview).length;
  const W = 395;
  return (
    <div ref={rootRef} tabIndex={-1} className="flex flex-col gap-3 outline-none" aria-label="AI 제안 검토">
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className={proposal.source === "ai" ? "cd-pill cd-pill-info" : "cd-pill cd-pill-warn"}>{proposal.source === "ai" ? "AI 제안" : "규칙 초안"}</span>
        {proposal.fallback ? <span className="cd-text-muted">AI 대신 규칙으로 만들었습니다 — {proposal.fallback}</span> : null}
        {proposal.summary ? <span className="cd-text">{proposal.summary}</span> : null}
        {fitSource ? <span className="cd-pill cd-pill-idle">넘침 → {fitSource}</span> : null}
      </div>
      {proposal.missed?.length ? <p className="text-xs cd-error-text">{proposal.missed.join(" ")}</p> : null}
      {proposal.notes.length ? (
        <ul className="text-xs cd-text-muted list-disc pl-4">
          {proposal.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}

      {changes.length === 0 ? (
        <p className="cd-text-muted">바꿀 곳이 없다는 제안입니다. 지시를 더 구체적으로 적어 다시 받아 보세요.</p>
      ) : (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${Math.min(W, 300)}px, 1fr))` }}>
            {(
              [
                ["지금", beforeTree, check.before],
                ["채택 후(고른 것)", afterTree, check.after],
              ] as Array<[string, CNode, Overflow | undefined]>
            ).map(([label, tree, ov]) => (
              <figure key={label} className="flex flex-col gap-1 m-0">
                <figcaption className="text-xs cd-text-muted flex items-center gap-1.5">
                  {label}
                  {ov ? <span className={ov.count > 0 ? "cd-pill cd-pill-error" : "cd-pill cd-pill-success"}>{ov.count < 0 ? "검사 실패" : `넘침 ${ov.count}`}</span> : null}
                </figcaption>
                <div className="rounded border cd-border-c overflow-hidden self-start" style={{ background: "#fff" }}>
                  <StaticFrame kit={kit} fontSet={studio.fontSet} html={html(tree)} width={W} title={`${label} 미리보기`} />
                </div>
              </figure>
            ))}
          </div>
          <div className="text-xs flex flex-wrap items-center gap-2" aria-live="polite">
            {check.phase === "checking" ? (
              <span className="cd-text-muted flex items-center gap-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> 넘침 검사 중…
              </span>
            ) : check.phase === "fitting" ? (
              <span className="cd-text-muted flex items-center gap-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> 넘침 {check.after?.count}건 — 줄이는 중({check.round}/2)
              </span>
            ) : check.note ? (
              <span className="cd-error-text">{check.note}</span>
            ) : check.phase === "done" ? (
              <span className="cd-text-muted">렌더 검사 통과(넘침이 늘지 않음)</span>
            ) : null}
            {check.alternatives?.map((a) => (
              <button key={a.type} type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => switchType(a.changeId, a.type, a.variant)}>
                {a.label} 유형으로 바꾸기
              </button>
            ))}
            {check.phase === "done" ? (
              <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => void recheck()}>
                다시 검사
              </button>
            ) : null}
          </div>
          <fieldset className="flex flex-col gap-2 border-0 p-0 m-0">
            <legend className="text-xs cd-text-muted mb-1">
              바꿀 곳 {changes.length} · 고름 {chosen.length}
              {reviewCount ? ` · 검토 표시 ${reviewCount}(기본으로 고르지 않음)` : ""}
            </legend>
            {changes.map((c) => (
              <label key={c.id} className="rounded-lg border cd-border-c p-2 flex gap-2 items-start">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={picked.has(c.id)}
                  onChange={(e) =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(c.id);
                      else n.delete(c.id);
                      return n;
                    })
                  }
                />
                <span className="flex-1 min-w-0 flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <b className="cd-text">{c.label}</b>
                    {c.source === "rule" ? <span className="cd-pill cd-pill-idle">규칙</span> : null}
                    {c.flags.map((f, i) => (
                      <span key={i} className={FLAG_CLS(f.severity)} title={f.message}>
                        {f.message.length > 46 ? `${f.message.slice(0, 46)}…` : f.message}
                      </span>
                    ))}
                  </span>
                  <span className="grid gap-2 text-xs" style={{ gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" }}>
                    <span className="cd-text-faint whitespace-pre-line break-words">{c.before.join("\n")}</span>
                    <span className="cd-text whitespace-pre-line break-words">{c.after.join("\n")}</span>
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        </>
      )}
      {proposal.dropped.length ? (
        <details className="text-xs cd-text-muted">
          <summary>쓰지 않은 제안 {proposal.dropped.length}</summary>
          <ul className="list-disc pl-4">
            {proposal.dropped.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 justify-end">
        {onBack ? (
          <button type="button" className="cd-btn cd-btn-ghost" onClick={onBack} disabled={busy}>
            지시 다시 쓰기
          </button>
        ) : null}
        <button type="button" className="cd-btn cd-btn-ghost" onClick={() => setPicked(new Set(changes.map((c) => c.id)))} disabled={busy || changes.length === 0}>
          모두 고르기
        </button>
        <button type="button" className="cd-btn cd-btn-primary" onClick={() => void adopt()} disabled={busy || chosen.length === 0 || check.phase === "checking" || check.phase === "fitting"}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} 고른 {chosen.length}곳 채택
        </button>
      </div>
    </div>
  );
}

function findBox(tree: CNode, id: string): { w: number; h: number } | null {
  const walk = (n: CNode): { w: number; h: number } | null => {
    if (n.id === id && n.props && (n.props as { box?: { w: number; h: number } }).box) return (n.props as { box: { w: number; h: number } }).box;
    for (const c of n.children ?? []) {
      const r = walk(c);
      if (r) return r;
    }
    return null;
  };
  return walk(tree);
}
