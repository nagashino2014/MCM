"use client";

// 전표·장부 패널 3종 (accounting-expansion 블루프린트 §5 P3)
// - JournalPanel: 분개장 + 확정 큐. 전표입력 화면은 없다(U2·U3) — 자동 생성 전표를 보여주고,
//   계정 미확정(pending) 건만 계정 셀렉트 하나로 확정한다. "재생성"은 원장 기준 재계산(확정 건 보존).
// - LedgerPanel: 계정별원장(기간 발생·누적 잔액).
// - TrialPanel: 합계잔액시산표 + 백테스트(과거 결산 자료 임포트·계정별 대사 — §7 T1-①).
// FinanceBoard 의 소메뉴 "전표·장부" 그룹에서 렌더된다(cdash 스타일 관례 동일).

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Download, RefreshCw, Trash2, Upload, Undo2, XCircle } from "lucide-react";

interface Account {
  accountCode: string;
  name: string;
  acctType: string;
}

interface EntryLine {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  memo: string | null;
}

interface Entry {
  entryId: string;
  entryDate: string;
  sourceKind: string;
  description: string | null;
  partyName: string | null;
  status: string;
  docId: string | null;
  total: number;
  lines: EntryLine[];
}

const SOURCE_LABEL: Record<string, string> = {
  card: "법인카드",
  bank_in: "입금",
  bank_out: "출금",
  tax_invoice: "세금계산서",
  invoice_manual: "계산서(수기)",
  expense_doc: "지출결의",
  depreciation: "감가상각",
  payroll: "급여",
  manual: "수동",
};

const STATUS_META: Record<string, { label: string; pill: string }> = {
  pending: { label: "확정 필요", pill: "cd-pill-warn" },
  auto: { label: "자동", pill: "cd-pill-info" },
  confirmed: { label: "확정됨", pill: "cd-pill-success" },
  excluded: { label: "제외", pill: "cd-pill-idle" },
};

const won = (n: number) => n.toLocaleString("ko-KR");
// ⚠ toISOString 은 UTC 라 KST 에서 날짜가 하루 밀린다 — 로컬 기준으로 포맷.
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const SUSPENSE = new Set(["134", "257"]);

function monthRange(offset: number): { from: string; to: string } {
  const now = new Date();
  const base = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return { from: ymd(base), to: ymd(new Date(base.getFullYear(), base.getMonth() + 1, 0)) };
}

function useAccounts(): Account[] {
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/finance/journal?view=accounts", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (alive) setAccounts(data.accounts ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return accounts;
}

/** YYYYMMDD 자동완성 날짜 입력(기존 앱 날짜 8자리 관례 — FinanceBoard DigitDateInput과 동일 동작). */
function DigitDateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const format = (digits: string) => {
    if (digits.length <= 4) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
  };
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      type="text"
      inputMode="numeric"
      placeholder="YYYYMMDD"
      className="cd-input"
      style={{ width: 110 }}
      value={text}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
        const formatted = format(digits);
        setText(formatted);
        if (digits.length === 8) onChange(formatted);
      }}
    />
  );
}

/** 기간 필터 공용 헤더(월 프리셋 + YYYYMMDD 직접 입력) — 1행 유지. */
function PeriodFilter({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button type="button" className="cd-chip cd-chip-sm" onClick={() => onChange(monthRange(0))}>이번 달</button>
      <button type="button" className="cd-chip cd-chip-sm" onClick={() => onChange(monthRange(-1))}>지난 달</button>
      <button
        type="button"
        className="cd-chip cd-chip-sm"
        onClick={() => onChange({ from: `${new Date().getFullYear()}-01-01`, to: ymd(new Date()) })}
      >
        올해
      </button>
      <DigitDateInput value={from} onChange={(v) => onChange({ from: v, to })} />
      <span className="cd-text-muted">~</span>
      <DigitDateInput value={to} onChange={(v) => onChange({ from, to: v })} />
    </div>
  );
}

// ─────────────────────────────────────────────
// 분개장 + 확정 큐
// ─────────────────────────────────────────────

