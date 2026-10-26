"use client";

// 회사소개서 발행본(P7) — 전 직원이 보는 대외 배포본 목록. 마스킹판은 누구나 받고, 실명판은 관리·발행 담당만 받는다.
// 발행본은 발행 때 PDF 를 고정 보관하므로 이후 데이터가 바뀌어도 같은 파일을 받는다.
// 관리·발행 담당은 행을 펼쳐 배포 기록(누구에게 냈는지)을 남긴다. docs/company-catalog-blueprint.md §6-1·§6-6

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, Download, Eye, Library, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import { CdHelp } from "@/components/cdash/CdHelp";
import { CdDateInput, isValidDateString } from "@/components/cdash/CdField";
import type { CatalogDistribution, CatalogEditionSummary } from "@/lib/catalog/render/editions";
import { catalogFetch } from "./catalogFetch";

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`);
const fmtDay = (iso: string) => (iso ? new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }) : "—");

export function CatalogEditionsPanel({
  editions,
  loading,
  steward,
  onChanged,
}: {
  editions: CatalogEditionSummary[];
  loading: boolean;
  /** 관리·발행 담당 — 실명판 받기·배포 기록 */
  steward: boolean;
  onChanged: (editionId: string, distributions: CatalogDistribution[]) => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const latest = editions[0] ?? null;

  return (
    <section className="cd-card p-4 mb-3">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <h3 className="cd-text font-semibold text-base flex items-center gap-1">
          <Library className="w-4 h-4 cd-text-primary" /> 발행본 <CdHelp topic="catalog.editions" />
        </h3>
        <span className="text-xs cd-text-faint">
          {latest ? `최근 발행 ${fmtDay(latest.createdAt)} · ${latest.label}` : "대외 배포용으로 확정한 판입니다. 받은 파일을 그대로 보내면 됩니다."}
        </span>
      </div>
      {editions.length === 0 ? (
        <p className="text-sm cd-text-faint py-4 text-center">{loading ? "불러오는 중…" : "아직 발행한 회사소개서가 없습니다."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="cd-table">
            <thead>
              <tr>
                <th>발행일</th>
                <th>판</th>
                {/* 1024 폭에서도 받기 단추가 잘리지 않게 기준일·크기는 넓은 화면에서만 */}
                <th className="hidden xl:table-cell">데이터 기준일</th>
                <th className="text-right">쪽</th>
                <th className="text-right hidden xl:table-cell">크기</th>
                <th>발행한 사람</th>
                {steward && <th>배포 기록</th>}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {editions.map((e) => {
                const locked = e.naming === "real" && !steward;
                const expanded = openId === e.editionId;
                return (
                  <Fragment key={e.editionId}>
                    <tr data-active={previewId === e.editionId || expanded ? "true" : undefined}>
                      <td className="tabular-nums whitespace-nowrap">{fmtDay(e.createdAt)}</td>
                      <td className="whitespace-nowrap">
                        {e.label}
                        {e === latest && <span className="cd-pill cd-pill-info ml-1">최신</span>}
                      </td>
                      <td className="tabular-nums whitespace-nowrap hidden xl:table-cell">{e.asOf || "—"}</td>
                      <td className="text-right tabular-nums">{e.pages}</td>
                      <td className="text-right tabular-nums whitespace-nowrap hidden xl:table-cell">{fmtSize(e.sizeBytes)}</td>
                      <td className="cd-text-muted">{e.createdByName || "—"}</td>
                      {steward && (
                        <td className="whitespace-nowrap">
                          <button
                            type="button"
                            className="cd-btn cd-btn-ghost cd-btn-sm max-w-[220px]"
                            aria-expanded={expanded}
                            onClick={() => setOpenId(expanded ? null : e.editionId)}
                            title={e.distributions.map((d) => d.recipient).join(", ") || undefined}
                          >
                            {expanded ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
                            <span className="truncate">{e.distributions.length ? `${e.distributions.length}곳 · ${e.distributions[0].recipient}` : "기록 남기기"}</span>
                          </button>
                        </td>
                      )}
                      <td className="whitespace-nowrap text-right">
                        {locked ? (
                          <span className="text-xs cd-text-faint inline-flex items-center gap-1" title="실명판은 관리·발행 담당만 받을 수 있습니다">
                            <Lock className="w-3.5 h-3.5" /> 담당자만
                          </span>
                        ) : (
                          <>
                            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setPreviewId(previewId === e.editionId ? null : e.editionId)}>
                              <Eye className="w-3.5 h-3.5" /> 미리보기
                            </button>
                            <a className="cd-btn cd-btn-ghost cd-btn-sm cd-action ml-1" href={`/api/catalog/editions/${e.editionId}/pdf?download=1`}>
                              <Download className="w-3.5 h-3.5" /> 받기
                            </a>
                          </>
                        )}
                      </td>
                    </tr>
                    {steward && expanded && (
                      <tr>
                        <td colSpan={8} className="!bg-transparent">
                          <DistributionEditor edition={e} onChanged={(d) => onChanged(e.editionId, d)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {previewId && (
        <iframe
          key={previewId}
          src={`/api/catalog/editions/${previewId}/pdf`}
          title="회사소개서 발행본 미리보기"
          className="w-full mt-3 rounded-lg border cd-border-c"
          style={{ height: "75vh", background: "var(--cd-card)" }}
        />
      )}
    </section>
  );
}

function DistributionEditor({ edition, onChanged }: { edition: CatalogEditionSummary; onChanged: (d: CatalogDistribution[]) => void }) {
  const [recipient, setRecipient] = useState("");
  const [purpose, setPurpose] = useState("");
  const [givenOn, setGivenOn] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dateBad = givenOn !== "" && !isValidDateString(givenOn);
  const url = `/api/catalog/editions/${encodeURIComponent(edition.editionId)}/distributions`;

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const d = await catalogFetch<{ distributions: CatalogDistribution[] }>(url, { method: "POST", body: JSON.stringify({ recipient, purpose, givenOn, note }) });
      onChanged(d.distributions);
      setRecipient("");
      setPurpose("");
      setGivenOn("");
      setNote("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (distId: string) => {
    setBusy(true);
    setError(null);
    try {
      onChanged((await catalogFetch<{ distributions: CatalogDistribution[] }>(`${url}?distId=${encodeURIComponent(distId)}`, { method: "DELETE" })).distributions);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border cd-border-c p-3 flex flex-col gap-2 text-sm">
      <p className="text-xs cd-text-muted">{edition.label} 을(를) 낸 곳 — 실명판은 개인정보가 실리니 받는 곳·용도를 꼭 남기세요.</p>
      {edition.distributions.length > 0 && (
        <ul className="flex flex-col gap-1">
          {edition.distributions.map((d) => (
            <li key={d.distId} className="flex items-center gap-2 flex-wrap">
              <span className="tabular-nums cd-text-faint text-xs">{d.givenOn || fmtDay(d.createdAt)}</span>
              <span className="cd-text font-semibold">{d.recipient}</span>
              {d.purpose && <span className="cd-pill cd-pill-idle">{d.purpose}</span>}
              {d.note && <span className="text-xs cd-text-muted">{d.note}</span>}
              <span className="text-xs cd-text-faint">기록 {d.createdByName || "—"}</span>
              <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm ml-auto" onClick={() => void remove(d.distId)} disabled={busy} aria-label={`${d.recipient} 배포 기록 지우기`}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-start gap-2">
        <input className="cd-input" style={{ width: 220 }} placeholder="받은 곳(기관·회사·담당자)" value={recipient} onChange={(e) => setRecipient(e.target.value)} aria-label="받은 곳" />
        <input className="cd-input" style={{ width: 160 }} placeholder="용도(예: 입찰 PQ)" value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="용도" />
        <CdDateInput value={givenOn} onChange={setGivenOn} style={{ width: 130 }} placeholder="낸 날" aria-label="낸 날" error={dateBad ? "날짜를 확인하세요" : undefined} />
        <input className="cd-input" style={{ width: 200 }} placeholder="메모" value={note} onChange={(e) => setNote(e.target.value)} aria-label="메모" />
        <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => void add()} disabled={busy || !recipient.trim() || dateBad}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} 배포 기록 추가
        </button>
      </div>
      {error && <p className="cd-error-text text-xs">{error}</p>}
    </div>
  );
}
