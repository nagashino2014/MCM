"use client";

// 조직도(C12) 편집 — MCM 조직 마스터에서 만든 기본안을 소개서 전용으로 고친다(사용자 요구 10-22).
// 상자 내용 수정, 조직 추가·삭제, 순서 바꾸기, 촉탁 표시. [임시 저장] → [확정](새 판 기록), 소개서는 최신 확정판을 쓴다.
// 데이터: lib/catalog/contents.ts(org_chart), 기본안: lib/catalog/org-chart.ts

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, DownloadCloud, Network, Plus, RefreshCw, Save, Stamp, Trash2 } from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdHelp } from "@/components/cdash/CdHelp";
import {
  ORG_BADGES,
  ORG_LIMITS,
  countOrgNodes,
  type ContentState as AnyContentState,
  type OrgChartDoc,
  type OrgNode,
} from "@/lib/catalog/content-types";
import { catalogFetch } from "./catalogFetch";
import { ContentVersions } from "./ContentVersions";
import "@/components/cdash/cdash.css";

type ContentState = AnyContentState<"org_chart">;
type Path = number[];

const API = "/api/catalog/contents/org_chart";

// ── 트리 편집 도우미(불변 갱신) ──
function mapAt(nodes: OrgNode[], path: Path, fn: (list: OrgNode[], index: number) => OrgNode[]): OrgNode[] {
  if (path.length === 1) return fn(nodes, path[0]);
  const [head, ...rest] = path;
  return nodes.map((n, i) => (i === head ? { ...n, children: mapAt(n.children, rest, fn) } : n));
}
const newId = () => `n:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const newNode = (label = "새 조직"): OrgNode => ({ id: newId(), label, sub: "", badge: "", children: [] });

export function CatalogOrgChartBoard() {
  const { theme } = useCdashTheme();
  const [state, setState] = useState<ContentState | null>(null);
  const [draft, setDraft] = useState<OrgChartDoc | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = (s: ContentState) => {
    setState(s);
    setDraft(s.draft);
  };

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      apply(await catalogFetch<ContentState>(API));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const dirty = useMemo(() => !!state && !!draft && JSON.stringify(state.draft) !== JSON.stringify(draft), [state, draft]);
  const total = draft ? countOrgNodes(draft.nodes) : 0;

  const edit = (fn: (nodes: OrgNode[]) => OrgNode[]) => setDraft((d) => (d ? { nodes: fn(d.nodes) } : d));
  const updateNode = (path: Path, patch: Partial<OrgNode>) =>
    edit((nodes) => mapAt(nodes, path, (list, i) => list.map((n, j) => (j === i ? { ...n, ...patch } : n))));
  const removeNode = (path: Path, node: OrgNode) => {
    if (node.children.length && !confirm(`'${node.label}'과 하위 조직 ${countOrgNodes(node.children)}개를 함께 지울까요?`)) return;
    edit((nodes) => mapAt(nodes, path, (list, i) => list.filter((_, j) => j !== i)));
  };
  const moveNode = (path: Path, dir: -1 | 1) =>
    edit((nodes) =>
      mapAt(nodes, path, (list, i) => {
        const j = i + dir;
        if (j < 0 || j >= list.length) return list;
        const next = list.slice();
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      })
    );
  const addChild = (path: Path) =>
    edit((nodes) => mapAt(nodes, path, (list, i) => list.map((n, j) => (j === i ? { ...n, children: [...n.children, newNode()] } : n))));
  const addTop = () => edit((nodes) => [...nodes, newNode()]);

  const run = async (fn: () => Promise<ContentState>, done: string) => {
    setBusy(true);
    setNotice(null);
    try {
      apply(await fn());
      setNotice(done);
      return true;
    } catch (e) {
      alert((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () =>
    draft && run(() => catalogFetch<ContentState>(API, { method: "PUT", body: JSON.stringify({ data: draft }) }), "임시 저장했습니다. 소개서에는 확정해야 반영됩니다.");
  const publish = async () => {
    if (!draft || !confirm("지금 조직도를 확정해 새 판으로 기록할까요? 이후 만드는 회사소개서에 이 판이 쓰입니다.")) return;
    const ok = await run(
      () => catalogFetch<ContentState>(API, { method: "POST", body: JSON.stringify({ action: "publish", data: draft, note }) }),
      "조직도를 확정했습니다."
    );
    if (ok) setNote("");
  };
  const restore = (version: number) => {
    if (dirty && !confirm("저장하지 않은 편집 내용이 있습니다. 버리고 이 판을 불러올까요?")) return;
    run(() => catalogFetch<ContentState>(API, { method: "POST", body: JSON.stringify({ action: "restore", version }) }), `${version}판을 불러왔습니다.`);
  };
  const loadMaster = async () => {
    if (!confirm("MCM 조직 마스터(부서·부서장·인원)로 편집 칸을 다시 채울까요? 지금 편집 내용은 바뀝니다(저장 전까지 확정판에는 영향 없음).")) return;
    setBusy(true);
    try {
      const data = await catalogFetch<ContentState & { master: OrgChartDoc }>(`${API}?master=1`);
      setDraft(data.master);
      setNotice("MCM 조직 마스터로 다시 채웠습니다. 고친 뒤 임시 저장하거나 확정하세요.");
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const renderEditor = (nodes: OrgNode[], base: Path, depth: number) =>
    nodes.map((n, i) => {
      const path = [...base, i];
      return (
        <div key={n.id}>
          <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: (depth - 1) * 20 }}>
            <input
              className="cd-input"
              style={{ width: 180 }}
              value={n.label}
              maxLength={ORG_LIMITS.label}
              onChange={(e) => updateNode(path, { label: e.target.value })}
              aria-label={`${n.label} 이름`}
            />
            <input
              className="cd-input flex-1 min-w-[120px]"
              value={n.sub}
              maxLength={ORG_LIMITS.sub}
              placeholder="아래 줄(책임자·인원 등)"
              onChange={(e) => updateNode(path, { sub: e.target.value })}
              aria-label={`${n.label} 아래 줄`}
            />
            <select className="cd-select shrink-0" style={{ width: 84 }} value={n.badge} onChange={(e) => updateNode(path, { badge: e.target.value })} aria-label={`${n.label} 표시`}>
              <option value="">표시 없음</option>
              {ORG_BADGES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm shrink-0" aria-label={`${n.label} 위로`} disabled={i === 0} onClick={() => moveNode(path, -1)}>
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm shrink-0" aria-label={`${n.label} 아래로`} disabled={i === nodes.length - 1} onClick={() => moveNode(path, 1)}>
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              className="cd-btn cd-btn-ghost cd-btn-sm shrink-0"
              aria-label={`${n.label}에 하위 조직 추가`}
              title="하위 조직 추가"
              disabled={depth >= ORG_LIMITS.maxDepth || total >= ORG_LIMITS.maxNodes}
              onClick={() => addChild(path)}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm shrink-0" aria-label={`${n.label} 삭제`} onClick={() => removeNode(path, n)}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
          {n.children.length > 0 && renderEditor(n.children, path, depth + 1)}
        </div>
      );
    });

  const Box = ({ n }: { n: OrgNode }) => (
    <div className="rounded-lg border cd-border-c px-3 py-2 text-center" style={{ background: "var(--cd-card)", minWidth: 120 }}>
      <p className="text-sm cd-text font-semibold">
        {n.label}
        {n.badge && <span className="cd-pill cd-pill-idle ml-1">{n.badge}</span>}
      </p>
      {n.sub && <p className="text-[11px] cd-text-muted">{n.sub}</p>}
    </div>
  );

  return (
    <div className="cdash cd-fields-white p-2" data-theme={theme}>
      <CdPageHeader
        icon={<Network className="w-5 h-5" />}
        eyebrow="회사소개서"
        breadcrumbs={[{ label: "회사소개서", href: "/sales/catalog" }, { label: "조직도" }]}
        title="조직도"
        helpTopic="catalog.org"
        meta={
          state && (
            <span className="text-xs cd-text-muted">
              {state.publishedVersion ? `확정 ${state.publishedVersion}판` : "확정판 없음 — MCM 조직 마스터 기본안"}
              {state.draftDiffers && " · 확정 전 임시 저장본 있음"}
              {dirty && " · 저장하지 않은 편집"} · 상자 {total}개
            </span>
          )
        }
        actions={
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={reload} disabled={loading || busy}>
            <RefreshCw className="w-3.5 h-3.5" /> 새로 고침
          </button>
        }
      />

      {error && <div className="cd-error-bg cd-error-text rounded-xl px-4 py-3 text-sm mb-3">{error}</div>}
      {notice && <div className="cd-card px-4 py-2 text-sm cd-text-muted mb-3" role="status">{notice}</div>}

      {loading || !draft ? (
        <div className="cd-card p-6 text-sm cd-text-faint text-center">불러오는 중…</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-3">
          <section className="cd-card p-4">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h3 className="cd-text font-semibold text-base flex items-center gap-1">
                상자 편집 <CdHelp topic="catalog.org-edit" />
              </h3>
              <div className="ml-auto flex items-center gap-2">
                <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy} onClick={loadMaster}>
                  <DownloadCloud className="w-3.5 h-3.5" /> MCM 조직에서 다시 불러오기
                </button>
                <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy || total >= ORG_LIMITS.maxNodes} onClick={addTop}>
                  <Plus className="w-3.5 h-3.5" /> 최상위 상자 추가
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              {draft.nodes.length === 0 ? (
                <p className="text-sm cd-text-faint py-6 text-center">상자가 없습니다. [최상위 상자 추가] 또는 [MCM 조직에서 다시 불러오기]를 누르세요.</p>
              ) : (
                <div style={{ minWidth: 640 }}>{renderEditor(draft.nodes, [], 1)}</div>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-3">
              <input className="cd-input flex-1 min-w-[200px]" value={note} placeholder="확정 메모(선택, 예: 2026-11 조직 개편 반영)" onChange={(e) => setNote(e.target.value)} aria-label="확정 메모" />
              <button type="button" className="cd-btn cd-btn-soft" disabled={busy || !dirty} onClick={saveDraft}>
                <Save className="w-3.5 h-3.5" /> 임시 저장
              </button>
              <button type="button" className="cd-btn cd-btn-primary" disabled={busy || draft.nodes.length === 0} onClick={publish}>
                <Stamp className="w-3.5 h-3.5" /> 확정
              </button>
            </div>
            <p className="text-[11px] cd-text-faint mt-2">
              인사 조직(MCM 조직 마스터)은 바뀌지 않습니다. 확정한 판은 이후 만드는 회사소개서에 쓰이며, 이미 발행한 소개서는 바뀌지 않습니다.
            </p>
          </section>

          <div className="grid gap-3 content-start">
            <section className="cd-card p-4">
              <h3 className="cd-text font-semibold text-base mb-2">미리보기</h3>
              <div className="rounded-lg border cd-border-c p-4 overflow-x-auto">
                {draft.nodes.map((root) => (
                  <div key={root.id} className="flex flex-col items-center gap-3 mb-4 last:mb-0">
                    <Box n={root} />
                    {root.children.length > 0 && (
                      <div className="flex flex-wrap justify-center gap-2">
                        {root.children.map((c) => (
                          <div key={c.id} className="flex flex-col items-center gap-1.5">
                            <Box n={c} />
                            {c.children.map((g) => (
                              <div key={g.id} className="rounded border cd-border-c px-2 py-1 text-[11px] cd-text-muted text-center" style={{ minWidth: 100 }}>
                                {g.label}
                                {g.badge && ` (${g.badge})`}
                                {g.children.length > 0 && ` 외 ${countOrgNodes(g.children)}`}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[11px] cd-text-faint mt-2">실제 소개서 지면의 선·크기는 디자인 시스템을 따릅니다.</p>
            </section>
            <ContentVersions versions={state?.versions ?? []} busy={busy} helpTopic="catalog.org-versions" onRestore={restore} />
          </div>
        </div>
      )}
    </div>
  );
}