/** 소스 필터(단일 선택) — 전체 / 계좌별 / 카드사별 / 카드별 / 세금계산서 / 지출결의. */
type SourceFilter =
  | { type: "all" }
  | { type: "account"; id: string }
  | { type: "cardCompany"; code: string }
  | { type: "card"; id: string; companyCode: string }
  | { type: "kind"; kind: "tax_invoice" | "expense_doc" };

interface ConnectionTag {
  id: string;
  kind: "bank" | "card";
  label: string; // 은행명 / 카드사명
  code: string; // 은행/카드사 코드(카드사 그룹핑 키)
  numberMasked: string;
  alias: string | null;
}

/** 카드 태그명 = 별칭 + 뒤 4자리(별칭 없으면 카드사명 + 뒤 4자리). */
const cardTagLabel = (c: ConnectionTag) => `${c.alias ?? c.label} ${c.numberMasked.replace(/[^0-9]/g, "").slice(-4)}`;

export function JournalPanel() {
  const [range, setRange] = useState(() => monthRange(0));
  const [status, setStatus] = useState<string>("");
  const [source, setSource] = useState<SourceFilter>({ type: "all" });
  const [connections, setConnections] = useState<ConnectionTag[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // pending 전표의 계정 지정(전표 → 선택 계정 코드)
  const [assign, setAssign] = useState<Record<string, string>>({});
  const accounts = useAccounts();

  // 계좌·카드 태그(등록이 늘어나면 태그도 함께 늘어난다 — 계좌 6·카드 18 대비)
  useEffect(() => {
    let alive = true;
    fetch("/api/finance/connections", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (!alive || !Array.isArray(data.connections)) return;
        setConnections(
          data.connections.map(
            (c: { id: string; kind: "bank" | "card"; label: string; code: string; numberMasked: string; alias: string | null }) => ({
              id: c.id,
              kind: c.kind,
              label: c.label,
              code: c.code,
              numberMasked: c.numberMasked,
              alias: c.alias,
            }),
          ),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ view: "list", from: range.from, to: range.to });
      if (status) params.set("status", status);
      if (source.type === "account") params.set("accountId", source.id);
      if (source.type === "cardCompany") params.set("cardCompany", source.code);
      if (source.type === "card") params.set("cardId", source.id);
      if (source.type === "kind") params.set("kind", source.kind);
      const res = await fetch(`/api/finance/journal?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "전표를 불러오지 못했습니다.");
      setEntries(data.entries ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range, status, source]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (body: Record<string, unknown>, successNote?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/finance/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "처리하지 못했습니다.");
      if (successNote) setNotice(successNote);
      else if (body.action === "regenerate") {
        setNotice(`재생성 완료 — 생성 ${data.created}건 · 보존 ${data.kept}건 (스캔 ${data.scanned}건)`);
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** pending 전표 확정 — suspense 라인(가지급금·가수금)의 계정만 선택 계정으로 교체해 전송. */
  const confirm = (entry: Entry) => {
    const account = assign[entry.entryId];
    if (!account) {
      setError("계정과목을 먼저 선택하세요.");
      return;
    }
    const lines = entry.lines.map((l) => ({
      accountCode: SUSPENSE.has(l.accountCode) ? account : l.accountCode,
      debit: l.debit,
      credit: l.credit,
      memo: l.memo,
    }));
    void act({ action: "confirm", entryId: entry.entryId, lines }, "확정했습니다 — 같은 거래상대는 다음부터 자동 분개됩니다.");
  };

  const pendingCount = useMemo(() => entries.filter((e) => e.status === "pending").length, [entries]);

  return (
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="cd-card-title mr-auto">분개장 — 자동분개 전표</div>
        <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy} onClick={() => act({ action: "regenerate", from: range.from, to: range.to })}>
          <RefreshCw className="w-3.5 h-3.5" /> 재생성
        </button>
      </div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <PeriodFilter from={range.from} to={range.to} onChange={setRange} />
        <span className="mx-1" />
        {[["", "전체"], ["pending", "확정 필요"], ["auto", "자동"], ["confirmed", "확정됨"], ["excluded", "제외"]].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`cd-chip cd-chip-sm ${status === key ? "" : "cd-text-muted"}`}
            data-active={status === key || undefined}
            onClick={() => setStatus(key)}
          >
            {label}
          </button>
        ))}
        {pendingCount > 0 && <span className="cd-pill cd-pill-warn">확정 필요 {pendingCount}건</span>}
      </div>
      {/* 소스 필터 태그 — 계좌 6·카드 18 등록을 대비해 은행/카드 구획을 분리 배치(단일 선택).
          카드는 카드사 태그 → 산하 카드(별칭+뒤4자리) 2단 구조(카드사 선택 시 산하 카드 태그 노출). */}
      <div className="flex flex-col gap-1.5 mb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] cd-text-faint" style={{ width: 34 }}>구분</span>
          <button
            type="button"
            className={`cd-chip cd-chip-sm ${source.type === "all" ? "" : "cd-text-muted"}`}
            data-active={source.type === "all" || undefined}
            onClick={() => setSource({ type: "all" })}
          >
            전체
          </button>
          {(
            [
              ["tax_invoice", "세금계산서"],
              ["expense_doc", "지출결의"],
            ] as Array<["tax_invoice" | "expense_doc", string]>
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              className={`cd-chip cd-chip-sm ${source.type === "kind" && source.kind === kind ? "" : "cd-text-muted"}`}
              data-active={(source.type === "kind" && source.kind === kind) || undefined}
              onClick={() => setSource(source.type === "kind" && source.kind === kind ? { type: "all" } : { type: "kind", kind })}
            >
              {label}
            </button>
          ))}
        </div>
        {connections.some((c) => c.kind === "bank") && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] cd-text-faint" style={{ width: 34 }}>은행</span>
            {connections
              .filter((c) => c.kind === "bank")
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`cd-chip cd-chip-sm ${source.type === "account" && source.id === c.id ? "" : "cd-text-muted"}`}
                  data-active={(source.type === "account" && source.id === c.id) || undefined}
                  onClick={() => setSource(source.type === "account" && source.id === c.id ? { type: "all" } : { type: "account", id: c.id })}
                >
                  {c.alias ?? c.label}
                </button>
              ))}
          </div>
        )}
        {connections.some((c) => c.kind === "card") && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] cd-text-faint" style={{ width: 34 }}>카드</span>
            {[...new Map(connections.filter((c) => c.kind === "card").map((c) => [c.code, c.label])).entries()].map(([code, label]) => {
              const companyActive =
                (source.type === "cardCompany" && source.code === code) || (source.type === "card" && source.companyCode === code);
              return (
                <button
                  key={code}
                  type="button"
                  className={`cd-chip cd-chip-sm ${companyActive ? "" : "cd-text-muted"}`}
                  data-active={companyActive || undefined}
                  onClick={() => setSource(source.type === "cardCompany" && source.code === code ? { type: "all" } : { type: "cardCompany", code })}
                >
                  {label}
                </button>
              );
            })}
            {/* 선택된 카드사 산하 카드 태그(별칭+뒤4자리) */}
            {(source.type === "cardCompany" || source.type === "card") &&
              connections
                .filter((c) => c.kind === "card" && c.code === (source.type === "cardCompany" ? source.code : source.companyCode))
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`cd-chip cd-chip-sm ${source.type === "card" && source.id === c.id ? "" : "cd-text-muted"}`}
                    data-active={(source.type === "card" && source.id === c.id) || undefined}
                    onClick={() =>
                      setSource(
                        source.type === "card" && source.id === c.id
                          ? { type: "cardCompany", code: c.code }
                          : { type: "card", id: c.id, companyCode: c.code },
                      )
                    }
                  >
                    └ {cardTagLabel(c)}
                  </button>
                ))}
          </div>
        )}
      </div>
      <div className="text-xs cd-text-muted mb-3">
        전표는 원장(카드·계좌·세금계산서·지출결의)에서 자동 생성됩니다 — 직접 입력하는 화면은 없으며, 계정이 불분명한 건만 아래에서 계정을 지정해 확정하세요.
        재생성해도 확정·제외한 건은 그대로 보존됩니다.
      </div>
      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
      {notice && <div className="text-sm mb-2" style={{ color: "var(--cd-success,#13DEB9)" }}>{notice}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="cd-text-muted text-left">
              <th className="py-1.5 pr-3 font-normal">일자</th>
              <th className="py-1.5 pr-3 font-normal">구분</th>
              <th className="py-1.5 pr-3 font-normal">적요</th>
              <th className="py-1.5 pr-3 font-normal">차변</th>
              <th className="py-1.5 pr-3 font-normal">대변</th>
              <th className="py-1.5 pr-3 font-normal text-right">금액</th>
              <th className="py-1.5 pr-3 font-normal">상태</th>
              <th className="py-1.5 font-normal">처리</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const meta = STATUS_META[entry.status] ?? { label: entry.status, pill: "cd-pill-idle" };
              const debits = entry.lines.filter((l) => l.debit > 0);
              const credits = entry.lines.filter((l) => l.credit > 0);
              return (
                <tr key={entry.entryId} className="border-t cd-hairline-row-c align-top">
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">{entry.entryDate}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">{SOURCE_LABEL[entry.sourceKind] ?? entry.sourceKind}</td>
                  <td className="py-2 pr-3 max-w-[240px]">
                    <div className="truncate" title={entry.description ?? ""}>{entry.description ?? "-"}</div>
                  </td>
                  <td className="py-2 pr-3 text-xs whitespace-nowrap">
                    {debits.map((l, i) => (
                      <div key={i}>{l.accountName} {won(l.debit)}</div>
                    ))}
                  </td>
                  <td className="py-2 pr-3 text-xs whitespace-nowrap">
                    {credits.map((l, i) => (
                      <div key={i}>{l.accountName} {won(l.credit)}</div>
                    ))}
                  </td>
                  <td className="py-2 pr-3 text-right font-medium whitespace-nowrap">{won(entry.total)}</td>
                  <td className="py-2 pr-3"><span className={`cd-pill ${meta.pill}`}>{meta.label}</span></td>
                  <td className="py-2 whitespace-nowrap">
                    {entry.status === "pending" && (
                      <span className="inline-flex items-center gap-1.5">
                        <select
                          className="cd-select"
                          value={assign[entry.entryId] ?? ""}
                          onChange={(e) => setAssign((prev) => ({ ...prev, [entry.entryId]: e.target.value }))}
                        >
                          <option value="">계정 선택…</option>
                          {accounts.map((a) => (
                            <option key={a.accountCode} value={a.accountCode}>{a.name}</option>
                          ))}
                        </select>
                        <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={busy} onClick={() => confirm(entry)}>
                          <Check className="w-3.5 h-3.5" /> 확정
                        </button>
                        <button
                          type="button"
                          className="cd-btn cd-btn-ghost cd-btn-sm"
                          disabled={busy}
                          title="경비/수금이 아닌 거래(전표 제외)"
                          onClick={() => act({ action: "exclude", entryId: entry.entryId }, "전표에서 제외했습니다.")}
                        >
                          <XCircle className="w-3.5 h-3.5" /> 제외
                        </button>
                      </span>
                    )}
                    {(entry.status === "confirmed" || entry.status === "excluded") && (
                      <button
                        type="button"
                        className="cd-btn cd-btn-ghost cd-btn-sm"
                        disabled={busy}
                        title="확정/제외를 되돌립니다(다음 재생성 때 자동 규칙으로 재계산)"
                        onClick={() => act({ action: "unconfirm", entryId: entry.entryId }, "되돌렸습니다.")}
                      >
                        <Undo2 className="w-3.5 h-3.5" /> 되돌리기
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center cd-text-muted text-sm">
                  전표가 없습니다 — "재생성"을 누르면 이 기간의 원장에서 자동분개를 만듭니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 계정별원장
// ─────────────────────────────────────────────

interface LedgerRow {
  entryDate: string;
  description: string | null;
  partyName: string | null;
  debit: number;
  credit: number;
  balance: number;
}

export function LedgerPanel() {
  const [range, setRange] = useState(() => ({ from: `${new Date().getFullYear()}-01-01`, to: ymd(new Date()) }));
  const accounts = useAccounts();
  const [accountCode, setAccountCode] = useState("");
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [totals, setTotals] = useState<{ debit: number; credit: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountCode && accounts.length) setAccountCode(accounts[0].accountCode);
  }, [accounts, accountCode]);

  useEffect(() => {
    if (!accountCode) return;
    let alive = true;
    (async () => {
      setError(null);
      try {
        const params = new URLSearchParams({ view: "ledger", account: accountCode, from: range.from, to: range.to });
        const res = await fetch(`/api/finance/journal?${params}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "원장을 불러오지 못했습니다.");
        if (!alive) return;
        setRows(data.rows ?? []);
        setTotals({ debit: data.totalDebit ?? 0, credit: data.totalCredit ?? 0 });
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [accountCode, range]);

  return (
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="cd-card-title mr-auto">계정별원장</div>
        <select className="cd-select" value={accountCode} onChange={(e) => setAccountCode(e.target.value)}>
          {accounts.map((a) => (
            <option key={a.accountCode} value={a.accountCode}>{a.accountCode} {a.name}</option>
          ))}
        </select>
      </div>
      <div className="mb-3">
        <PeriodFilter from={range.from} to={range.to} onChange={setRange} />
      </div>
      <div className="text-xs cd-text-muted mb-3">자동·확정 전표만 집계됩니다(확정 필요·제외 건 제외). 잔액은 기간 내 발생 누적입니다.</div>
      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="cd-text-muted text-left">
              <th className="py-1.5 pr-3 font-normal">일자</th>
              <th className="py-1.5 pr-3 font-normal">적요</th>
              <th className="py-1.5 pr-3 font-normal">거래상대</th>
              <th className="py-1.5 pr-3 font-normal text-right">차변</th>
              <th className="py-1.5 pr-3 font-normal text-right">대변</th>
              <th className="py-1.5 font-normal text-right">잔액</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t cd-hairline-row-c">
                <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{r.entryDate}</td>
                <td className="py-1.5 pr-3 max-w-[280px] truncate" title={r.description ?? ""}>{r.description ?? "-"}</td>
                <td className="py-1.5 pr-3 max-w-[160px] truncate">{r.partyName ?? "-"}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">{r.debit ? won(r.debit) : ""}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">{r.credit ? won(r.credit) : ""}</td>
                <td className="py-1.5 text-right whitespace-nowrap font-medium">{won(r.balance)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center cd-text-muted text-sm">기간 내 거래가 없습니다.</td>
              </tr>
            )}
          </tbody>
          {totals && rows.length > 0 && (
            <tfoot>
              <tr className="border-t cd-hairline-row-c font-medium">
                <td className="py-1.5 pr-3" colSpan={3}>합계</td>
                <td className="py-1.5 pr-3 text-right">{won(totals.debit)}</td>
                <td className="py-1.5 pr-3 text-right">{won(totals.credit)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 합계잔액시산표 + 백테스트(결산 자료 대사)
// ─────────────────────────────────────────────

interface TrialRow {
  accountCode: string;
  name: string;
  acctType: string;
  debit: number;
  credit: number;
}

interface ImportBatch {
  batchId: string;
  yearLabel: string;
  fileName: string | null;
  lineCount: number;
  createdAt: string;
}

interface ReconcileRow {
  accountCode: string | null;
  accountName: string;
  importDebit: number;
  importCredit: number;
  appDebit: number;
  appCredit: number;
  diffDebit: number;
  diffCredit: number;
}

export function TrialPanel() {
  const now = new Date();
  const [range, setRange] = useState(() => ({ from: `${now.getFullYear()}-01-01`, to: ymd(now) }));
  const [rows, setRows] = useState<TrialRow[]>([]);
  const [totals, setTotals] = useState<{ debit: number; credit: number; pending: number }>({ debit: 0, credit: 0, pending: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setError(null);
      try {
        const res = await fetch(`/api/finance/journal?view=trial&from=${range.from}&to=${range.to}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "시산표를 불러오지 못했습니다.");
        if (!alive) return;
        setRows(data.rows ?? []);
        setTotals({ debit: data.totalDebit ?? 0, credit: data.totalCredit ?? 0, pending: data.pendingCount ?? 0 });
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [range]);

  const balanced = totals.debit === totals.credit;

  return (
    <div className="space-y-4">
      <div className="cd-card p-4">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="cd-card-title mr-auto">합계잔액시산표(기간 발생액)</div>
          <span className={`cd-pill ${balanced ? "cd-pill-success" : "cd-pill-warn"}`}>
            {balanced ? "차대 일치" : "차대 불일치"}
          </span>
          {totals.pending > 0 && <span className="cd-pill cd-pill-warn">확정 필요 {totals.pending}건 미포함</span>}
        </div>
        <div className="mb-3">
          <PeriodFilter from={range.from} to={range.to} onChange={setRange} />
        </div>
        {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="cd-text-muted text-left">
                <th className="py-1.5 pr-3 font-normal">코드</th>
                <th className="py-1.5 pr-3 font-normal">계정과목</th>
                <th className="py-1.5 pr-3 font-normal text-right">차변 합계</th>
                <th className="py-1.5 font-normal text-right">대변 합계</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.accountCode} className="border-t cd-hairline-row-c">
                  <td className="py-1.5 pr-3 text-xs cd-text-muted">{r.accountCode}</td>
                  <td className="py-1.5 pr-3">{r.name}</td>
                  <td className="py-1.5 pr-3 text-right whitespace-nowrap">{r.debit ? won(r.debit) : ""}</td>
                  <td className="py-1.5 text-right whitespace-nowrap">{r.credit ? won(r.credit) : ""}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-6 text-center cd-text-muted text-sm">
                    집계할 전표가 없습니다 — 분개장에서 "재생성"을 먼저 실행하세요.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t cd-hairline-row-c font-medium">
                  <td className="py-1.5 pr-3" colSpan={2}>합계</td>
                  <td className="py-1.5 pr-3 text-right">{won(totals.debit)}</td>
                  <td className="py-1.5 text-right">{won(totals.credit)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      <BacktestCard />
    </div>
  );
}

/** 백테스트 — 세무법인 결산 자료(계정 원장 엑셀) 임포트 + 계정별 대사(§7 T1-①). */
function BacktestCard() {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState<ReconcileRow[] | null>(null);
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadBatches = useCallback(async () => {
    try {
      const res = await fetch("/api/finance/journal/import", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setBatches(data.batches ?? []);
    } catch {
      // 조용히
    }
  }, []);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  useEffect(() => {
    if (!selected) {
      setReport(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/finance/journal/import?batchId=${encodeURIComponent(selected)}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "대사 리포트를 불러오지 못했습니다.");
        if (alive) setReport(data.rows ?? []);
      } catch (err) {
        if (alive) setError((err as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [selected]);

  const upload = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.set("file", file, file.name);
      fd.set("year", year);
      const res = await fetch("/api/finance/journal/import", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "임포트에 실패했습니다.");
      const unmatched = (data.unmatchedAccounts ?? []) as string[];
      setNotice(
        `${data.lineCount}행 적재 완료` +
          (unmatched.length ? ` · 미매칭 계정 ${unmatched.length}종: ${unmatched.slice(0, 5).join(", ")}${unmatched.length > 5 ? " …" : ""}` : ""),
      );
      await loadBatches();
      setSelected(String(data.batchId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (batchId: string) => {
    if (!window.confirm("이 임포트 배치를 삭제할까요? (전표에는 영향 없음)")) return;
    await fetch(`/api/finance/journal/import?batchId=${encodeURIComponent(batchId)}`, { method: "DELETE" });
    if (selected === batchId) setSelected(null);
    await loadBatches();
  };

  return (
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="cd-card-title mr-auto">백테스트 — 세무법인 결산 자료 대사</div>
        <select className="cd-select" value={year} onChange={(e) => setYear(e.target.value)}>
          {[0, 1, 2, 3].map((d) => {
            const y = new Date().getFullYear() - d;
            return (
              <option key={y} value={String(y)}>{y}년</option>
            );
          })}
        </select>
        <label className={`cd-btn cd-btn-soft cd-btn-sm ${busy ? "opacity-50 pointer-events-none" : ""}`}>
          <Upload className="w-3.5 h-3.5" /> 결산 자료 업로드(xls/xlsx)
          <input type="file" accept=".xls,.xlsx,.xlsm" className="hidden" onChange={(e) => upload(e.target.files?.[0] ?? null)} />
        </label>
      </div>
      <div className="text-xs cd-text-muted mb-3">
        세무법인에서 받은 계정 원장·시산표 엑셀(헤더에 계정과목·차변·대변 열이 있는 목록형)을 올리면,
        같은 연도의 앱 자동분개와 계정별로 비교해 차이를 보여줍니다. 차이 원인을 분류 규칙에 반영해 오차를 줄여가는 것이 목적입니다.
      </div>
      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
      {notice && <div className="text-sm mb-2" style={{ color: "var(--cd-success,#13DEB9)" }}>{notice}</div>}

      {batches.length > 0 && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {batches.map((b) => (
            <span key={b.batchId} className="inline-flex items-center gap-1">
              <button
                type="button"
                className={`cd-chip cd-chip-sm ${selected === b.batchId ? "" : "cd-text-muted"}`}
                data-active={selected === b.batchId || undefined}
                onClick={() => setSelected(selected === b.batchId ? null : b.batchId)}
              >
                {b.yearLabel}년 · {b.fileName ?? b.batchId} ({b.lineCount}행)
              </button>
              <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" title="배치 삭제" onClick={() => remove(b.batchId)}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {report && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="cd-text-muted text-left">
                <th className="py-1.5 pr-3 font-normal">계정과목</th>
                <th className="py-1.5 pr-3 font-normal text-right">세무법인 차변</th>
                <th className="py-1.5 pr-3 font-normal text-right">앱 차변</th>
                <th className="py-1.5 pr-3 font-normal text-right">차이</th>
                <th className="py-1.5 pr-3 font-normal text-right">세무법인 대변</th>
                <th className="py-1.5 pr-3 font-normal text-right">앱 대변</th>
                <th className="py-1.5 font-normal text-right">차이</th>
              </tr>
            </thead>
            <tbody>
              {report.map((r, i) => {
                const mismatch = r.diffDebit !== 0 || r.diffCredit !== 0;
                return (
                  <tr key={i} className="border-t cd-hairline-row-c">
                    <td className="py-1.5 pr-3">
                      {r.accountName}
                      {!r.accountCode && (
                        <span className="ml-1.5 cd-pill cd-pill-warn" title="앱 계정과목에 매칭되지 않음 — 계정 시드 보강 필요">
                          <AlertTriangle className="w-3 h-3" /> 미매칭
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(r.importDebit)}</td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(r.appDebit)}</td>
                    <td className={`py-1.5 pr-3 text-right whitespace-nowrap ${r.diffDebit !== 0 ? "cd-error-text font-medium" : "cd-text-muted"}`}>
                      {won(r.diffDebit)}
                    </td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(r.importCredit)}</td>
                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(r.appCredit)}</td>
                    <td className={`py-1.5 text-right whitespace-nowrap ${r.diffCredit !== 0 ? "cd-error-text font-medium" : "cd-text-muted"}`}>
                      {won(r.diffCredit)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {!report && batches.length === 0 && (
        <div className="py-4 text-center cd-text-muted text-sm">
          <Download className="w-4 h-4 inline mr-1" />
          아직 임포트한 결산 자료가 없습니다 — 작년·재작년 자료로 백테스트를 시작하세요.
        </div>
      )}
    </div>
  );
}
