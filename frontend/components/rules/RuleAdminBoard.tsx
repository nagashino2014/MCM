"use client";

// 사규 임포트·검수(/rules/admin) — RB-P0.
// 흐름: HWPX 업로드 → 결정론 파싱으로 draft 판 생성 → 좌측 조문 트리에서 확인·수정 → 시행일 넣고 발행.
// 검수의 목적은 "원문 결함 정정"이다(2026.04.08. 개정판 실측: 본문은 '별표 6. 징계 양정 기준'을
// 인용하는데 말미 표제는 '별표 7'이다). 파서는 이런 불일치를 고치지 않고 경고로만 올린다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FileUp,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import type { RuleArticle, RuleBody, RuleVersionRow } from "@/lib/rules/types";
import "@/components/cdash/cdash.css";

interface RuleDoc {
  docId: string;
  title: string;
  category: string | null;
  versions: RuleVersionRow[];
}

const STATUS_LABEL: Record<string, string> = {
  draft: "검수 중",
  in_consent: "동의 진행",
  published: "시행 중",
  superseded: "지난 판",
};

const STATUS_TONE: Record<string, string> = {
  draft: "var(--cd-warning)",
  in_consent: "var(--cd-primary)",
  published: "var(--cd-success)",
  superseded: "var(--cd-faint)",
};

/** 조문 IR 안에서 key 로 조문을 찾아 바꾼 새 body 를 만든다(불변 갱신). */
function replaceArticle(body: RuleBody, key: string, next: RuleArticle): RuleBody {
  return {
    ...body,
    chapters: body.chapters.map((ch) => ({
      ...ch,
      articles: ch.articles.map((a) => (a.key === key ? next : a)),
    })),
    addendum: body.addendum.map((a) => (a.key === key ? next : a)),
  };
}

function findArticle(body: RuleBody, key: string): RuleArticle | null {
  for (const ch of body.chapters) for (const a of ch.articles) if (a.key === key) return a;
  return body.addendum.find((a) => a.key === key) ?? null;
}

