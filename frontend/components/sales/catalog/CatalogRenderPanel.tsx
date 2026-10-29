"use client";

// 회사소개서 PDF — 마스터본을 지금 데이터로 만들어 미리 보고 받는다(블루프린트 §9, P4 렌더러). 관리 담당(catalog.manage).
// 만든 PDF 는 검토용 생성본으로 이력(catalog_editions)에 남는다. 발행 담당은 검토한 인쇄·배포본 생성본을 그대로 [발행]할 수 있다(P7).

import { useCallback, useEffect, useState } from "react";
import { Download, Eye, FileText, Loader2, MonitorPlay, Send } from "lucide-react";
import { CdHelp } from "@/components/cdash/CdHelp";
import type { CatalogEditionSummary } from "@/lib/catalog/render/editions";
import { EDITION_LABEL, NAMING_LABEL, SCOPE_LABEL, type EditionKind, type NamingMode, type ScopeMode } from "@/lib/catalog/render/types";
import { catalogFetch } from "./catalogFetch";

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`);
const fmtSec = (ms: number) => `${(ms / 1000).toFixed(1)}초`;
const fmtWhen = (iso: string) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

export function CatalogRenderPanel({
  docId = "master",
  docTitle,
  canPublish = false,
  onPublish,
}: {
  /** 문서 id(TP0 문서 복수화) — 없으면 마스터 */
  docId?: string;
  docTitle?: string;
  canPublish?: boolean;
  onPublish?: (edition: CatalogEditionSummary) => void;
}) {
  const [edition, setEdition] = useState<EditionKind>("print");
  const [naming, setNaming] = useState<NamingMode>("masked");
  const [scope, setScope] = useState<ScopeMode>("full");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<CatalogEditionSummary | null>(null);
  const [list, setList] = useState<CatalogEditionSummary[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setList((await catalogFetch<{ editions: CatalogEditionSummary[] }>(`/api/catalog/render/pdf?doc=${encodeURIComponent(docId)}`)).editions);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [docId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await catalogFetch<{ edition: CatalogEditionSummary }>("/api/catalog/render/pdf", {
        method: "POST",
        body: JSON.stringify({ doc: docId, edition, naming, scope }),
      });
      setLast(d.edition);
      setPreviewId(d.edition.editionId);
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const overflow = last?.warnings.filter((w) => w.kind === "overflow") ?? [];
  const otherWarnings = last?.warnings.filter((w) => w.kind !== "overflow") ?? [];

  return (
    <section className="cd-card p-4 mb-3">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <h3 className="cd-text font-semibold text-base flex items-center gap-1">
          <FileText className="w-4 h-4 cd-text-primary" /> 회사소개서 PDF <CdHelp topic="catalog.pdf" />
        </h3>
        <span className="text-xs cd-text-faint">{docId === "master" ? "마스터본" : docTitle || docId} · A4 가로 · 지금 데이터로 만듭니다</span>
      </div>
      <div className="flex items-end gap-3 flex-wrap">
        <label className="flex flex-col gap-1 text-xs cd-text-muted">
          판
          <select className="cd-select" style={{ width: "auto" }} value={edition} onChange={(e) => setEdition(e.target.value as EditionKind)} disabled={busy}>
            <option value="print">{EDITION_LABEL.print}</option>
            <option value="draft">{EDITION_LABEL.draft}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs cd-text-muted">
          범위
          <select className="cd-select" style={{ width: "auto" }} value={scope} onChange={(e) => setScope(e.target.value as ScopeMode)} disabled={busy}>
            <option value="full">{SCOPE_LABEL.full}</option>
            <option value="summary">{SCOPE_LABEL.summary}(부록 제외)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs cd-text-muted">
          이름 표기
          <select className="cd-select" style={{ width: "auto" }} value={naming} onChange={(e) => setNaming(e.target.value as NamingMode)} disabled={busy}>
            <option value="masked">{NAMING_LABEL.masked}</option>
            <option value="real">{NAMING_LABEL.real}</option>
          </select>
        </label>
        <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" onClick={generate} disabled={busy}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />} PDF 만들기
        </button>
        <a
          className="cd-btn cd-btn-ghost cd-btn-sm cd-action"
          href={`/api/catalog/render/html?edition=${edition}&naming=${naming}&scope=${scope}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <MonitorPlay className="w-3.5 h-3.5" /> HTML 미리보기
        </a>
        {busy && (
          <span className="text-xs cd-text-muted" role="status">
            데이터를 모아 쪽을 나누고 PDF 로 인쇄하는 중입니다(보통 1분 안).
          </span>
        )}
      </div>

      {error && <div className="cd-error-bg cd-error-text rounded-lg px-3 py-2 text-sm mt-3">{error}</div>}

      {last && (
        <div className="mt-3 rounded-lg border cd-border-c p-3 text-sm" role="status">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="cd-text font-semibold">{last.label}</span>
            <span className="cd-text-muted tabular-nums">
              {last.pages}쪽 · {fmtSize(last.sizeBytes)} · {fmtSec(last.totalMs)}
            </span>
            <span className={`cd-pill ${overflow.length ? "cd-pill-warn" : "cd-pill-success"}`}>넘침 경고 {overflow.length}건</span>
          </div>
          {overflow.length + otherWarnings.length > 0 && (
            <ul className="mt-2 text-xs cd-text-muted list-disc pl-5 space-y-0.5">
              {[...overflow, ...otherWarnings].slice(0, 30).map((w, i) => (
                <li key={i}>
                  {w.page ? `${w.page}쪽 · ` : ""}
                  {w.message}
                  {w.text ? ` — “${w.text}”` : ""}
                </li>
              ))}
            </ul>
          )}
          {last.notices.length > 0 && (
            <>
              <p className="text-xs cd-text font-semibold mt-2">확인할 내용</p>
              <ul className="text-xs cd-text-muted list-disc pl-5 space-y-0.5 mt-1">
                {last.notices.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {list.length > 0 && (
        <div className="overflow-x-auto mt-3">
          <table className="cd-table">
            <thead>
              <tr>
                <th>만든 때</th>
                <th>판</th>
                <th className="text-right">쪽</th>
                <th className="text-right">넘침 경고</th>
                <th className="text-right">크기</th>
                <th>만든 사람</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.editionId} data-active={previewId === e.editionId ? "true" : undefined}>
                  <td className="tabular-nums whitespace-nowrap">{fmtWhen(e.createdAt)}</td>
                  <td className="whitespace-nowrap">{e.label}</td>
                  <td className="text-right tabular-nums">{e.pages}</td>
                  <td className="text-right tabular-nums">{e.warnings.filter((w) => w.kind === "overflow").length}</td>
                  <td className="text-right tabular-nums whitespace-nowrap">{fmtSize(e.sizeBytes)}</td>
                  <td className="cd-text-muted">{e.createdByName || "—"}</td>
                  <td className="whitespace-nowrap text-right">
                    <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setPreviewId(previewId === e.editionId ? null : e.editionId)}>
                      <Eye className="w-3.5 h-3.5" /> 미리보기
                    </button>
                    <a className="cd-btn cd-btn-ghost cd-btn-sm cd-action ml-1" href={`/api/catalog/editions/${e.editionId}/pdf?download=1`}>
                      <Download className="w-3.5 h-3.5" /> 받기
                    </a>
                    {canPublish && onPublish && e.edition === "print" && (
                      <button type="button" className="cd-btn cd-btn-soft cd-btn-sm ml-1" onClick={() => onPublish(e)} title="이 PDF 를 그대로 발행본으로 확정">
                        <Send className="w-3.5 h-3.5" /> 발행
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previewId && (
        <iframe
          key={previewId}
          src={`/api/catalog/editions/${previewId}/pdf`}
          title="회사소개서 PDF 미리보기"
          className="w-full mt-3 rounded-lg border cd-border-c"
          style={{ height: "75vh", background: "var(--cd-card)" }}
        />
      )}
    </section>
  );
}
