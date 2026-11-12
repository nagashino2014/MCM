"use client";

// 카드 증빙 대조(재무 > 계좌·카드 원장, 2026-11-11) — 결재 문서(지출 증빙)가 없는 법인카드 건을 모으고
// 출장 문서와 견주어 ①출장 경비 누락 추정 ②그 외 사용으로 나눈다. 고른 건은 부서장에게 소명을 요청한다.
// 분석은 추정이다 — 근거와 확신도를 보여 주고, 소명 대상은 관리자가 확인·변경한 뒤 직접 보낸다(자동 발송 없음).
// 서버: lib/finance/card-evidence.ts(판정 규칙 card-evidence-pure.ts).

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { CdButton } from "@/components/cdash/CdButton";
import { CdBadge } from "@/components/cdash/CdBadge";
import { CdDateInput, isValidDateString } from "@/components/cdash/CdField";
import { CdHelp } from "@/components/cdash/CdHelp";
import { CdTabs } from "@/components/cdash/CdTabs";

type Verdict = "trip_likely" | "trip_possible" | "other";
type Confidence = "high" | "mid" | "low";

interface MatchView {
  docId: string;
  docNo: string | null;
  formName: string;
  drafterName: string | null;
  deptId: string | null;
  deptName: string | null;
  from: string;
  to: string;
  place: string | null;
  score: number;
  confidence: Confidence;
  reasons: string[];
}

interface RequestView {
  requestId: string;
  status: "pending" | "answered" | "canceled";
  requestedToName: string | null;
  deptName: string | null;
  answer: string | null;
  answeredAt: string | null;
  createdAt: string;
}

interface Row {
  cardTxnId: string;
  usedAt: string;
  usedOn: string;
  cardLabel: string;
  cardShared: boolean;
  storeName: string | null;
  storeAddr: string | null;
  storeBizType: string | null;
  amount: number;
  evidence: "none" | "draft" | "rejected";
  evidenceDoc: { docId: string; docNo: string | null; drafterName: string | null; formName: string | null } | null;
  verdict: Verdict;
  matches: MatchView[];
  suggestedDeptId: string | null;
  suggestedBy: "trip" | "card" | null;
  request: RequestView | null;
}

interface DeptHead {
  deptId: string;
  deptName: string;
  userId: string;
  userName: string | null;
}

interface Result {
  rows: Row[];
  deptHeads: DeptHead[];
  requestsReady: boolean;
  noAddressCount: number;
}

type Filter = "all" | Verdict;

const VERDICT_LABEL: Record<Verdict, string> = { trip_likely: "출장 경비 누락 추정", trip_possible: "출장 여부 확인 필요", other: "그 외 사용" };
const VERDICT_TONE: Record<Verdict, "warn" | "info" | "idle"> = { trip_likely: "warn", trip_possible: "info", other: "idle" };
const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "확신도 높음", mid: "확신도 보통", low: "확신도 낮음" };
const EVIDENCE_LABEL: Record<Row["evidence"], string> = { none: "증빙 없음", draft: "작성 중", rejected: "반려·취소됨" };
const fmt = (n: number) => n.toLocaleString("ko-KR");
const md = (iso: string) => iso.slice(5, 10).replace("-", ".");

/** KST 기준 오늘과 지난달 1일 */
function defaultRange(): { from: string; to: string } {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const to = now.toISOString().slice(0, 10);
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { from: first.toISOString().slice(0, 10), to };
}

