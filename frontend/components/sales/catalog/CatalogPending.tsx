"use client";

// 회사소개서 반영 대기(P7) — 최근 발행본과 지금 데이터의 차이(추가·변경·삭제). 첫 화면·스튜디오 머리에 [반영 대기 N건] 단추를 둔다.
// 초안(스튜디오·PDF 만들기)은 이미 최신 데이터로 그려진다. 반영 대기는 "발행본에는 아직 없는 것"이고, 발행하면 해소된다.
// docs/company-catalog-blueprint.md §6-1·§6-7

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellDot, Loader2, RefreshCw, Send } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { CdHelp } from "@/components/cdash/CdHelp";
import { KIND_LABEL, SOURCE_LABEL, countBySource, type ChangeKind } from "@/lib/catalog/refresh/diff";
import type { PendingRow } from "@/lib/catalog/refresh/service";
import { catalogFetch } from "./catalogFetch";

export interface PendingPayload {
  items: PendingRow[];
  baseline: { editionId: string | null; publishedAt: string | null; label: string } | null;
  lastCheckedAt: string | null;
}

const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

const KIND_PILL: Record<ChangeKind, string> = { added: "cd-pill-success", changed: "cd-pill-info", removed: "cd-pill-error" };

/** 반영 대기 상태 — 단추와 대화상자가 함께 쓴다 */
export function usePending(enabled: boolean) {
  const [data, setData] = useState<PendingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      setData(await catalogFetch<PendingPayload>("/api/catalog/pending"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [enabled]);
  const recheck = useCallback(async () => {
    setChecking(true);
    try {
      setData(await catalogFetch<PendingPayload>("/api/catalog/pending", { method: "POST" }));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, checking, reload, recheck };
}

/** [반영 대기 N건] 단추 — 0건이면 '반영 대기 없음'으로 조용히 보인다 */
export function CatalogPendingButton({ count, onClick, loading }: { count: number | null; onClick: () => void; loading?: boolean }) {
  const has = (count ?? 0) > 0;
  return (
    <button type="button" className={`cd-btn cd-btn-sm ${has ? "cd-btn-soft" : "cd-btn-ghost"}`} onClick={onClick} aria-label={has ? `반영 대기 ${count}건 — 차이 보기` : "반영 대기 없음 — 차이 보기"}>
      {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BellDot className="w-3.5 h-3.5" />}
      {count == null ? "반영 대기" : has ? `반영 대기 ${count}건` : "반영 대기 없음"}
    </button>
  );
}

/** 차이 보기 대화상자 — 추가·변경·삭제로 거르고, 변경은 칸별 전후 값을 보여 준다 */
export function CatalogPendingModal({
  open,
  onClose,
  pending,
  canPublish,
  onPublish,
}: {
  open: boolean;
  onClose: () => void;
  pending: ReturnType<typeof usePending>;
  canPublish: boolean;
  onPublish: () => void;
}) {
  const [kind, setKind] = useState<ChangeKind | "all">("all");
  const items = useMemo(() => pending.data?.items ?? [], [pending.data]);
  const shown = kind === "all" ? items : items.filter((i) => i.kind === kind);
  const counts = { added: 0, changed: 0, removed: 0 } as Record<ChangeKind, number>;
  for (const i of items) counts[i.kind] += 1;
  const base = pending.data?.baseline;

  return (
    <CdModal
      open={open}
      onClose={onClose}
      size="lg"
      maxHeightClass="max-h-[88vh]"
      title={
        <span className="inline-flex items-center gap-1">
          반영 대기 — 발행본과 달라진 것
          <CdHelp topic="catalog.pending" />
        </span>
      }
      footer={
        <div className="flex flex-wrap items-center gap-2 w-full">
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => void pending.recheck()} disabled={pending.checking}>
            {pending.checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} 지금 다시 점검
          </button>
          <span className="text-xs cd-text-faint">마지막 점검 {fmtWhen(pending.data?.lastCheckedAt ?? null)}</span>
          {canPublish && (
            <button type="button" className="cd-btn cd-btn-primary cd-btn-sm ml-auto" onClick={onPublish}>
              <Send className="w-3.5 h-3.5" /> 발행하기
            </button>
          )}
        </div>
      }
    >
      <div className="p-4 flex flex-col gap-3 text-sm">
        <p className="text-xs cd-text-muted">
          {base
            ? base.editionId
              ? `기준: 최근 발행본(${fmtWhen(base.publishedAt)} 발행). 스튜디오·PDF 만들기는 이미 지금 데이터로 그립니다 — 발행하면 아래 항목이 발행본에 반영되고 목록이 비워집니다.`
              : `기준: 첫 점검(${fmtWhen(base.publishedAt)}) — 아직 발행본이 없습니다. 첫 발행 뒤로는 최근 발행본과 비교합니다.`
            : "아직 점검하지 않았습니다. [지금 다시 점검]을 누르면 지금 데이터를 기준으로 잡습니다."}
        </p>
        {pending.error && <div className="cd-error-bg cd-error-text rounded-lg px-3 py-2 text-sm">{pending.error}</div>}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="종류로 거르기">
          {(["all", "added", "changed", "removed"] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={`cd-btn cd-btn-sm ${kind === k ? "cd-btn-soft" : "cd-btn-ghost"}`}
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              {k === "all" ? `전체 ${items.length}` : `${KIND_LABEL[k]} ${counts[k]}`}
            </button>
          ))}
          <span className="text-xs cd-text-faint ml-auto">
            {countBySource(items)
              .map((c) => `${c.label} ${c.count}`)
              .join(" · ")}
          </span>
        </div>
        {shown.length === 0 ? (
          <p className="text-sm cd-text-faint py-6 text-center">{items.length ? "해당하는 항목이 없습니다." : "발행본과 달라진 것이 없습니다."}</p>
        ) : (
          <ul className="flex flex-col divide-y cd-border-c rounded-lg border cd-border-c">
            {shown.map((i) => (
              <li key={i.changeId} className="px-3 py-2 flex flex-col gap-1">
                <div className="flex items-start gap-2">
                  <span className={`cd-pill ${KIND_PILL[i.kind]} shrink-0`}>{KIND_LABEL[i.kind]}</span>
                  <span className="cd-pill cd-pill-idle shrink-0">{SOURCE_LABEL[i.source] ?? i.source}</span>
                  <span className="cd-text min-w-0 break-keep">{i.summary}</span>
                  <span className="text-[11px] cd-text-faint ml-auto whitespace-nowrap tabular-nums">{fmtWhen(i.detectedAt).slice(6)}</span>
                </div>
                {i.kind === "changed" && i.fields.length > 0 && (
                  <dl className="grid gap-x-3 gap-y-0.5 text-xs pl-1" style={{ gridTemplateColumns: "max-content minmax(0, 1fr)" }}>
                    {i.fields.slice(0, 6).map((f) => (
                      <div key={f.name} className="contents">
                        <dt className="cd-text-faint">{f.name}</dt>
                        <dd className="cd-text-muted break-all">
                          <span className="line-through cd-text-faint">{f.before || "(없음)"}</span> → <span className="cd-text">{f.after || "(없음)"}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </CdModal>
  );
}
