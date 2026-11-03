"use client";

// 계약서 버전 이력·버전 비교(336, 2026-11-03) — 작성 화면 상단 카드와 비교 모달.
// 이력 = 같은 계약서(원본 v1 묶음)의 전 버전(작성 중 포함). 비교 = 두 버전의 갑지 항목·지급 단계·조문 차이.

import { useEffect, useMemo, useState } from "react";
import { GitCompare, History, X } from "lucide-react";
import { CdHelp } from "@/components/cdash/CdHelp";
import { DOC_STAGE_LABEL, versionStateLabel, type DocVersionItem } from "@/lib/approval/doc-stage";
import { diffLines } from "@/lib/approval/line-diff";
import type { AgreementClause, AgreementFieldValues } from "@/lib/agreement/types";

type VersionWithValues = DocVersionItem & { fieldValues?: AgreementFieldValues };

const shortDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const m = /^(\d{2})(\d{2})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[2]}-${m[3]}-${m[4]} ${m[5]}:${m[6]}` : iso.slice(0, 10);
};
const won = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(n).toLocaleString("ko-KR")}원`);

/** 버전 이력 카드 — 현재 문서 행 강조, 두 버전을 골라 비교 */
export function AgreementVersionCard({
  items,
  currentDocId,
  onCompare,
}: {
  items: DocVersionItem[];
  currentDocId: string | null;
  onCompare: (olderDocId: string, newerDocId: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (docId: string) =>
    setPicked((prev) => (prev.includes(docId) ? prev.filter((d) => d !== docId) : [...prev.slice(-1), docId]));
  const runCompare = () => {
    if (picked.length !== 2) return;
    const [a, b] = picked
      .map((id) => items.find((it) => it.docId === id))
      .filter((it): it is DocVersionItem => !!it)
      .sort((x, y) => x.version - y.version);
    if (a && b) onCompare(a.docId, b.docId);
  };
  return (
    <div className="cd-card rounded-lg p-5 flex flex-col gap-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="font-semibold cd-text text-sm flex items-center gap-2">
          <History className="w-4 h-4 cd-text-primary" /> 버전 이력
        </h3>
        <CdHelp topic="contracts.agreement-versions" />
        <button
          type="button"
          className="ml-auto cd-btn rounded-lg border cd-border-c px-2.5 py-1.5 text-[11px] font-semibold flex items-center gap-1 disabled:opacity-40"
          disabled={picked.length !== 2}
          onClick={runCompare}
          title="두 버전을 선택하면 갑지 항목·조문 차이를 비교합니다"
        >
          <GitCompare className="w-3.5 h-3.5" /> 버전 비교
        </button>
      </div>
      <ul className="rounded-lg border cd-border-c overflow-hidden">
        {items.map((it) => {
          const current = it.docId === currentDocId;
          const sends = it.sendHistory.length;
          const lastSend = sends ? it.sendHistory[sends - 1].sentAt : null;
          return (
            <li
              key={it.docId}
              className={`flex items-center gap-3 px-3 py-2.5 text-[12px] border-b cd-border-c last:border-b-0 flex-wrap ${current ? "cd-tint-primary" : ""}`}
            >
              <input
                type="checkbox"
                aria-label={`v${it.version} 비교 선택`}
                checked={picked.includes(it.docId)}
                onChange={() => toggle(it.docId)}
              />
              <span className={`font-mono font-semibold w-7 ${current ? "cd-text-primary" : "cd-text"}`}>v{it.version}</span>
              <span className="text-[11px] rounded-full px-2 py-0.5 border cd-border-c cd-text">{DOC_STAGE_LABEL[it.stage]}</span>
              <span className="cd-text-faint">{versionStateLabel(it)}</span>
              <span className="cd-text-faint">{it.drafterName ?? "—"}</span>
              <span className="ml-auto flex items-center gap-2 flex-wrap">
                <span className="cd-text-faint tabular-nums">{sends ? `송부 ${sends}회 · ${shortDate(lastSend)}` : "송부 전"}</span>
                {current ? (
                  <span className="text-[11px] cd-text-primary font-semibold">지금 보는 버전</span>
                ) : (
                  <a className="cd-action rounded-lg border cd-border-c px-2 py-0.5 text-[11px] cd-text-primary hover:cd-tint-primary" href={`/contracts/agreements?docId=${encodeURIComponent(it.docId)}`}>
                    열기
                  </a>
                )}
                <a
                  className="cd-action rounded-lg border cd-border-c px-2 py-0.5 text-[11px] cd-text"
                  href={`/api/contracts/agreements/${encodeURIComponent(it.docId)}/pdf?disposition=inline`}
                  target="_blank"
                  rel="noreferrer"
                >
                  PDF
                </a>
              </span>
              {it.revisionNote ? <span className="basis-full pl-10 text-[11px] cd-text-faint">변경 메모: {it.revisionNote}</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── 비교 ──

type FieldRow = { label: string; before: string; after: string };

function paymentsText(fv: AgreementFieldValues | undefined): string {
  return (fv?.payments ?? []).map((p) => `${p.label} ${p.ratio}% ${won(p.amount)} — ${p.condition}`).join("\n");
}

function fieldRows(a: AgreementFieldValues | undefined, b: AgreementFieldValues | undefined): FieldRow[] {
  const pick = (fv: AgreementFieldValues | undefined) => ({
    계약명: fv?.title ?? "",
    발주처: fv?.orderer?.name ?? "",
    "공급가(VAT 별도)": won(fv?.amountSupply ?? null),
    계약기간: fv?.periodText ?? "",
    용역범위: fv?.scopeText ?? "",
    체결일: fv?.issueDate ?? "",
    "대금 지급 조건": paymentsText(fv),
  });
  const x = pick(a);
  const y = pick(b);
  return (Object.keys(x) as (keyof typeof x)[]).map((k) => ({ label: k, before: x[k], after: y[k] }));
}

type ClauseRow = { key: string; status: "same" | "changed" | "added" | "removed"; before?: AgreementClause; after?: AgreementClause };

/** 조문 짝짓기 — 안정 id 우선, 없으면 제목. 이후 버전 순서 + 삭제된 조문은 원래 자리 근처에 */
function clauseRows(a: AgreementClause[], b: AgreementClause[]): ClauseRow[] {
  const used = new Set<number>();
  const findBefore = (c: AgreementClause) => {
    let i = a.findIndex((x, xi) => !used.has(xi) && x.id === c.id);
    if (i < 0) i = a.findIndex((x, xi) => !used.has(xi) && x.title.trim() === c.title.trim());
    return i;
  };
  const rows: ClauseRow[] = [];
  b.forEach((c, bi) => {
    const i = findBefore(c);
    if (i < 0) {
      rows.push({ key: `add-${bi}`, status: "added", after: c });
      return;
    }
    used.add(i);
    const prev = a[i];
    rows.push({ key: `pair-${bi}`, status: prev.title === c.title && prev.body === c.body ? "same" : "changed", before: prev, after: c });
  });
  a.forEach((c, ai) => {
    if (!used.has(ai)) rows.push({ key: `del-${ai}`, status: "removed", before: c });
  });
  return rows;
}

const STATUS_LABEL: Record<ClauseRow["status"], string> = { same: "같음", changed: "수정", added: "추가", removed: "삭제" };

function DiffBlock({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  return (
    <pre className="rounded-lg border cd-border-c px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap font-sans">
      {lines.map((l, i) => (
        <div
          key={i}
          className={l.kind === "same" ? "cd-text" : l.kind === "add" ? "cd-text cd-tint-primary" : "cd-text-faint line-through"}
          style={l.kind === "del" ? { background: "rgba(250,137,107,0.12)" } : undefined}
        >
          {l.kind === "add" ? "+ " : l.kind === "del" ? "− " : "  "}
          {l.text || " "}
        </div>
      ))}
    </pre>
  );
}

export function AgreementCompareModal({
  theme,
  anyDocId,
  olderDocId,
  newerDocId,
  onClose,
}: {
  theme: string;
  anyDocId: string;
  olderDocId: string;
  newerDocId: string;
  onClose: () => void;
}) {
  const [items, setItems] = useState<VersionWithValues[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changedOnly, setChangedOnly] = useState(true);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/contracts/agreements/versions?docId=${encodeURIComponent(anyDocId)}&values=1`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d?.error ?? "버전을 불러오지 못했습니다.");
        if (!cancelled) setItems(Array.isArray(d.items) ? d.items : []);
      })
      .catch((err) => !cancelled && setError((err as Error).message));
    return () => {
      cancelled = true;
    };
  }, [anyDocId]);

  const older = items?.find((it) => it.docId === olderDocId);
  const newer = items?.find((it) => it.docId === newerDocId);
  const fields = fieldRows(older?.fieldValues, newer?.fieldValues);
  const clauses = clauseRows(older?.fieldValues?.clauses ?? [], newer?.fieldValues?.clauses ?? []);
  const shownFields = changedOnly ? fields.filter((f) => f.before !== f.after) : fields;
  const shownClauses = changedOnly ? clauses.filter((c) => c.status !== "same") : clauses;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(15,20,34,0.5)" }} onClick={onClose}>
      <div
        className="cdash rounded-lg cd-solid-bg shadow-[var(--cd-shadow-dialog)] w-full max-w-[1100px] h-[90vh] flex flex-col overflow-hidden"
        data-theme={theme}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-5 py-3 border-b cd-border-c flex-wrap">
          <span className="text-sm font-semibold cd-text">
            버전 비교 — v{older?.version ?? "?"} → v{newer?.version ?? "?"}
          </span>
          <label className="flex items-center gap-1.5 text-[12px] cd-text">
            <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} />
            바뀐 항목만
          </label>
          <button type="button" className="ml-auto cd-text-faint hover:cd-text" onClick={onClose} aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-5 flex flex-col gap-5">
          {error ? (
            <p className="text-sm text-[color:var(--cd-error)]">{error}</p>
          ) : !items ? (
            <p className="text-sm cd-text-faint">불러오는 중...</p>
          ) : (
            <>
              <section className="flex flex-col gap-2">
                <h4 className="text-[13px] font-semibold cd-text">갑지 항목</h4>
                {shownFields.length === 0 ? (
                  <p className="text-[12px] cd-text-faint">바뀐 항목이 없습니다.</p>
                ) : (
                  <table className="w-full text-[12px]">
                    <thead className="cd-table-head">
                      <tr className="text-left cd-text-faint text-[11px] border-b cd-border-c">
                        <th className="py-1.5 pr-3 font-medium w-32">항목</th>
                        <th className="py-1.5 pr-3 font-medium">v{older?.version}</th>
                        <th className="py-1.5 font-medium">v{newer?.version}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownFields.map((f) => (
                        <tr key={f.label} className="border-b cd-border-c last:border-b-0 align-top">
                          <td className="py-2 pr-3 cd-text-faint">{f.label}</td>
                          <td className="py-2 pr-3 cd-text whitespace-pre-wrap">{f.before || "—"}</td>
                          <td className={`py-2 whitespace-pre-wrap ${f.before !== f.after ? "cd-text font-semibold" : "cd-text"}`}>{f.after || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
              <section className="flex flex-col gap-2">
                <h4 className="text-[13px] font-semibold cd-text">조문</h4>
                {shownClauses.length === 0 ? (
                  <p className="text-[12px] cd-text-faint">바뀐 조문이 없습니다.</p>
                ) : (
                  shownClauses.map((c) => (
                    <div key={c.key} className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 text-[12px]">
                        <span
                          className={`text-[11px] rounded-full px-2 py-0.5 border ${c.status === "removed" ? "border-[color:var(--cd-error)] text-[color:var(--cd-error)]" : "cd-border-c cd-text"}`}
                        >
                          {STATUS_LABEL[c.status]}
                        </span>
                        <span className="font-semibold cd-text">{(c.after ?? c.before)?.title}</span>
                        {c.status === "changed" && c.before && c.after && c.before.title !== c.after.title && (
                          <span className="cd-text-faint">(종전: {c.before.title})</span>
                        )}
                      </div>
                      {c.after?.binding === "payment" || c.before?.binding === "payment" ? (
                        <p className="text-[11px] cd-text-faint">지급 조건 조문 — 위 「대금 지급 조건」에서 자동 생성됩니다.</p>
                      ) : (
                        <DiffBlock before={c.before?.body ?? ""} after={c.after?.body ?? ""} />
                      )}
                    </div>
                  ))
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
