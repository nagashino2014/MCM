"use client";

// 규정집 열람(/rules) — RB-P0 최소 열람(발행 결과 확인 경로).
// 좌측 목차(장→조) · 우측 조문 본문 · 별표는 표 그대로. 시행 중인 판이 기본이고 지난 판도 고를 수 있다.
// 검색·PDF 내려받기·열람률 집계는 RB-P1.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import type { RuleAppendix, RuleArticle, RuleBody, RuleVersionRow } from "@/lib/rules/types";
import "@/components/cdash/cdash.css";

interface RuleDoc {
  docId: string;
  title: string;
  category: string | null;
  versions: RuleVersionRow[];
}

function ArticleView({ article }: { article: RuleArticle }) {
  return (
    <div className="mb-6" id={article.key}>
      <div className="text-sm font-bold mb-2">
        제{article.no}조 【{article.title}】
      </div>
      {article.clauses.map((c, i) => (
        <div key={i} className="mb-2">
          <div className="text-sm leading-relaxed" style={{ color: "var(--cd-body)" }}>
            {c.label ? `${c.label} ` : ""}
            {c.text}
          </div>
          {c.items.map((it, j) => (
            <div key={j} className="text-sm leading-relaxed pl-5 mt-1" style={{ color: "var(--cd-muted)" }}>
              {it}
            </div>
          ))}
        </div>
      ))}
      {article.tables?.map((t, i) => (
        <TableView key={i} rows={t.rows} />
      ))}
    </div>
  );
}

