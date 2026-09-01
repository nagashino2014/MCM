"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, RefreshCw, Send, Trash2, X } from "lucide-react";

/**
 * 근로계약서 작성/갱신 패널 (PL-P3, UI 컨셉 PDF §1-3)
 * - 일괄: 기준일(기본 내년 1/1)·전년도 물가상승률·추가 보정 → 미리보기 → draft 일괄 생성.
 * - 개별(승진): 좌측 트리에서 선택한 직원 대상 — 승진 직급(현 직급 위 2단계만)·승진 이력·급여 승급.
 * - 진행 현황: 라운드별 기안 생성 → 결재 확인(게이트) → 발송 → 서명 현황.
 */

interface PreviewRow {
  employeeId: string;
  name: string;
  deptName: string | null;
  positionName: string | null;
  currentSalary: number | null;
  newMonthly: number | null;
  newSalary: number | null;
  raisePct: number | null;
  excluded: string | null;
}

interface RoundRow {
  roundId: string;
  roundKind: string;
  baseDate: string;
  baseYear: number;
  cpiRate: number | null;
  extraRate: number | null;
  scope: string;
  status: string;
  approvalDocId: string | null;
  approvalDocNo: string | null;
  contractCount: number;
  signedCount: number;
  sentCount: number;
  employeeNames: string[];
}

interface PromotionCtx {
  currentPosition: string | null;
  candidates: string[];
  history: Array<{ positionName: string; date: string }>;
  currentSalary: number | null;
  currentMonthly: number | null;
}

const STATUS_LABELS: Record<string, string> = {
  draft: "작성됨(기안 전)",
  pending_approval: "결재 진행중",
  approved: "결재 완료(발송 가능)",
  sent: "발송됨",
  closed: "마감",
};