export function CardEvidencePanel() {
  const [range, setRange] = useState(defaultRange);
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  // 소명 대상(부서) — 건마다 관리자가 바꾼 값. 없으면 분석이 제안한 부서를 쓴다.
  const [target, setTarget] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");

  const analyze = useCallback(async (keepMessage = false) => {
    if (!isValidDateString(range.from) || !isValidDateString(range.to) || range.from > range.to) {
      setError("조회 기간을 확인하세요.");
      return;
    }
    if (!keepMessage) setMsg(null);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/finance/card-evidence?${new URLSearchParams(range).toString()}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "불러오지 못했습니다.");
      setData(d);
      setChecked(new Set());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range]);

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, trip_likely: 0, trip_possible: 0, other: 0 };
    for (const r of rows) c[r.verdict] += 1;
    return c;
  }, [rows]);
  const shown = filter === "all" ? rows : rows.filter((r) => r.verdict === filter);
  const total = shown.reduce((sum, r) => sum + r.amount, 0);
  const targetOf = (r: Row) => target[r.cardTxnId] ?? r.suggestedDeptId ?? "";
  const canRequest = (r: Row) => r.request?.status !== "pending";
  const selected = rows.filter((r) => checked.has(r.cardTxnId) && canRequest(r));
  const headOf = (deptId: string) => data?.deptHeads.find((h) => h.deptId === deptId);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sendRequests = async () => {
    const missing = selected.filter((r) => !targetOf(r));
    if (missing.length) {
      setError(`소명 대상이 비어 있는 건이 ${missing.length}건 있습니다. 대상 부서를 고르세요.`);
      return;
    }
    const names = [...new Set(selected.map((r) => {
      const h = headOf(targetOf(r));
      return h ? `${h.deptName} ${h.userName ?? "부서장"}` : "";
    }))].filter(Boolean);
    if (!window.confirm(`${selected.length}건의 소명을 요청합니다.\n받는 사람: ${names.join(", ")}\n계속할까요?`)) return;
    setMsg(null);
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/finance/card-evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: selected.map((r) => ({ cardTxnId: r.cardTxnId, deptId: targetOf(r), tripDocId: r.matches[0]?.docId ?? null })),
          note,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.error ?? "요청하지 못했습니다.");
      setMsg(
        `소명 요청 ${d.created}건을 ${d.recipients}명에게 보냈습니다.` +
          (d.skipped ? ` 이미 요청된 ${d.skipped}건은 건너뛰었습니다.` : "") +
          (d.todoFailed ? " 일부는 할 일을 만들지 못했으니 직접 알려 주세요." : "")
      );
      setNote("");
      await analyze(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const cancelRequest = async (r: Row) => {
    setMsg(null);
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/finance/card-evidence?requestId=${encodeURIComponent(r.request?.requestId ?? "")}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error ?? "취소하지 못했습니다.");
      setMsg("요청을 취소했습니다.");
      await analyze(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* .cd-card 는 세로 flex 라 가로 줄은 안쪽 div 로 둔다(재무 패널 공통 관례) */}
      <div className="cd-card rounded-lg p-4">
        <div className="flex items-end gap-3 flex-wrap">
          <label className="flex w-36 flex-col gap-1 text-[12px] cd-text-faint">
            <span className="cd-label-text">시작일</span>
            <CdDateInput value={range.from} onChange={(v) => setRange((p) => ({ ...p, from: v }))} aria-label="시작일" />
          </label>
          <label className="flex w-36 flex-col gap-1 text-[12px] cd-text-faint">
            <span className="cd-label-text">종료일</span>
            <CdDateInput value={range.to} onChange={(v) => setRange((p) => ({ ...p, to: v }))} aria-label="종료일" />
          </label>
          <CdButton variant="primary" size="sm" loading={loading} onClick={() => void analyze()}>
            누락 내역 분석
          </CdButton>
          <CdHelp topic="finance.card-evidence" />
        </div>
      </div>

      {msg && <p className="text-[12px] cd-text">{msg}</p>}
      {error && <p className="text-[12px] cd-error-text">{error}</p>}

      {data && (
        <>
          {!data.requestsReady && (
            <div className="cd-card rounded-lg p-4 text-[13px] cd-error-text">
              소명 요청 표(마이그레이션 352)가 아직 적용되지 않아 요청을 보낼 수 없습니다. 분석 결과는 볼 수 있습니다.
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <CdTabs<Filter>
              active={filter}
              onChange={setFilter}
              items={[
                { key: "all", label: "전체", count: counts.all },
                { key: "trip_likely", label: VERDICT_LABEL.trip_likely, count: counts.trip_likely },
                { key: "trip_possible", label: VERDICT_LABEL.trip_possible, count: counts.trip_possible },
                { key: "other", label: VERDICT_LABEL.other, count: counts.other },
              ]}
            />
            <span className="text-[12px] cd-text-faint">
              {shown.length}건 · {fmt(total)}원
              {data.noAddressCount > 0 && ` · 가맹점 주소가 없는 ${data.noAddressCount}건은 지역을 대조하지 못했습니다`}
            </span>
          </div>

          <div className="cd-card rounded-lg overflow-x-auto">
            <table className="w-full min-w-[1080px] text-[13px]">
              <thead className="cd-table-head">
                <tr>
                  <th className="py-2 px-3 w-8" />
                  <th className="py-2 pr-3 text-left">사용일</th>
                  <th className="py-2 pr-3 text-left">카드</th>
                  <th className="py-2 pr-3 text-left">가맹점</th>
                  <th className="py-2 pr-3 text-right">금액</th>
                  <th className="py-2 pr-3 text-left">증빙</th>
                  <th className="py-2 pr-3 text-left">분석</th>
                  <th className="py-2 pr-3 text-left">소명 대상</th>
                  <th className="py-2 pr-3 text-left">소명 상태</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={9} className="py-8 text-center cd-text-faint">증빙이 없는 카드 건이 없습니다.</td>
                  </tr>
                )}
                {shown.map((r) => {
                  const top = r.matches[0];
                  return (
                    <tr key={r.cardTxnId} className="border-t cd-border-c align-top">
                      <td className="py-2 px-3">
                        <input type="checkbox" aria-label="소명 요청 대상으로 선택" disabled={!canRequest(r)} checked={checked.has(r.cardTxnId) && canRequest(r)} onChange={() => toggle(r.cardTxnId)} />
                      </td>
                      <td className="py-2 pr-3 cd-text whitespace-nowrap">{r.usedOn}</td>
                      <td className="py-2 pr-3 cd-text whitespace-nowrap">
                        {r.cardLabel}
                        {r.cardShared && <span className="block text-[11px] cd-text-faint">여러 부서 사용</span>}
                      </td>
                      <td className="py-2 pr-3 cd-text">
                        {r.storeName ?? "-"}
                        <span className="block text-[11px] cd-text-faint">{r.storeAddr ?? "주소 없음"}{r.storeBizType ? ` · ${r.storeBizType}` : ""}</span>
                      </td>
                      <td className="py-2 pr-3 text-right cd-text whitespace-nowrap">{fmt(r.amount)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <CdBadge tone={r.evidence === "none" ? "error" : "warn"}>{EVIDENCE_LABEL[r.evidence]}</CdBadge>
                        {r.evidenceDoc && (
                          <Link href={`/approval?docId=${encodeURIComponent(r.evidenceDoc.docId)}`} target="_blank" className="block text-[11px] cd-text-primary">
                            {r.evidenceDoc.formName ?? "문서"} · {r.evidenceDoc.drafterName ?? "-"}
                          </Link>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <CdBadge tone={VERDICT_TONE[r.verdict]}>{VERDICT_LABEL[r.verdict]}</CdBadge>
                        {top ? (
                          <div className="mt-1 text-[12px] cd-text">
                            <Link href={`/approval?docId=${encodeURIComponent(top.docId)}`} target="_blank" className="cd-text-primary">
                              {top.deptName ?? "-"} {top.drafterName ?? ""} · {md(top.from)}{top.to !== top.from ? `~${md(top.to)}` : ""}
                              {top.place ? ` · ${top.place}` : ""}
                            </Link>
                            <span className="block text-[11px] cd-text-faint">
                              {CONFIDENCE_LABEL[top.confidence]}({top.score}점) — {top.reasons.join(", ")}
                            </span>
                            {r.matches.length > 1 && (
                              <span className="block text-[11px] cd-text-faint">
                                다른 후보: {r.matches.slice(1).map((m) => `${m.deptName ?? "-"} ${m.drafterName ?? ""}(${m.score}점)`).join(", ")}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="block mt-1 text-[11px] cd-text-faint">사용일이 겹치는 출장이 없습니다.</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <select
                          className="cd-select !w-40 text-[12px]"
                          aria-label="소명 대상 부서"
                          disabled={!canRequest(r)}
                          value={targetOf(r)}
                          onChange={(e) => setTarget((prev) => ({ ...prev, [r.cardTxnId]: e.target.value }))}
                        >
                          <option value="">대상 선택</option>
                          {data.deptHeads.map((h) => (
                            <option key={h.deptId} value={h.deptId}>
                              {h.deptName} · {h.userName ?? "부서장"}
                            </option>
                          ))}
                        </select>
                        {canRequest(r) && targetOf(r) === r.suggestedDeptId && r.suggestedBy && (
                          <span className="block mt-0.5 text-[11px] cd-text-faint">
                            {r.suggestedBy === "trip" ? "추정 출장 부서" : "카드 지정 부서(사용 부서와 다를 수 있음)"}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {r.request?.status === "pending" && (
                          <span className="inline-flex items-center gap-2 whitespace-nowrap">
                            <CdBadge tone="warn">요청됨 · {r.request.requestedToName ?? "-"}</CdBadge>
                            <CdButton size="sm" variant="ghost" disabled={busy} onClick={() => void cancelRequest(r)}>
                              요청 취소
                            </CdButton>
                          </span>
                        )}
                        {r.request?.status === "answered" && (
                          <>
                            <CdBadge tone="success">회신 · {r.request.requestedToName ?? "-"}</CdBadge>
                            <span className="block mt-1 text-[12px] cd-text whitespace-pre-wrap">{r.request.answer}</span>
                          </>
                        )}
                        {!r.request && <span className="text-[11px] cd-text-faint">요청 전</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2 flex-wrap">
            <input
              className="cd-input !w-72 text-[13px]"
              placeholder="요청 메모(선택)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <CdButton
              variant="primary"
              size="sm"
              icon={<Send className="w-3.5 h-3.5" />}
              disabled={!selected.length || !data.requestsReady}
              loading={busy}
              onClick={() => void sendRequests()}
            >
              소명 요청 보내기{selected.length ? ` (${selected.length}건)` : ""}
            </CdButton>
          </div>
        </>
      )}
    </div>
  );
}
