"use client";
// 실적 대외 표기 제안(P6, catalog.project_label) — 규칙 표기가 어색한 행만 AI 가 대외 표기를 제안하고, 사람이 고쳐 일괄 확정한다.
// 확정하면 대외 표기로 저장되고 검토 완료로 표시된다(블루프린트 §6-4 백필). AI 가 없으면 규칙 표기를 그대로 보여 준다.
import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdHelp } from "@/components/cdash/CdHelp";
import type { CatalogProjectRow } from "@/lib/catalog/appendix";
import { catalogFetch } from "./catalogFetch";

interface LabelRow {
  id: string;
  category: string;
  contractTitle: string;
  ruleTitle: string;
  reasons: string[];
  suggestion: string;
  issues: string[];
  source: "ai" | "rule";
}

interface LabelResult {
  source: "ai" | "rule";
  fallback?: string;
  rows: LabelRow[];
  total: number;
}

export function CatalogLabelSuggest({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (rows: CatalogProjectRow[], count: number) => void }) {
  const [res, setRes] = useState<LabelResult | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (exclude: string[] = []) => {
    setBusy(true);
    setError(null);
    try {
      const r = await catalogFetch<LabelResult>("/api/catalog/ai/labels", { method: "POST", body: JSON.stringify({ limit: 20, exclude }) });
      setRes(r);
      setDraft(Object.fromEntries(r.rows.map((x) => [x.id, x.suggestion])));
      setPicked(new Set(r.rows.filter((x) => x.source === "ai" && x.issues.length === 0 && x.suggestion !== x.ruleTitle).map((x) => x.id)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (open) {
      setRes(null);
      void load();
    }
    // 열 때마다 새로 받는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    const items = (res?.rows ?? []).filter((x) => picked.has(x.id)).map((x) => ({ id: x.id, title: (draft[x.id] ?? "").trim() })).filter((x) => x.title);
    if (items.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const out = await catalogFetch<{ updated: number; rows: CatalogProjectRow[] }>("/api/catalog/ai/labels", { method: "PUT", body: JSON.stringify({ items }) });
      onSaved(out.rows, out.updated);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CdModal
      open={open}
      onClose={busy ? () => undefined : onClose}
      size="xl"
      maxHeightClass="max-h-[90vh]"
      title={<span className="inline-flex items-center gap-1"><Sparkles className="w-4 h-4" /> 대외 표기 제안<CdHelp topic="catalog.project-label-ai" /></span>}
      footer={
        <>
          <button type="button" className="cd-btn cd-btn-ghost" onClick={onClose} disabled={busy}>닫기</button>
          <button type="button" className="cd-btn cd-btn-ghost" onClick={() => void load((res?.rows ?? []).map((x) => x.id))} disabled={busy}>다음 제안 받기</button>
          <button type="button" className="cd-btn cd-btn-primary" onClick={() => void save()} disabled={busy || picked.size === 0}>
            고른 {picked.size}건 확정
          </button>
        </>
      }
    >
      <div className="p-4 flex flex-col gap-3 text-sm">
        <p className="text-xs cd-text-muted">
          규칙으로 만든 대외 표기가 어색한 행(내부 표식·차수·변경계약·지나친 길이 등)만 모았습니다. 직접 정한 표기·검토 완료·통합환경허가 행은 빠집니다. 고쳐서 확정하면 검토 완료로 표시됩니다.
        </p>
        {busy && !res ? (
          <p className="cd-text-faint flex items-center gap-1.5">
            <Loader2 className="w-4 h-4 animate-spin" /> 제안을 만드는 중…
          </p>
        ) : null}
        {error ? <p className="cd-error-text">{error}</p> : null}
        {res ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className={res.source === "ai" ? "cd-pill cd-pill-info" : "cd-pill cd-pill-warn"}>{res.source === "ai" ? "AI 제안" : "규칙 표기"}</span>
              {res.fallback ? <span className="cd-text-muted">AI 를 쓰지 못했습니다 — {res.fallback}. 규칙 표기를 직접 고쳐 확정할 수 있습니다.</span> : null}
              <span className="cd-text-muted">
                어색한 행 {res.total.toLocaleString("ko-KR")}건 중 {res.rows.length}건
              </span>
            </div>
            {res.rows.length === 0 ? (
              <p className="cd-text-muted">어색한 규칙 표기가 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="cd-table">
                  <thead>
                    <tr>
                      <th className="w-8">
                        <input
                          type="checkbox"
                          aria-label="모두 고르기"
                          checked={picked.size === res.rows.length}
                          onChange={(e) => setPicked(e.target.checked ? new Set(res.rows.map((x) => x.id)) : new Set())}
                        />
                      </th>
                      <th>계약명 · 어색한 점</th>
                      <th>지금(규칙 표기)</th>
                      <th style={{ minWidth: 280 }}>제안(고칠 수 있음)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.rows.map((x) => (
                      <tr key={x.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${x.contractTitle} 고르기`}
                            checked={picked.has(x.id)}
                            onChange={(e) =>
                              setPicked((s) => {
                                const n = new Set(s);
                                if (e.target.checked) n.add(x.id);
                                else n.delete(x.id);
                                return n;
                              })
                            }
                          />
                        </td>
                        <td className="text-xs">
                          <div className="cd-text">{x.contractTitle}</div>
                          <div className="cd-text-faint">{x.category} · {x.reasons.join(", ")}</div>
                        </td>
                        <td className="text-xs cd-text-muted">{x.ruleTitle}</td>
                        <td>
                          <input
                            className="cd-input"
                            value={draft[x.id] ?? ""}
                            maxLength={200}
                            aria-label={`${x.contractTitle} 대외 표기`}
                            onChange={(e) => setDraft((d) => ({ ...d, [x.id]: e.target.value }))}
                          />
                          {x.issues.length ? <div className="text-xs cd-error-text mt-0.5">확인: {x.issues.join(", ")}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </div>
    </CdModal>
  );
}