/** 진행 현황 카드의 대상자 표기 — 3명까지 나열, 초과분은 '외 N명'(전체는 title 툴팁) */
function targetText(names: string[], count: number): string {
  if (!names.length) return `${count}명`;
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} 외 ${names.length - 3}명`;
}

/** 미리보기 '예외' 체크 인원의 개인별 산정 입력(§4-2 예외 산정 모달) */
interface ClientOverride {
  mode: "rate" | "amount";
  rate: string;
  amount: string;
  reason: string;
  reasonDetail: string;
}

const OVERRIDE_REASONS = ["성과우수", "성과부진", "인사평가 우수", "인사평가 미흡", "특수관계자"] as const;

const emptyOverride = (): ClientOverride => ({ mode: "rate", rate: "", amount: "", reason: OVERRIDE_REASONS[0], reasonDetail: "" });

function overrideValue(ov: ClientOverride): number | null {
  const raw = ov.mode === "rate" ? ov.rate : ov.amount;
  if (raw === "") return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

/** 예외 산식 — 서버(rounds.ts applyOverride)와 동일: 월급여 천원 미만 절사 후 ×12 */
function overrideCalc(currentSalary: number, ov: ClientOverride): { newSalary: number; raisePct: number } | null {
  const v = overrideValue(ov);
  if (v == null) return null;
  const raised = ov.mode === "rate" ? currentSalary * (1 + v / 100) : currentSalary + v;
  const newSalary = Math.floor(raised / 12 / 1000) * 1000 * 12;
  return { newSalary, raisePct: ((newSalary - currentSalary) / currentSalary) * 100 };
}

function fmt(v: number | null): string {
  return v == null ? "-" : Math.round(v).toLocaleString();
}

export default function ContractRoundPanel({
  selected,
  onChanged,
}: {
  selected: { employeeId: string; name: string } | null;
  onChanged?: () => void;
}) {
  const nextYear = new Date().getFullYear() + 1;
  const [tab, setTab] = useState<"annual" | "promotion" | "rounds">("annual");
  const [baseDate, setBaseDate] = useState(`${nextYear}-01-01`);
  const [cpiRate, setCpiRate] = useState("2.0");
  const [extraRate, setExtraRate] = useState("0.0");
  const [scope, setScope] = useState<"exclude_exec" | "all">("exclude_exec");
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [promo, setPromo] = useState<PromotionCtx | null>(null);
  const [promoDate, setPromoDate] = useState(new Date().toISOString().slice(0, 10));
  const [promoPosition, setPromoPosition] = useState("");
  const [promoMonthly, setPromoMonthly] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, ClientOverride>>({});
  const [ovTarget, setOvTarget] = useState<PreviewRow | null>(null);
  const [ovDraft, setOvDraft] = useState<ClientOverride>(emptyOverride());

  const loadRounds = useCallback(() => {
    fetch("/api/payroll/rounds", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRounds(d.rounds ?? []))
      .catch(() => setRounds([]));
  }, []);

  useEffect(() => {
    loadRounds();
  }, [loadRounds]);

  // 개별(승진) 컨텍스트 — 선택 직원 변경 시
  useEffect(() => {
    if (tab !== "promotion" || !selected) {
      setPromo(null);
      return;
    }
    fetch(`/api/payroll/rounds?promotionContext=${encodeURIComponent(selected.employeeId)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: PromotionCtx) => {
        setPromo(d);
        setPromoPosition(d.candidates[0] ?? "");
        setPromoMonthly(d.currentMonthly != null ? String(d.currentMonthly) : "");
      })
      .catch(() => setPromo(null));
  }, [tab, selected]);

  const post = async (url: string, body: unknown): Promise<Record<string, unknown>> => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(String(data.error ?? "요청 실패"));
    return data;
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const annualRates = rounds.filter((r) => r.roundKind === "annual").slice(0, 5);

  return (
    <section className="cd-card rounded-3xl p-4 cd-reveal delay-2 flex flex-col gap-3" style={{ minHeight: 240 }}>
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-[15px] font-extrabold tracking-tight cd-text">근로계약서 작성/갱신</h2>
        <div className="flex rounded-xl border cd-border-c overflow-hidden text-xs font-semibold">
          {(
            [
              ["annual", "일괄"],
              ["promotion", "개별(승진)"],
              ["rounds", `진행 현황${rounds.length ? ` (${rounds.length})` : ""}`],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={`px-3 py-1.5 transition ${tab === k ? "cd-fill-primary text-white" : "cd-text"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {msg && <span className="text-xs" style={{ color: "var(--cd-error)" }}>{msg}</span>}
      </div>

      {/* ── 일괄 갱신 ── */}
      {tab === "annual" && (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          <div className="flex items-end gap-4 flex-wrap">
            <label className="text-xs cd-text-faint">
              작성/갱신 기준일
              <input className="cd-input text-sm block mt-0.5" style={{ width: 130 }} value={baseDate} onChange={(e) => setBaseDate(e.target.value)} />
            </label>
            <label className="text-xs cd-text-faint">
              전년도 물가상승률(%)
              <input className="cd-input text-sm block mt-0.5 text-right" style={{ width: 90 }} value={cpiRate} onChange={(e) => setCpiRate(e.target.value)} />
            </label>
            <label className="text-xs cd-text-faint">
              추가 보정 비율(%)
              <input className="cd-input text-sm block mt-0.5 text-right" style={{ width: 90 }} value={extraRate} onChange={(e) => setExtraRate(e.target.value)} />
            </label>
            <div className="text-xs cd-text-faint">
              작성/갱신 대상 범위
              <div className="flex items-center gap-3 mt-0.5" style={{ height: 38 }}>
                <label className="flex items-center gap-1 cd-text">
                  <input type="radio" checked={scope === "exclude_exec"} onChange={() => setScope("exclude_exec")} /> 임원 제외
                </label>
                <label className="flex items-center gap-1 cd-text">
                  <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} /> 전체
                </label>
              </div>
            </div>
            {/* 연도별 비율 추이(라운드 이력) */}
            <div className="ml-auto border cd-border-c rounded-2xl px-3 py-2 text-[11px] cd-text-faint">
              <p className="font-bold mb-0.5">물가상승률·추가 보정 추이</p>
              {annualRates.length ? (
                annualRates.map((r) => (
                  <p key={r.roundId}>
                    {r.baseYear}년: {r.cpiRate ?? 0}% + {r.extraRate ?? 0}%
                  </p>
                ))
              ) : (
                <p>이력 없음(첫 라운드)</p>
              )}
            </div>
            <button
              type="button"
              disabled={busy}
              className="cd-btn rounded-xl px-3.5 py-2 text-sm font-semibold"
              onClick={() =>
                run(async () => {
                  const d = await post("/api/payroll/rounds", {
                    action: "preview", cpiRate: Number(cpiRate), extraRate: Number(extraRate), scope,
                  });
                  setPreview((d.rows as PreviewRow[]) ?? []);
                })
              }
            >
              미리보기
            </button>
            <button
              type="button"
              disabled={busy || !preview}
              className="cd-fill-primary text-white rounded-xl px-3.5 py-2 text-sm font-bold disabled:opacity-40"
              onClick={() =>
                run(async () => {
                  // 예외 산정: 값이 입력된 인원만 전달(체크만 하고 미입력 시 기본 산식)
                  const ovPayload: Record<string, unknown> = {};
                  for (const [empId, ov] of Object.entries(overrides)) {
                    const v = overrideValue(ov);
                    if (v == null) continue;
                    ovPayload[empId] = { mode: ov.mode, value: v, reason: ov.reason, reasonDetail: ov.reasonDetail || undefined };
                  }
                  const d = await post("/api/payroll/rounds", {
                    action: "create-annual", baseDate, cpiRate: Number(cpiRate), extraRate: Number(extraRate), scope,
                    overrides: ovPayload,
                  });
                  setMsg(`계약서 ${d.created}건 작성 완료 — 진행 현황에서 기안을 생성하세요.`);
                  setPreview(null);
                  setOverrides({});
                  loadRounds();
                  setTab("rounds");
                  onChanged?.();
                })
              }
            >
              일괄 작성
            </button>
          </div>

          {preview && (
            <div className="max-h-56 overflow-auto border cd-border-c rounded-2xl">
              <table className="w-full text-xs">
                <thead>
                  <tr className="cd-text-faint border-b cd-border-c sticky top-0" style={{ background: "var(--cd-card-solid)" }}>
                    <th className="text-left font-semibold p-2">성명</th>
                    <th className="text-left font-semibold p-2">부서</th>
                    <th className="text-left font-semibold p-2">직급</th>
                    <th className="text-right font-semibold p-2">현행 연봉</th>
                    <th className="text-right font-semibold p-2">갱신 연봉</th>
                    <th className="text-right font-semibold p-2">인상률</th>
                    <th className="text-center font-semibold p-2">예외</th>
                    <th className="text-center font-semibold p-2">예외 산정</th>
                    <th className="text-left font-semibold p-2">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r) => {
                    const ov = overrides[r.employeeId];
                    const applied = ov && r.currentSalary != null ? overrideCalc(r.currentSalary, ov) : null;
                    return (
                      <tr key={r.employeeId} className="border-b cd-border-c last:border-0">
                        <td className="p-2 cd-text font-semibold">{r.name}</td>
                        <td className="p-2 cd-text">{r.deptName ?? "-"}</td>
                        <td className="p-2 cd-text">{r.positionName ?? "-"}</td>
                        <td className="p-2 text-right cd-text tabular-nums">{fmt(r.currentSalary)}</td>
                        <td className="p-2 text-right tabular-nums font-bold" style={applied ? { color: "var(--cd-primary)" } : undefined}>
                          <span className={applied ? undefined : "cd-text"}>{fmt(applied ? applied.newSalary : r.newSalary)}</span>
                        </td>
                        <td className="p-2 text-right tabular-nums" style={applied ? { color: "var(--cd-primary)" } : undefined}>
                          <span className={applied ? undefined : "cd-text"}>
                            {applied ? `${applied.raisePct.toFixed(1)}%` : r.raisePct != null ? `${r.raisePct.toFixed(1)}%` : "-"}
                          </span>
                        </td>
                        <td className="p-2 text-center">
                          {!r.excluded && (
                            <input
                              type="checkbox"
                              checked={!!ov}
                              onChange={() =>
                                setOverrides((p) => {
                                  const next = { ...p };
                                  if (next[r.employeeId]) delete next[r.employeeId];
                                  else next[r.employeeId] = emptyOverride();
                                  return next;
                                })
                              }
                            />
                          )}
                        </td>
                        <td className="p-2 text-center">
                          {!r.excluded && (
                            <button
                              type="button"
                              disabled={!ov}
                              className="rounded-full px-2.5 py-0.5 text-[11px] font-bold transition disabled:opacity-35"
                              style={
                                ov
                                  ? { color: "var(--cd-primary)", background: "var(--cd-primary-soft)" }
                                  : { color: "var(--cd-faint)", background: "var(--cd-surface)" }
                              }
                              onClick={() => {
                                setOvDraft(ov ?? emptyOverride());
                                setOvTarget(r);
                              }}
                            >
                              산정
                            </button>
                          )}
                        </td>
                        <td className="p-2" style={{ color: "var(--cd-warning)" }}>
                          {r.excluded ?? (ov && applied ? `예외: ${ov.reason} ${ov.mode === "rate" ? `${overrideValue(ov)}%` : `${fmt(overrideValue(ov))}원`}` : "")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── 개별(승진) — 대상 박스·1열 2행 페어·이력 박스 하단 일치, 버튼은 기존 급여액 우측 ── */}
      {tab === "promotion" && (
        <div className="flex items-stretch gap-5 flex-wrap py-1">
          {!selected ? (
            <p className="text-sm cd-text-faint py-2">좌측 트리에서 승진 대상 직원을 먼저 선택하세요.</p>
          ) : (
            <>
              <div className="flex flex-col text-xs cd-text-faint">
                대상 · 현 직급
                <div
                  className="flex-1 flex flex-col items-center justify-center gap-1 border cd-border-c rounded-xl px-4 mt-0.5"
                  style={{ background: "var(--cd-card-solid)", minWidth: 110 }}
                >
                  <span className="cd-text text-sm font-bold">{selected.name}</span>
                  <span className="cd-text-faint text-xs">{promo?.currentPosition ?? "-"}</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs cd-text-faint">
                  작성/갱신 기준일
                  <input className="cd-input text-sm block mt-0.5" style={{ width: 140 }} value={promoDate} onChange={(e) => setPromoDate(e.target.value)} />
                </label>
                <label className="text-xs cd-text-faint">
                  승진 직급 선택
                  <select className="cd-select text-sm block mt-0.5" style={{ width: 140 }} value={promoPosition} onChange={(e) => setPromoPosition(e.target.value)}>
                    {(promo?.candidates ?? []).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-col text-xs cd-text-faint" style={{ minWidth: 170 }}>
                승진 이력
                <div
                  className="flex-1 border cd-border-c rounded-xl px-3 py-2 mt-0.5 overflow-y-auto"
                  style={{ background: "var(--cd-card-solid)", maxHeight: 104 }}
                >
                  {(promo?.history ?? []).length ? (
                    promo!.history.map((h, i) => (
                      <p key={i} className="cd-text whitespace-nowrap leading-relaxed">{h.positionName} · {h.date}</p>
                    ))
                  ) : (
                    <p>이력 없음</p>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs cd-text-faint">
                  기존 급여액(월)
                  <input className="cd-input text-sm block mt-0.5 text-right" style={{ width: 140 }} readOnly value={fmt(promo?.currentMonthly ?? null)} />
                </label>
                <label className="text-xs cd-text-faint">
                  급여 승급액(월)
                  <input
                    className="cd-input text-sm block mt-0.5 text-right"
                    style={{ width: 140 }}
                    inputMode="numeric"
                    value={promoMonthly ? Number(promoMonthly).toLocaleString() : ""}
                    onChange={(e) => setPromoMonthly(e.target.value.replace(/[^\d]/g, ""))}
                  />
                </label>
              </div>
              <div className="flex flex-col">
                <span className="text-xs">&nbsp;</span>
                <button
                  type="button"
                  disabled={busy || !promoPosition || !promoMonthly}
                  className="cd-fill-primary text-white rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-40 mt-0.5"
                  onClick={() =>
                    run(async () => {
                      await post("/api/payroll/rounds", {
                        action: "create-promotion",
                        employeeId: selected.employeeId,
                        baseDate: promoDate,
                        newPositionName: promoPosition,
                        newMonthly: Number(promoMonthly),
                      });
                      setMsg(`${selected.name} 승진 계약서 작성 완료 — 진행 현황에서 기안을 생성하세요.`);
                      loadRounds();
                      setTab("rounds");
                      onChanged?.();
                    })
                  }
                >
                  계약서 작성
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── 진행 현황 ── */}
      {tab === "rounds" && (
        <div className="flex-1 min-h-0 max-h-64 overflow-y-auto flex flex-col gap-2">
          {!rounds.length && <p className="text-sm cd-text-faint py-2">진행 중인 라운드가 없습니다.</p>}
          {rounds.map((r) => (
            <div key={r.roundId} className="border cd-border-c rounded-2xl px-3.5 py-2.5 flex items-center gap-3 text-sm">
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap"
                style={
                  r.status === "sent" || r.status === "approved"
                    ? { color: "var(--cd-success)", background: "var(--cd-success-soft)" }
                    : { color: "var(--cd-primary)", background: "var(--cd-primary-soft)" }
                }
              >
                {r.roundKind === "annual" ? "일괄" : "승진"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="cd-text font-semibold truncate" title={r.employeeNames.join(", ")}>
                  {r.baseDate} 기준 · {targetText(r.employeeNames, r.contractCount)}
                  <span className="cd-text-faint font-normal"> ({r.contractCount}명)</span>
                  {r.roundKind === "annual" && r.cpiRate != null && (
                    <span className="cd-text-faint font-normal"> · {r.cpiRate}%+{r.extraRate ?? 0}%</span>
                  )}
                </p>
                <p className="text-[11px] cd-text-faint flex items-center gap-1.5 flex-wrap">
                  <span>
                    {STATUS_LABELS[r.status] ?? r.status}
                    {r.sentCount > 0 && ` · 서명 ${r.signedCount}/${r.sentCount}`}
                  </span>
                  {r.approvalDocId && (
                    <a
                      href={`/approval?docId=${encodeURIComponent(r.approvalDocId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 font-semibold"
                      style={{ color: "var(--cd-primary)" }}
                      title="전자결재 문서 열기"
                    >
                      <ExternalLink className="w-3 h-3" />
                      {r.approvalDocNo ?? "결재 문서"}
                    </a>
                  )}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                {r.status === "draft" && (
                  <button
                    type="button" disabled={busy}
                    className="cd-btn rounded-xl px-3 py-1.5 text-xs font-semibold"
                    onClick={() =>
                      run(async () => {
                        const d = await post(`/api/payroll/rounds/${r.roundId}`, { action: "draft" });
                        setMsg("기안이 생성되었습니다. 기안 화면에서 검토 후 상신하세요.");
                        window.open(String(d.href), "_blank");
                        loadRounds();
                      })
                    }
                  >
                    기안 생성
                  </button>
                )}
                {r.status === "pending_approval" && (
                  <button
                    type="button" disabled={busy}
                    className="cd-btn rounded-xl px-3 py-1.5 text-xs font-semibold flex items-center gap-1"
                    onClick={() =>
                      run(async () => {
                        const d = await post(`/api/payroll/rounds/${r.roundId}`, { action: "sync" });
                        setMsg(
                          d.status === "approved"
                            ? "결재가 완료되었습니다. 발송할 수 있습니다."
                            : d.status === "draft"
                              ? "기안이 반려되어 작성 상태로 되돌렸습니다."
                              : "아직 결재가 완료되지 않았습니다."
                        );
                        loadRounds();
                      })
                    }
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> 결재 확인
                  </button>
                )}
                {(r.status === "approved" || r.status === "sent") && (
                  <button
                    type="button" disabled={busy}
                    className="cd-fill-primary text-white rounded-xl px-3 py-1.5 text-xs font-bold flex items-center gap-1 disabled:opacity-40"
                    onClick={() =>
                      run(async () => {
                        const d = await post(`/api/payroll/rounds/${r.roundId}`, { action: "send" });
                        const skipped = (d.skipped as Array<{ name: string; reason: string }>) ?? [];
                        setMsg(
                          `${d.sent}건 발송 완료` +
                            (skipped.length ? ` · 주의 ${skipped.length}건: ${skipped.map((s) => `${s.name}(${s.reason})`).join(", ")}` : "")
                        );
                        loadRounds();
                        onChanged?.();
                      })
                    }
                  >
                    {r.status === "sent" ? <><Send className="w-3.5 h-3.5" /> 재발송(미발송분)</> : <><Send className="w-3.5 h-3.5" /> 발송</>}
                  </button>
                )}
                {r.status === "sent" && r.signedCount === r.sentCount && r.sentCount > 0 && (
                  <span className="flex items-center gap-1 text-xs font-bold" style={{ color: "var(--cd-success)" }}>
                    <CheckCircle2 className="w-4 h-4" /> 전원 서명
                  </span>
                )}
                {r.signedCount === 0 && (
                  <button
                    type="button" disabled={busy}
                    className="cd-btn rounded-xl p-1.5"
                    title="라운드 삭제(작성된 계약서 일괄 삭제 — 테스트·오기 제거용)"
                    style={{ color: "var(--cd-error)" }}
                    onClick={() =>
                      run(async () => {
                        if (!window.confirm(`${r.baseDate} 기준 ${r.roundKind === "annual" ? "일괄" : "승진"} 라운드를 삭제할까요?\n작성된 계약서 ${r.contractCount}건이 함께 삭제되며 되돌릴 수 없습니다.`)) return;
                        const d = await post(`/api/payroll/rounds/${r.roundId}`, { action: "delete" });
                        setMsg(`라운드 삭제 완료 — 계약서 ${d.deleted}건 삭제됨.`);
                        loadRounds();
                        onChanged?.();
                      })
                    }
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── 예외 산정 모달 — 개인별 인상률/인상액·사유 입력(§4-2) ── */}
      {ovTarget && (
        <div className="fixed inset-0 z-40 flex items-start justify-center p-6 pt-14" onClick={() => setOvTarget(null)}>
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} />
          <div
            className="cd-solid-bg relative z-10 w-full max-w-sm rounded-3xl p-5 flex flex-col gap-3"
            style={{ boxShadow: "var(--cd-shadow)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <h3 className="text-base font-extrabold cd-text">
                예외 산정 — {ovTarget.name}
                <span className="ml-1.5 text-xs cd-text-faint font-normal">{ovTarget.positionName ?? ""}</span>
              </h3>
              <button type="button" className="cd-btn rounded-xl p-1.5" onClick={() => setOvTarget(null)} aria-label="닫기">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs cd-text-faint -mt-1">
              현행 연봉 {fmt(ovTarget.currentSalary)}원 — 이 인원에게만 아래 산식이 적용됩니다.
            </p>
            {/* 적용 방식(좌: 라디오 1열 2행) ↔ 입력(우: 인상률/인상액 1열 2행) — 행 단위로 짝을 이룸 */}
            <div className="text-xs cd-text-faint">
              인상 급여 적용 방식
              <div className="grid grid-cols-[1fr_150px] items-center gap-x-3 gap-y-2 mt-1">
                <label className="flex items-center gap-1.5 cd-text text-sm">
                  <input type="radio" checked={ovDraft.mode === "rate"} onChange={() => setOvDraft((p) => ({ ...p, mode: "rate" }))} /> 급여인상률(%)
                </label>
                <input
                  className="cd-input text-sm text-right"
                  disabled={ovDraft.mode !== "rate"}
                  inputMode="decimal"
                  value={ovDraft.rate}
                  onChange={(e) => setOvDraft((p) => ({ ...p, rate: e.target.value.replace(/[^\d.\-]/g, "") }))}
                />
                <label className="flex items-center gap-1.5 cd-text text-sm">
                  <input type="radio" checked={ovDraft.mode === "amount"} onChange={() => setOvDraft((p) => ({ ...p, mode: "amount" }))} /> 급여인상액(원 · 연봉)
                </label>
                <input
                  className="cd-input text-sm text-right"
                  disabled={ovDraft.mode !== "amount"}
                  inputMode="numeric"
                  value={ovDraft.amount ? Number(ovDraft.amount).toLocaleString() : ""}
                  onChange={(e) => setOvDraft((p) => ({ ...p, amount: e.target.value.replace(/[^\d\-]/g, "") }))}
                />
              </div>
            </div>
            <label className="text-xs cd-text-faint">
              예외 적용 사유
              <select
                className="cd-select text-sm block w-full mt-0.5"
                value={ovDraft.reason}
                onChange={(e) => setOvDraft((p) => ({ ...p, reason: e.target.value }))}
              >
                {OVERRIDE_REASONS.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="text-xs cd-text-faint">
              상세 사유
              <textarea
                className="cd-input text-sm w-full mt-0.5"
                rows={3}
                value={ovDraft.reasonDetail}
                onChange={(e) => setOvDraft((p) => ({ ...p, reasonDetail: e.target.value }))}
              />
            </label>
            {ovTarget.currentSalary != null && overrideCalc(ovTarget.currentSalary, ovDraft) && (
              <p className="text-xs rounded-xl px-3 py-2" style={{ color: "var(--cd-primary)", background: "var(--cd-primary-soft)" }}>
                적용 시 갱신 연봉 {fmt(overrideCalc(ovTarget.currentSalary, ovDraft)!.newSalary)}원 ·{" "}
                {overrideCalc(ovTarget.currentSalary, ovDraft)!.raisePct.toFixed(1)}%
              </p>
            )}
            <button
              type="button"
              disabled={overrideValue(ovDraft) == null}
              className="cd-fill-primary text-white rounded-xl px-3.5 py-2 text-sm font-bold disabled:opacity-40"
              onClick={() => {
                setOverrides((p) => ({ ...p, [ovTarget.employeeId]: ovDraft }));
                setOvTarget(null);
              }}
            >
              적용
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
