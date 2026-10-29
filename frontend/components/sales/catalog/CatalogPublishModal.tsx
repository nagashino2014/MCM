"use client";

// 회사소개서 발행(P7) — 판(풀버전·요약본 × 마스킹판·실명판)을 골라 지금 데이터로 배포본 PDF 를 만들고 발행본으로 고정한다.
// 넘침 경고가 있으면 바로 발행하지 않고 확인을 받는다([그래도 발행]). 검토한 생성본을 그대로 발행할 때는 fromEdition 을 넘긴다.
// 발행본은 PDF·데이터 스냅샷을 고정 보관해 이후 데이터가 바뀌어도 같은 파일을 받는다. docs/company-catalog-blueprint.md §6-1·§6-6

import { useEffect, useState } from "react";
import { Download, Loader2, Send } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdHelp } from "@/components/cdash/CdHelp";
import { CdDateInput, isValidDateString } from "@/components/cdash/CdField";
import type { CatalogEditionSummary } from "@/lib/catalog/render/editions";
import { NAMING_LABEL, SCOPE_LABEL, type NamingMode, type ScopeMode } from "@/lib/catalog/render/types";

const SCOPE_DESC: Record<ScopeMode, string> = { full: "본편 + 부록(수행실적 목록)", summary: "본편만 — 부록을 뺀 짧은 판" };
const NAMING_DESC: Record<NamingMode, string> = {
  masked: "홍보·공개용 — 이름 가운데 글자를 ○로, 사람 사진은 빼고 이니셜",
  real: "입찰 PQ·수의계약 제출용 — 실명·사진, 풀버전엔 부록 C(수행인력 상세 이력)",
};

class NeedsConfirm extends Error {
  edition: CatalogEditionSummary;
  constructor(edition: CatalogEditionSummary) {
    super("넘침 경고");
    this.edition = edition;
  }
}

