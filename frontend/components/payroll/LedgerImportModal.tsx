"use client";

import { Fragment, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileUp, X } from "lucide-react";
import { CdHelp } from "@/components/cdash/CdHelp";

/**
 * 급여대장 엑셀 가져오기 모달 — 과거·외부 작성 급상여대장(3단 구조) 파일을 확정 대장으로 적재한다.
 * 파일 선택 → 자동 미리보기(귀속 연·월·종류 추정, 합계 검증, 항목 매핑, 기존 대장 충돌) → [가져오기].
 * 세무사 대장은 달마다 열 구성이 달라 라벨과 기입 내용이 어긋날 수 있어, 열마다 들어갈 항목을 바꿀 수 있다(재매핑).
 * 서버 파서는 lib/payroll/ledger-import.ts (scripts/payroll_import 파이프라인 이식).
 */

type Kind = "salary" | "bonus" | "intern";
type Action = "new" | "same" | "overwrite" | "blocked" | "invalid";

interface Target {
  year?: number;
  month?: number;
  kind?: Kind;
  overwrite?: boolean;
  /** 열 라벨 → 급여 항목 재매핑 */
  remap?: Record<string, string>;
}

interface ItemOption {
  itemId: string;
  name: string;
  kind: "pay" | "deduction";
}

interface PreviewFile {
  fileName: string;
  ok: boolean;
  error: string | null;
  title: string | null;
  target: Target;
  plan: {
    action: Action;
    reason: string | null;
    existing: { source: string; status: string; sourceFile: string | null; headcount: number } | null;
    canOverwrite?: boolean;
  };
  headcount: number;
  payTotal: number;
  deductionTotal: number;
  netTotal: number;
  issues: string[];
  unlabeledRows: number;
  mapping: Array<{
    label: string;
    itemId: string;
    itemName: string;
    kind: "pay" | "deduction";
    isNew: boolean;
    autoItemId: string;
    autoItemName: string;
    remapped: boolean;
  }>;
  newItems: Array<{ label: string; itemId: string; kind: "pay" | "deduction" }>;
  entries: Array<{ name: string; deptName: string | null; positionName: string | null; payTotal: number; deductionTotal: number; netPay: number; note: string | null }>;
}

interface ImportResult {
  fileName: string;
  ledgerId: string;
  action: Action;
  headcount: number;
  matched: number;
  reason: string | null;
}

const KIND_LABELS: Record<Kind, string> = { salary: "급여", bonus: "상여", intern: "인턴" };

const ACTION_BADGE: Record<Action, { label: string; color: string; bg: string }> = {
  new: { label: "새 대장", color: "var(--cd-success)", bg: "var(--cd-success-soft)" },
  overwrite: { label: "덮어쓰기", color: "var(--cd-warning)", bg: "var(--cd-warning-soft)" },
  same: { label: "이미 있음", color: "var(--cd-faint)", bg: "var(--cd-surface)" },
  blocked: { label: "가져올 수 없음", color: "var(--cd-error)", bg: "var(--cd-error-soft)" },
  invalid: { label: "확인 필요", color: "var(--cd-error)", bg: "var(--cd-error-soft)" },
};

const fmt = (v: number) => Math.round(v).toLocaleString();
const loadable = (a: Action) => a === "new" || a === "overwrite";