export function RuleAdminBoard() {
  const { theme } = useCdashTheme();
  const [docs, setDocs] = useState<RuleDoc[]>([]);
  const [docId, setDocId] = useState("work-rules");
  const [versionId, setVersionId] = useState<string | null>(null);
  const [body, setBody] = useState<RuleBody | null>(null);
  const [versionRow, setVersionRow] = useState<RuleVersionRow | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [revisionNote, setRevisionNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/rules");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "규정 목록을 불러오지 못했습니다.");
      setDocs(json.documents ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "규정 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  const loadVersion = useCallback(async (id: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/rules/versions/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "판을 불러오지 못했습니다.");
      setVersionId(id);
      setVersionRow(json.version);
      setBody(json.version.body);
      setWarnings(json.warnings ?? []);
      setEffectiveDate(json.version.effectiveDate ?? "");
      setRevisionNote(json.version.revisionNote ?? "");
      setSelectedKey(null);
      setDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "판을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  const currentDoc = useMemo(() => docs.find((d) => d.docId === docId) ?? null, [docs, docId]);
  const versions = currentDoc?.versions ?? [];
  const selected = body && selectedKey ? findArticle(body, selectedKey) : null;
  const isDraft = versionRow?.status === "draft";

  const stats = useMemo(() => {
    if (!body) return null;
    const articles = body.chapters.reduce((n, c) => n + c.articles.length, 0);
    return {
      chapters: body.chapters.length,
      articles,
      addendum: body.addendum.length,
      appendices: body.appendices.length,
    };
  }, [body]);

  // ── 액션 ──

  async function handleUpload(file: File) {
    setBusy("업로드·파싱 중");
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("docId", docId);
      const res = await fetch("/api/rules/import", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "임포트에 실패했습니다.");
      const s = json.stats;
      setNotice(
        `임포트 완료 — ${s.chapters}개 장 · ${s.articles}개 조 · 부칙 ${s.addendum}개 조 · 별표 ${s.appendices}종` +
          (json.warnings?.length ? ` (확인 필요 ${json.warnings.length}건)` : ""),
      );
      await loadDocs();
      await loadVersion(json.version.versionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "임포트에 실패했습니다.");
    } finally {
      setBusy("");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleSave() {
    if (!versionId || !body) return;
    setBusy("저장 중");
    setError("");
    try {
      const res = await fetch(`/api/rules/versions/${versionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, effectiveDate: effectiveDate || null, revisionNote: revisionNote || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "저장하지 못했습니다.");
      setNotice("검수 내용을 저장했습니다.");
      setDirty(false);
      await loadDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function handlePublish() {
    if (!versionId) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      setError("시행일을 YYYY-MM-DD 형식으로 입력해 주세요.");
      return;
    }
    if (dirty) {
      setError("저장하지 않은 수정이 있습니다. 먼저 저장해 주세요.");
      return;
    }
    if (!window.confirm(`이 판을 ${effectiveDate}부터 시행하는 사규로 발행합니다.\n발행 후에는 조문을 수정할 수 없습니다. 진행할까요?`)) {
      return;
    }
    setBusy("발행 중");
    setError("");
    try {
      const res = await fetch(`/api/rules/versions/${versionId}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ effectiveDate }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "발행하지 못했습니다.");
      setNotice("발행했습니다. 이제 전 임직원이 규정집에서 열람할 수 있습니다.");
      setVersionRow(json.version);
      await loadDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "발행하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  async function handleDelete() {
    if (!versionId || !window.confirm("검수 중인 이 판을 폐기할까요?")) return;
    setBusy("삭제 중");
    try {
      const res = await fetch(`/api/rules/versions/${versionId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "삭제하지 못했습니다.");
      setVersionId(null);
      setBody(null);
      setVersionRow(null);
      setWarnings([]);
      await loadDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제하지 못했습니다.");
    } finally {
      setBusy("");
    }
  }

  function patchArticle(next: RuleArticle) {
    if (!body || !selectedKey) return;
    setBody(replaceArticle(body, selectedKey, next));
    setDirty(true);
  }

  /** 장 표제 정정 — 원문에 오타가 있다(실측: 본문 제9장이 "퇴직및해고 등", 목차는 "퇴직 및 해고 등"). */
  function patchChapter(index: number, patch: { no?: number; title?: string }) {
    if (!body) return;
    setBody({ ...body, chapters: body.chapters.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
    setDirty(true);
  }

  function patchAppendix(key: string, patch: { no?: number; title?: string }) {
    if (!body) return;
    setBody({
      ...body,
      appendices: body.appendices.map((a) =>
        a.key === key
          ? { ...a, ...patch, key: patch.no != null ? `appendix-${patch.no}` : a.key }
          : a,
      ),
    });
    setDirty(true);
  }

  // ── 렌더 ──

  return (
    <div className="cdash cd-fields-white min-h-screen p-6" data-theme={theme}>
      <CdPageHeader
        breadcrumbs={[{ label: "사규", href: "/rules" }, { label: "원문 임포트·검수" }]}
        title="사규 원문 임포트·검수"
        meta={stats ? `${stats.chapters}개 장 · ${stats.articles}개 조 · 별표 ${stats.appendices}종` : undefined}
        actions={
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".hwpx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
            />
            <button className="cd-btn" onClick={() => void loadDocs()} disabled={!!busy}>
              <RefreshCw className="w-4 h-4" /> 새로고침
            </button>
            <button className="cd-btn cd-btn-primary" onClick={() => fileRef.current?.click()} disabled={!!busy}>
              {busy === "업로드·파싱 중" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
              HWPX 임포트
            </button>
          </div>
        }
      />

      {(error || notice) && (
        <div
          className="mb-4 px-4 py-3 rounded-lg text-sm border"
          style={{
            borderColor: error ? "var(--cd-error)" : "var(--cd-success)",
            color: error ? "var(--cd-error)" : "var(--cd-success)",
          }}
        >
          {error || notice}
        </div>
      )}

      <div className="grid gap-4" style={{ gridTemplateColumns: "300px 1fr" }}>
        {/* 좌: 규정·판 목록 + 조문 트리 */}
        <div className="flex flex-col gap-4">
          <div className="cd-card p-4">
            <div className="text-[11px] font-bold mb-2" style={{ color: "var(--cd-faint)" }}>
              규정
            </div>
            <select
              className="cd-input w-full mb-3"
              value={docId}
              onChange={(e) => {
                setDocId(e.target.value);
                setVersionId(null);
                setBody(null);
                setVersionRow(null);
              }}
            >
              {docs.map((d) => (
                <option key={d.docId} value={d.docId}>
                  {d.title}
                </option>
              ))}
            </select>

            <div className="text-[11px] font-bold mb-2" style={{ color: "var(--cd-faint)" }}>
              판 이력
            </div>
            {loading && !versions.length ? (
              <div className="text-xs py-2" style={{ color: "var(--cd-muted)" }}>
                불러오는 중…
              </div>
            ) : !versions.length ? (
              <div className="text-xs py-2" style={{ color: "var(--cd-muted)" }}>
                아직 임포트한 판이 없습니다. 우측 상단에서 사규 HWPX 파일을 올려 주세요.
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {versions.map((v) => (
                  <button
                    key={v.versionId}
                    onClick={() => void loadVersion(v.versionId)}
                    className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-left text-xs transition-colors"
                    style={{
                      borderColor: v.versionId === versionId ? "var(--cd-primary)" : "var(--cd-border)",
                      background: v.versionId === versionId ? "var(--cd-primary-soft)" : "transparent",
                    }}
                  >
                    <span className="font-semibold">제{v.version}판</span>
                    <span className="flex items-center gap-2">
                      <span style={{ color: "var(--cd-muted)" }}>{v.effectiveDate ?? "시행일 미정"}</span>
                      <span className="font-bold" style={{ color: STATUS_TONE[v.status] }}>
                        {STATUS_LABEL[v.status]}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {body && (
            <div className="cd-card p-4 overflow-auto" style={{ maxHeight: "60vh" }}>
              <div className="text-[11px] font-bold mb-2" style={{ color: "var(--cd-faint)" }}>
                조문 트리
              </div>
              {body.chapters.map((ch) => (
                <div key={`ch-${ch.no}`} className="mb-3">
                  <div className="text-xs font-bold mb-1">
                    제{ch.no}장 {ch.title}
                  </div>
                  {ch.articles.map((a) => (
                    <button
                      key={a.key}
                      onClick={() => setSelectedKey(a.key)}
                      className="flex items-center gap-1 w-full px-2 py-1 rounded text-left text-xs transition-colors"
                      style={{
                        background: a.key === selectedKey ? "var(--cd-primary-soft)" : "transparent",
                        color: a.key === selectedKey ? "var(--cd-primary)" : "var(--cd-muted)",
                      }}
                    >
                      <ChevronRight className="w-3 h-3 shrink-0 opacity-50" />
                      <span className="truncate">
                        제{a.no}조 {a.title}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
              {body.addendum.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs font-bold mb-1">부칙</div>
                  {body.addendum.map((a) => (
                    <button
                      key={a.key}
                      onClick={() => setSelectedKey(a.key)}
                      className="flex items-center gap-1 w-full px-2 py-1 rounded text-left text-xs transition-colors"
                      style={{
                        background: a.key === selectedKey ? "var(--cd-primary-soft)" : "transparent",
                        color: a.key === selectedKey ? "var(--cd-primary)" : "var(--cd-muted)",
                      }}
                    >
                      <ChevronRight className="w-3 h-3 shrink-0 opacity-50" />
                      <span className="truncate">
                        제{a.no}조 {a.title}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 우: 검수 본문 */}
        <div className="flex flex-col gap-4">
          {!body ? (
            <div className="cd-card p-10 text-center text-sm" style={{ color: "var(--cd-muted)" }}>
              좌측에서 판을 선택하거나, 사규 HWPX 파일을 임포트해 주세요.
            </div>
          ) : (
            <>
              {/* 발행 패널 */}
              <div className="cd-card p-4">
                <div className="flex items-end gap-3 flex-wrap">
                  <div>
                    <label className="block text-[11px] font-bold mb-1" style={{ color: "var(--cd-faint)" }}>
                      시행일
                    </label>
                    <input
                      className="cd-input"
                      style={{ width: 150 }}
                      placeholder="YYYY-MM-DD"
                      value={effectiveDate}
                      disabled={!isDraft}
                      onChange={(e) => {
                        setEffectiveDate(e.target.value);
                        setDirty(true);
                      }}
                    />
                  </div>
                  <div className="flex-1 min-w-[220px]">
                    <label className="block text-[11px] font-bold mb-1" style={{ color: "var(--cd-faint)" }}>
                      개정 사유·비고
                    </label>
                    <input
                      className="cd-input w-full"
                      placeholder="예) 2026.04.08. 개정 원문 최초 등재"
                      value={revisionNote}
                      disabled={!isDraft}
                      onChange={(e) => {
                        setRevisionNote(e.target.value);
                        setDirty(true);
                      }}
                    />
                  </div>
                  {isDraft && (
                    <div className="flex items-center gap-2">
                      <button className="cd-btn" onClick={() => void handleSave()} disabled={!!busy}>
                        {busy === "저장 중" ? <Loader2 className="w-4 h-4 animate-spin" /> : null} 저장
                      </button>
                      <button className="cd-btn cd-btn-primary" onClick={() => void handlePublish()} disabled={!!busy}>
                        <Send className="w-4 h-4" /> 발행
                      </button>
                      <button className="cd-btn" onClick={() => void handleDelete()} disabled={!!busy}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                {!isDraft && versionRow && (
                  <div className="mt-3 text-xs flex items-center gap-2" style={{ color: "var(--cd-muted)" }}>
                    <CheckCircle2 className="w-4 h-4" style={{ color: STATUS_TONE[versionRow.status] }} />
                    {STATUS_LABEL[versionRow.status]} — 발행된 판은 수정할 수 없습니다. 개정은 새 판으로 진행합니다.
                  </div>
                )}
              </div>

              {/* 검수 경고 */}
              {warnings.length > 0 && (
                <div className="cd-card p-4">
                  <div className="flex items-center gap-2 text-sm font-bold mb-2" style={{ color: "var(--cd-warning)" }}>
                    <AlertTriangle className="w-4 h-4" /> 확인이 필요한 항목 {warnings.length}건
                  </div>
                  <ul className="flex flex-col gap-1 text-xs" style={{ color: "var(--cd-muted)" }}>
                    {warnings.map((w, i) => (
                      <li key={i}>· {w}</li>
                    ))}
                  </ul>
                  <div className="mt-2 text-[11px]" style={{ color: "var(--cd-faint)" }}>
                    파서는 원문을 임의로 고치지 않습니다. 위 항목은 원문 자체의 번호·표기 문제일 수 있으니 확인 후 아래에서 정정해 주세요.
                  </div>
                </div>
              )}

              {/* 조문 편집 */}
              {selected ? (
                <div className="cd-card p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-bold" style={{ color: "var(--cd-faint)" }}>
                      제{selected.no}조
                    </span>
                    <input
                      className="cd-input flex-1"
                      value={selected.title}
                      disabled={!isDraft}
                      onChange={(e) => patchArticle({ ...selected, title: e.target.value })}
                    />
                  </div>
                  {selected.clauses.map((c, ci) => (
                    <div key={ci} className="mb-3">
                      <div className="flex items-start gap-2">
                        <span className="text-sm font-bold pt-2 w-6 text-center shrink-0">{c.label || "—"}</span>
                        <textarea
                          className="cd-input flex-1"
                          rows={Math.max(2, Math.ceil(c.text.length / 60))}
                          value={c.text}
                          disabled={!isDraft}
                          onChange={(e) => {
                            const clauses = selected.clauses.map((x, i) =>
                              i === ci ? { ...x, text: e.target.value } : x,
                            );
                            patchArticle({ ...selected, clauses });
                          }}
                        />
                      </div>
                      {c.items.map((it, ii) => (
                        <div key={ii} className="flex items-start gap-2 mt-1 pl-8">
                          <textarea
                            className="cd-input flex-1"
                            rows={Math.max(1, Math.ceil(it.length / 60))}
                            value={it}
                            disabled={!isDraft}
                            onChange={(e) => {
                              const clauses = selected.clauses.map((x, i) =>
                                i === ci
                                  ? { ...x, items: x.items.map((y, j) => (j === ii ? e.target.value : y)) }
                                  : x,
                              );
                              patchArticle({ ...selected, clauses });
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  ))}
                  {selected.refs.length > 0 && (
                    <div className="text-[11px] mt-2" style={{ color: "var(--cd-faint)" }}>
                      인용 별표: {selected.refs.map((r) => r.replace("appendix-", "별표 ")).join(", ")}
                    </div>
                  )}
                  {selected.tables?.length ? (
                    <div className="text-[11px] mt-1" style={{ color: "var(--cd-faint)" }}>
                      조문 내 표 {selected.tables.length}개 — 원문 그대로 보존됩니다.
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="cd-card p-6 text-center text-sm" style={{ color: "var(--cd-muted)" }}>
                  좌측 트리에서 조문을 선택하면 내용을 확인·수정할 수 있습니다.
                </div>
              )}

              {/* 장 구성 */}
              <div className="cd-card p-4">
                <div className="text-[11px] font-bold mb-3" style={{ color: "var(--cd-faint)" }}>
                  장 구성 {body.chapters.length}개
                </div>
                <div className="flex flex-col gap-2">
                  {body.chapters.map((ch, i) => (
                    <div key={`chrow-${i}`} className="flex items-center gap-2 text-xs">
                      <span style={{ color: "var(--cd-faint)" }}>제</span>
                      <input
                        className="cd-input"
                        style={{ width: 60 }}
                        value={ch.no}
                        disabled={!isDraft}
                        onChange={(e) => patchChapter(i, { no: Number(e.target.value) || ch.no })}
                      />
                      <span style={{ color: "var(--cd-faint)" }}>장</span>
                      <input
                        className="cd-input flex-1"
                        value={ch.title}
                        disabled={!isDraft}
                        onChange={(e) => patchChapter(i, { title: e.target.value })}
                      />
                      <span className="shrink-0" style={{ color: "var(--cd-muted)" }}>
                        조 {ch.articles.length}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 별표 */}
              <div className="cd-card p-4">
                <div className="text-[11px] font-bold mb-3" style={{ color: "var(--cd-faint)" }}>
                  별표 {body.appendices.length}종
                </div>
                <div className="flex flex-col gap-2">
                  {body.appendices.map((ap) => (
                    <div key={ap.key} className="flex items-center gap-2 text-xs">
                      <span style={{ color: "var(--cd-faint)" }}>별표</span>
                      <input
                        className="cd-input"
                        style={{ width: 60 }}
                        value={ap.no}
                        disabled={!isDraft}
                        onChange={(e) => patchAppendix(ap.key, { no: Number(e.target.value) || ap.no })}
                      />
                      <input
                        className="cd-input flex-1"
                        value={ap.title}
                        disabled={!isDraft}
                        onChange={(e) => patchAppendix(ap.key, { title: e.target.value })}
                      />
                      <span className="shrink-0" style={{ color: "var(--cd-muted)" }}>
                        표 {ap.tables.length} · 문단 {ap.paras.length}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 개정 연혁 */}
              {body.history.length > 0 && (
                <div className="cd-card p-4">
                  <div className="text-[11px] font-bold mb-2" style={{ color: "var(--cd-faint)" }}>
                    원문에 기재된 개정 연혁 {body.history.length}건
                  </div>
                  <ul className="flex flex-col gap-1 text-xs" style={{ color: "var(--cd-muted)" }}>
                    {body.history.map((h, i) => (
                      <li key={i}>
                        · {h.date ?? "날짜 미상"} — {h.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