function TableView({ rows }: { rows: RuleAppendix["tables"][number]["rows"] }) {
  return (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-xs border-collapse">
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  colSpan={cell.colSpan}
                  rowSpan={cell.rowSpan}
                  className="border px-2 py-1 align-top"
                  style={{ borderColor: "var(--cd-border)", background: ri === 0 ? "var(--cd-hover)" : undefined }}
                >
                  {cell.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RuleReaderBoard() {
  const { theme } = useCdashTheme();
  const [docs, setDocs] = useState<RuleDoc[]>([]);
  const [docId, setDocId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [body, setBody] = useState<RuleBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/rules");
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "규정집을 불러오지 못했습니다.");
        const list: RuleDoc[] = json.documents ?? [];
        setDocs(list);
        const first = list.find((d) => d.versions.some((v) => v.status === "published")) ?? list[0];
        if (first) {
          setDocId(first.docId);
          const pub = first.versions.find((v) => v.status === "published") ?? first.versions[0];
          if (pub) setVersionId(pub.versionId);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "규정집을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadVersion = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/rules/versions/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "판을 불러오지 못했습니다.");
      setBody(json.version.body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "판을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (versionId) void loadVersion(versionId);
  }, [versionId, loadVersion]);

  const doc = useMemo(() => docs.find((d) => d.docId === docId) ?? null, [docs, docId]);
  const version = doc?.versions.find((v) => v.versionId === versionId) ?? null;

  return (
    <div className="cdash cd-fields-white min-h-screen p-6" data-theme={theme}>
      <CdPageHeader
        title={doc?.title ?? "규정집"}
        meta={version ? `제${version.version}판 · ${version.effectiveDate ?? "시행일 미정"} 시행` : undefined}
        actions={
          <div className="flex items-center gap-2">
            {docs.length > 1 && (
              <select
                className="cd-input"
                style={{ width: 220 }}
                value={docId}
                onChange={(e) => {
                  const d = docs.find((x) => x.docId === e.target.value);
                  setDocId(e.target.value);
                  const pub = d?.versions.find((v) => v.status === "published") ?? d?.versions[0];
                  setVersionId(pub?.versionId ?? "");
                }}
              >
                {docs.map((d) => (
                  <option key={d.docId} value={d.docId}>
                    {d.title}
                  </option>
                ))}
              </select>
            )}
            {doc && doc.versions.length > 0 && (
              <select
                className="cd-input"
                style={{ width: 190 }}
                value={versionId}
                onChange={(e) => setVersionId(e.target.value)}
              >
                {doc.versions.map((v) => (
                  <option key={v.versionId} value={v.versionId}>
                    제{v.version}판 {v.status === "published" ? "(시행 중)" : v.status === "superseded" ? "(지난 판)" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
        }
      />

      {error && (
        <div className="mb-4 px-4 py-3 rounded-lg text-sm border" style={{ borderColor: "var(--cd-error)", color: "var(--cd-error)" }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="cd-card p-10 flex items-center justify-center gap-2 text-sm" style={{ color: "var(--cd-muted)" }}>
          <Loader2 className="w-4 h-4 animate-spin" /> 불러오는 중…
        </div>
      ) : !body ? (
        <div className="cd-card p-10 text-center text-sm" style={{ color: "var(--cd-muted)" }}>
          아직 시행 중인 사규가 없습니다. 관리자가 원문을 등재하면 이곳에서 열람할 수 있습니다.
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "260px 1fr" }}>
          {/* 목차 */}
          <div className="cd-card p-4 overflow-auto self-start" style={{ maxHeight: "78vh" }}>
            {body.chapters.map((ch) => (
              <div key={ch.no} className="mb-3">
                <a href={`#chapter-${ch.no}`} className="block text-xs font-bold mb-1">
                  제{ch.no}장 {ch.title}
                </a>
                {ch.articles.map((a) => (
                  <a
                    key={a.key}
                    href={`#${a.key}`}
                    className="block px-2 py-0.5 rounded text-xs truncate hover:underline"
                    style={{ color: "var(--cd-muted)" }}
                  >
                    제{a.no}조 {a.title}
                  </a>
                ))}
              </div>
            ))}
            {body.addendum.length > 0 && (
              <a href="#addendum" className="block text-xs font-bold mb-1">
                부칙
              </a>
            )}
            {body.appendices.length > 0 && (
              <a href="#appendices" className="block text-xs font-bold mt-2">
                별표
              </a>
            )}
          </div>

          {/* 본문 */}
          <div className="cd-card p-6 overflow-auto" style={{ maxHeight: "78vh" }}>
            {body.chapters.map((ch) => (
              <section key={ch.no} id={`chapter-${ch.no}`} className="mb-8">
                <h2 className="text-base font-extrabold mb-4 pb-2 border-b" style={{ borderColor: "var(--cd-border)" }}>
                  제{ch.no}장 {ch.title}
                </h2>
                {ch.articles.map((a) => (
                  <ArticleView key={a.key} article={a} />
                ))}
              </section>
            ))}

            {body.addendum.length > 0 && (
              <section id="addendum" className="mb-8">
                <h2 className="text-base font-extrabold mb-4 pb-2 border-b" style={{ borderColor: "var(--cd-border)" }}>
                  부칙
                </h2>
                {body.addendum.map((a) => (
                  <ArticleView key={a.key} article={a} />
                ))}
                {body.history.length > 0 && (
                  <div className="mt-4">
                    <div className="text-sm font-bold mb-2">개정</div>
                    {body.history.map((h, i) => (
                      <div key={i} className="text-sm mb-1" style={{ color: "var(--cd-muted)" }}>
                        {h.text}
                        {h.details.map((d, j) => (
                          <div key={j} className="pl-4 text-xs">
                            - {d}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {body.appendices.length > 0 && (
              <section id="appendices">
                <h2 className="text-base font-extrabold mb-4 pb-2 border-b" style={{ borderColor: "var(--cd-border)" }}>
                  별표
                </h2>
                {body.appendices.map((ap) => (
                  <div key={ap.key} id={ap.key} className="mb-6">
                    <div className="text-sm font-bold mb-2">
                      [별표 {ap.no}. {ap.title}]
                    </div>
                    {ap.paras.map((p, i) => (
                      <div key={i} className="text-sm leading-relaxed" style={{ color: "var(--cd-body)" }}>
                        {p}
                      </div>
                    ))}
                    {ap.tables.map((t, i) => (
                      <TableView key={i} rows={t.rows} />
                    ))}
                  </div>
                ))}
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