export default function LedgerImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (year: number, month: number) => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [preview, setPreview] = useState<PreviewFile[]>([]);
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const thisYear = new Date().getFullYear();
  const yearOptions = Array.from({ length: thisYear - 2010 + 2 }, (_, i) => thisYear + 1 - i);

  const runPreview = async (fs: File[], ts: Target[]) => {
    if (!fs.length) return;
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append("mode", "preview");
      for (const f of fs) form.append("files", f);
      form.append("targets", JSON.stringify(ts));
      const res = await fetch("/api/payroll/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "미리보기 실패");
      const list: PreviewFile[] = data.files ?? [];
      setPreview(list);
      setItemOptions(data.items ?? []);
      setTargets(list.map((p, i) => ({ ...p.target, overwrite: ts[i]?.overwrite ?? false })));
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pickFiles = (list: FileList | null) => {
    if (!list?.length) return;
    const fs = [...list];
    setFiles(fs);
    setResults(null);
    setOpen(null);
    runPreview(fs, fs.map(() => ({})));
    if (fileRef.current) fileRef.current.value = "";
  };

  const changeTarget = (i: number, patch: Target) => {
    const next = targets.map((t, j) => (j === i ? { ...t, ...patch } : t));
    setTargets(next);
    runPreview(files, next);
  };

  const ready = preview.filter((p) => loadable(p.plan.action));

  const doImport = async () => {
    if (!ready.length) return;
    const overwriting = preview.filter((p) => p.plan.action === "overwrite").length;
    if (!window.confirm(
      `${ready.length}개 대장을 확정 상태로 가져올까요?` +
        (overwriting ? `\n기존 엑셀 대장 ${overwriting}개는 이 파일 내용으로 바뀝니다.` : "") +
        "\n가져온 대장은 화면에서 고칠 수 없습니다."
    )) return;
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append("mode", "import");
      const ts: Target[] = [];
      preview.forEach((p, i) => {
        if (!loadable(p.plan.action)) return;
        form.append("files", files[i]);
        ts.push(targets[i]);
      });
      form.append("targets", JSON.stringify(ts));
      const res = await fetch("/api/payroll/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "가져오기 실패");
      const rs: ImportResult[] = data.results ?? [];
      setResults(rs);
      const firstOk = rs.findIndex((r) => loadable(r.action));
      if (firstOk >= 0) {
        const t = ts[firstOk];
        if (t.year && t.month) onImported(t.year, t.month);
      }
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center p-6 pt-12" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} />
      <div
        className="cd-solid-bg relative z-10 w-full max-w-4xl max-h-[86vh] rounded-3xl p-5 flex flex-col gap-3"
        style={{ boxShadow: "var(--cd-shadow)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h3 className="text-base font-extrabold cd-text inline-flex items-center gap-1">급여대장 엑셀 가져오기<CdHelp topic="payroll.ledger-import" /></h3>
          <button type="button" className="cd-btn rounded-xl p-1.5" onClick={onClose} aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <label className="cd-btn rounded-xl px-3 py-2 text-sm font-semibold flex items-center gap-1.5 cursor-pointer">
            <FileUp className="w-4 h-4" /> 엑셀 파일 선택
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xlsm,.xls"
              multiple
              className="hidden"
              onChange={(e) => pickFiles(e.target.files)}
            />
          </label>
          <span className="text-xs cd-text-faint">
            {files.length ? `${files.length}개 파일 · 가져올 대장 ${ready.length}개` : "급상여대장(사원번호·성명 3단 양식) 파일을 여러 개 함께 고를 수 있습니다."}
          </span>
          <button
            type="button"
            disabled={busy || !ready.length || !!results}
            className="cd-fill-primary text-white rounded-xl px-3.5 py-2 text-sm font-bold disabled:opacity-40 ml-auto"
            onClick={doImport}
          >
            가져오기
          </button>
        </div>
        {msg && <p className="text-xs" style={{ color: "var(--cd-error)" }}>{msg}</p>}
        {busy && <p className="text-xs cd-text-faint">파일을 확인하는 중…</p>}

        {results && (
          <div className="border cd-border-c rounded-2xl p-3 text-xs flex flex-col gap-1">
            {results.map((r) => (
              <p key={r.fileName} className="cd-text">
                <span className="font-semibold">{r.fileName}</span> —{" "}
                {loadable(r.action)
                  ? `${r.headcount}명 적재(직원 연결 ${r.matched}명)`
                  : <span style={{ color: "var(--cd-error)" }}>{r.reason ?? "적재하지 않음"}</span>}
              </p>
            ))}
          </div>
        )}

        {preview.length > 0 && (
          <div className="flex-1 min-h-0 overflow-auto border cd-border-c rounded-2xl">
            <table className="w-full text-xs">
              <thead className="cd-table-head">
                <tr className="cd-text-faint border-b cd-border-c sticky top-0 z-10" style={{ background: "var(--cd-surface)" }}>
                  <th className="text-left font-semibold p-2">파일</th>
                  <th className="text-left font-semibold p-2">귀속 연·월·종류</th>
                  <th className="text-right font-semibold p-2">인원</th>
                  <th className="text-right font-semibold p-2">지급합계</th>
                  <th className="text-right font-semibold p-2">차인지급액</th>
                  <th className="text-left font-semibold p-2">상태</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p, i) => {
                  const t = targets[i] ?? {};
                  const badge = ACTION_BADGE[p.plan.action];
                  const expanded = open === i;
                  return (
                    <Fragment key={`${p.fileName}-${i}`}>
                      <tr className="border-b cd-border-c align-top">
                        <td className="p-2 cd-text">
                          <button
                            type="button"
                            className="flex items-start gap-1 text-left font-semibold"
                            onClick={() => setOpen(expanded ? null : i)}
                            disabled={!p.ok}
                            aria-expanded={expanded}
                          >
                            {p.ok && (expanded ? <ChevronDown className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 mt-0.5 shrink-0" />)}
                            <span className="break-all">{p.fileName}</span>
                          </button>
                          {p.title && <p className="cd-text-faint mt-0.5 pl-4">{p.title}</p>}
                        </td>
                        <td className="p-2 whitespace-nowrap">
                          {p.ok ? (
                            <div className="flex items-center gap-1">
                              <select aria-label="귀속 연도" className="cd-select text-xs" style={{ width: 80 }} disabled={busy || !!results}
                                value={t.year ?? ""} onChange={(e) => changeTarget(i, { year: Number(e.target.value) || undefined })}>
                                <option value="">연도</option>
                                {yearOptions.map((y) => <option key={y} value={y}>{y}년</option>)}
                              </select>
                              <select aria-label="귀속 월" className="cd-select text-xs" style={{ width: 66 }} disabled={busy || !!results}
                                value={t.month ?? ""} onChange={(e) => changeTarget(i, { month: Number(e.target.value) || undefined })}>
                                <option value="">월</option>
                                {Array.from({ length: 12 }, (_, m) => m + 1).map((m) => <option key={m} value={m}>{m}월</option>)}
                              </select>
                              <select aria-label="대장 종류" className="cd-select text-xs" style={{ width: 66 }} disabled={busy || !!results}
                                value={t.kind ?? "salary"} onChange={(e) => changeTarget(i, { kind: e.target.value as Kind })}>
                                {(Object.keys(KIND_LABELS) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
                              </select>
                            </div>
                          ) : (
                            <span className="cd-text-faint">-</span>
                          )}
                        </td>
                        <td className="p-2 text-right cd-text tabular-nums">{p.ok ? `${p.headcount}명` : "-"}</td>
                        <td className="p-2 text-right cd-text tabular-nums">{p.ok ? fmt(p.payTotal) : "-"}</td>
                        <td className="p-2 text-right font-bold tabular-nums" style={{ color: "var(--cd-primary)" }}>{p.ok ? fmt(p.netTotal) : "-"}</td>
                        <td className="p-2" style={{ minWidth: 190 }}>
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: badge.color, background: badge.bg }}>{badge.label}</span>
                          {p.plan.reason && <p className="mt-1 cd-text-faint">{p.plan.reason}</p>}
                          {p.plan.canOverwrite && (
                            <label className="mt-1 flex items-center gap-1 cd-text cursor-pointer">
                              <input type="checkbox" checked={!!t.overwrite} disabled={busy || !!results}
                                onChange={(e) => changeTarget(i, { overwrite: e.target.checked })} />
                              덮어쓰기
                            </label>
                          )}
                          {p.mapping.some((m) => m.remapped) && (
                            <p className="mt-1" style={{ color: "var(--cd-warning)" }}>열 {p.mapping.filter((m) => m.remapped).length}개 항목을 바꿨습니다.</p>
                          )}
                          {p.newItems.length > 0 && (
                            <p className="mt-1" style={{ color: "var(--cd-warning)" }}>새 항목 {p.newItems.length}개가 급여 항목에 추가됩니다.</p>
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b cd-border-c">
                          <td colSpan={6} className="p-3" style={{ background: "var(--cd-surface)" }}>
                            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                              <div>
                                <h4 className="font-bold cd-text mb-1">열 → 급여 항목</h4>
                                <p className="cd-text-faint mb-1.5">
                                  열 이름과 실제 기입 내용이 다르면 들어갈 항목을 바꾸세요. 바꾼 내역은 대장 비고에 남습니다.
                                </p>
                                <div className="flex flex-col gap-1">
                                  {p.mapping.map((m) => (
                                    <div key={m.label} className="flex items-center gap-2">
                                      <span className="flex-1 min-w-0 truncate cd-text" title={m.label}>{m.label}</span>
                                      <select
                                        aria-label={`${m.label} 열에 넣을 항목`}
                                        className="cd-select text-xs"
                                        style={{ width: 156 }}
                                        disabled={busy || !!results}
                                        value={t.remap?.[m.label] ?? ""}
                                        onChange={(e) => {
                                          const next = { ...(t.remap ?? {}) };
                                          if (e.target.value) next[m.label] = e.target.value;
                                          else delete next[m.label];
                                          changeTarget(i, { remap: next });
                                        }}
                                      >
                                        <option value="">자동: {m.autoItemName}{m.isNew && !m.remapped ? " (새 항목)" : ""}</option>
                                        {(["pay", "deduction"] as const).map((kd) => (
                                          <optgroup key={kd} label={kd === "pay" ? "지급" : "공제"}>
                                            {itemOptions.filter((o) => o.kind === kd).map((o) => (
                                              <option key={o.itemId} value={o.itemId}>{o.name}</option>
                                            ))}
                                          </optgroup>
                                        ))}
                                      </select>
                                      <span className="w-7 shrink-0 cd-text-faint">{m.kind === "pay" ? "지급" : "공제"}</span>
                                      <span className="w-7 shrink-0 font-bold" style={{ color: "var(--cd-warning)" }}>{m.remapped ? "바꿈" : ""}</span>
                                    </div>
                                  ))}
                                </div>
                                {p.issues.length > 0 && (
                                  <ul className="mt-2 list-disc pl-4" style={{ color: "var(--cd-error)" }}>
                                    {p.issues.slice(0, 12).map((s) => <li key={s}>{s}</li>)}
                                    {p.issues.length > 12 && <li>외 {p.issues.length - 12}건</li>}
                                  </ul>
                                )}
                                {p.unlabeledRows > 0 && (
                                  <p className="mt-2 cd-text-faint">라벨 없는 칸의 금액이 있는 행 {p.unlabeledRows}건은 ‘미상 지급/공제’로 보존됩니다.</p>
                                )}
                              </div>
                              <table className="w-full">
                                <thead>
                                  <tr className="cd-text-faint border-b cd-border-c">
                                    <th className="text-left font-semibold p-1">성명</th>
                                    <th className="text-left font-semibold p-1">부서</th>
                                    <th className="text-right font-semibold p-1">지급합계</th>
                                    <th className="text-right font-semibold p-1">공제합계</th>
                                    <th className="text-right font-semibold p-1">차인지급액</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {p.entries.map((e, j) => (
                                    <tr key={`${e.name}-${j}`} className="border-b cd-border-c last:border-0" title={e.note ?? undefined}>
                                      <td className="p-1 cd-text font-semibold whitespace-nowrap">{e.name}</td>
                                      <td className="p-1 cd-text whitespace-nowrap">{e.deptName ?? "-"}</td>
                                      <td className="p-1 text-right cd-text tabular-nums">{fmt(e.payTotal)}</td>
                                      <td className="p-1 text-right cd-text tabular-nums">{fmt(e.deductionTotal)}</td>
                                      <td className="p-1 text-right cd-text tabular-nums">{fmt(e.netPay)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
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

        <p className="text-[11px] cd-text-faint">
          가져온 대장은 확정 상태로 들어갑니다. 합계(지급·공제·차인)가 맞지 않는 파일, 앱에서 만든 대장과 겹치는 달, 명세서를 발행했거나
          전표를 확정한 대장은 가져오지 않습니다. 직원 연결은 성명으로 하며 동명이인은 연결을 보류합니다.
        </p>
      </div>
    </div>
  );
}