async function postPublish(url: string, body: unknown): Promise<CatalogEditionSummary> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as { edition?: CatalogEditionSummary; needsConfirm?: boolean; error?: string };
  if (res.status === 409 && data.needsConfirm && data.edition) throw new NeedsConfirm(data.edition);
  if (!res.ok || !data.edition) throw new Error(data.error ?? `요청 실패 (HTTP ${res.status})`);
  return data.edition;
}

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`);

export function CatalogPublishModal({
  open,
  onClose,
  onPublished,
  pendingCount,
  fromEdition,
  docId = "master",
}: {
  open: boolean;
  onClose: () => void;
  onPublished: (edition: CatalogEditionSummary) => void;
  /** 발행할 문서(TP0 문서 복수화) — 없으면 마스터 */
  docId?: string;
  /** 이 발행으로 해소될 반영 대기 건수(안내용) */
  pendingCount?: number | null;
  /** 검토한 생성본을 그대로 발행 */
  fromEdition?: CatalogEditionSummary | null;
}) {
  const [scope, setScope] = useState<ScopeMode>("full");
  const [naming, setNaming] = useState<NamingMode>("masked");
  const [recipient, setRecipient] = useState("");
  const [purpose, setPurpose] = useState("");
  const [givenOn, setGivenOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<CatalogEditionSummary | null>(null);
  const [done, setDone] = useState<CatalogEditionSummary | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setConfirm(null);
    setDone(null);
    setRecipient("");
    setPurpose("");
    setGivenOn("");
  }, [open]);

  const dateBad = givenOn !== "" && !isValidDateString(givenOn);
  const dist = recipient.trim() ? { recipient: recipient.trim(), purpose: purpose.trim(), givenOn } : {};

  const run = async (promoteId?: string) => {
    setBusy(true);
    setError(null);
    try {
      const edition = promoteId
        ? await postPublish(`/api/catalog/editions/${encodeURIComponent(promoteId)}/publish`, dist)
        : await postPublish("/api/catalog/editions", { doc: docId, scope, naming, ...dist });
      setConfirm(null);
      setDone(edition);
      onPublished(edition);
    } catch (e) {
      if (e instanceof NeedsConfirm) setConfirm(e.edition);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const overflow = confirm?.warnings.filter((w) => w.kind === "overflow") ?? [];
  const source = fromEdition ?? null;

  return (
    <CdModal
      open={open}
      onClose={busy ? () => undefined : onClose}
      size="md"
      closeOnBackdrop={!busy}
      title={
        <span className="inline-flex items-center gap-1">
          회사소개서 발행
          <CdHelp topic="catalog.publish" />
        </span>
      }
    >
      <div className="p-4 flex flex-col gap-3 text-sm">
        {done ? (
          <div className="flex flex-col gap-2" role="status">
            <p className="cd-text font-semibold">발행했습니다 — {done.label}</p>
            <p className="text-xs cd-text-muted tabular-nums">
              {done.pages}쪽 · {fmtSize(done.sizeBytes)} · 데이터 기준일 {done.asOf || "—"}
              {done.resolvedCount > 0 ? ` · 반영 대기 ${done.resolvedCount}건 해소` : ""}
            </p>
            <p className="text-xs cd-text-faint">발행본은 고정됩니다. 앞으로 데이터가 바뀌어도 이 파일은 그대로이고, 바뀐 것은 반영 대기로 모입니다.</p>
            <div className="flex gap-2">
              <a className="cd-btn cd-btn-soft cd-btn-sm cd-action" href={`/api/catalog/editions/${done.editionId}/pdf?download=1`}>
                <Download className="w-3.5 h-3.5" /> {done.fileName || "PDF"} 받기
              </a>
              <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>
                닫기
              </button>
            </div>
          </div>
        ) : (
          <>
            {source ? (
              <p className="text-xs cd-text-muted">
                검토한 생성본 <b className="cd-text">{source.label}</b>({source.pages}쪽)을 다시 만들지 않고 그대로 발행합니다.
              </p>
            ) : (
              <>
                <fieldset className="flex flex-col gap-1.5" disabled={busy}>
                  <legend className="text-xs cd-text-muted mb-1">범위</legend>
                  {(["full", "summary"] as const).map((v) => (
                    <label key={v} className="flex items-start gap-2 cursor-pointer">
                      <input type="radio" name="catalog-publish-scope" value={v} checked={scope === v} onChange={() => setScope(v)} className="mt-1" />
                      <span>
                        <span className="cd-text font-semibold">{SCOPE_LABEL[v]}</span>
                        <span className="block text-xs cd-text-faint">{SCOPE_DESC[v]}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <fieldset className="flex flex-col gap-1.5" disabled={busy}>
                  <legend className="text-xs cd-text-muted mb-1">이름 표기</legend>
                  {(["masked", "real"] as const).map((v) => (
                    <label key={v} className="flex items-start gap-2 cursor-pointer">
                      <input type="radio" name="catalog-publish-naming" value={v} checked={naming === v} onChange={() => setNaming(v)} className="mt-1" />
                      <span>
                        <span className="cd-text font-semibold">{NAMING_LABEL[v]}</span>
                        <span className="block text-xs cd-text-faint">{NAMING_DESC[v]}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </>
            )}
            <fieldset className="flex flex-col gap-2" disabled={busy}>
              <legend className="text-xs cd-text-muted mb-1">배포처(선택) — 누구에게 내는지 바로 기록</legend>
              <input className="cd-input" placeholder="받는 곳(기관·회사·담당자)" value={recipient} onChange={(e) => setRecipient(e.target.value)} aria-label="받는 곳" />
              {recipient.trim() && (
                <div className="flex flex-wrap gap-2">
                  <input className="cd-input" style={{ width: 200 }} placeholder="용도(예: 입찰 PQ)" value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="용도" />
                  <CdDateInput value={givenOn} onChange={setGivenOn} style={{ width: 130 }} placeholder="낸 날" aria-label="낸 날" error={dateBad ? "날짜를 확인하세요" : undefined} />
                </div>
              )}
            </fieldset>
            {pendingCount != null && pendingCount > 0 && <p className="text-xs cd-text-muted">발행하면 반영 대기 {pendingCount}건이 이 발행본으로 해소됩니다.</p>}
            <p className="text-xs cd-text-faint">대외 문서입니다. 발행본은 고치거나 지울 수 없고, 전 직원이 목록에서 마스킹판을 받을 수 있습니다(실명판은 관리·발행 담당만).</p>

            {confirm && (
              <div className="rounded-lg border cd-border-c p-3 flex flex-col gap-1.5" role="alert">
                <p className="cd-text font-semibold">넘침 경고 {overflow.length}건 — 이대로 발행할까요?</p>
                <ul className="text-xs cd-text-muted list-disc pl-5 space-y-0.5">
                  {overflow.slice(0, 8).map((w, i) => (
                    <li key={i}>
                      {w.page ? `${w.page}쪽 · ` : ""}
                      {w.message}
                    </li>
                  ))}
                </ul>
                <p className="text-xs cd-text-faint">스튜디오에서 고친 뒤 다시 발행해도 됩니다. 만든 PDF 는 생성본 목록에 남습니다.</p>
                <div className="flex gap-2">
                  <a className="cd-btn cd-btn-ghost cd-btn-sm cd-action" href={`/api/catalog/editions/${confirm.editionId}/pdf`} target="_blank" rel="noopener noreferrer">
                    PDF 열어 보기
                  </a>
                  <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" onClick={() => void run(confirm.editionId)} disabled={busy}>
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} 그래도 발행
                  </button>
                </div>
              </div>
            )}
            {error && <div className="cd-error-bg cd-error-text rounded-lg px-3 py-2 text-sm">{error}</div>}
            {!confirm && (
              <div className="flex items-center gap-2">
                <button type="button" className="cd-btn cd-btn-primary" onClick={() => void run(source?.editionId)} disabled={busy || dateBad}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {busy ? (source ? "발행하는 중…" : "PDF 를 만들어 발행하는 중…") : "발행"}
                </button>
                {busy && !source && <span className="text-xs cd-text-muted">보통 1분 안에 끝납니다.</span>}
              </div>
            )}
          </>
        )}
      </div>
    </CdModal>
  );
}
