"use client";

// 전표·장부 패널 3종 (accounting-expansion 블루프린트 §5 P3)
// - JournalPanel: 분개장 + 확정 큐. 전표입력 화면은 없다(U2·U3) — 자동 생성 전표를 보여주고,
//   계정 미확정(pending) 건만 계정 셀렉트 하나로 확정한다. "재생성"은 원장 기준 재계산(확정 건 보존).
// - LedgerPanel: 계정별원장(기간 발생·누적 잔액).
// - TrialPanel: 합계잔액시산표 + 백테스트(과거 결산 자료 임포트·계정별 대사 — §7 T1-①).
// FinanceBoard 의 소메뉴 "전표·장부" 그룹에서 렌더된다(cdash 스타일 관례 동일).

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Download, RefreshCw, Trash2, Upload, Undo2, XCircle } from "lucide-react";
import { CdModal } from "@/components/cdash/CdModal";
import { FinLogo } from "@/components/finance/FinLogo";
import { PaginationControls } from "@/components/ui/PaginationControls";

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
  partyNorm: string;
  expenseKind: string | null;
  expenseKindLocked: boolean;
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
// 분개장 목록 페이지 크기(사용자 확정: 100건/페이지). 조회는 한 번에 받고 화면만 나눈다 —
// 동일 거래처 일괄 확정 후보를 페이지 경계에 상관없이 조회 결과 전체에서 찾기 위해서다.
const PAGE_SIZE = 100;

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
function DigitDateInput({ value, onChange, fill = false }: { value: string; onChange: (v: string) => void; fill?: boolean }) {
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
      style={fill ? { width: "100%", minWidth: 0 } : { width: 110 }}
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

/** 우측 계좌·카드 선택(단일) — 좌측 "구분" 태그와 AND 로 조합된다. */
type PickFilter =
  | { type: "none" }
  | { type: "account"; id: string }
  | { type: "cardCompany"; code: string }
  | { type: "card"; id: string; companyCode: string };

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

/** 좌측 "구분" 태그 — listJournal.sourceKind 세분 키.
 *  ⚠ 법인/개인은 결재 양식이 아니라 "행 단위 카드 라벨"로 갈린다 — 지출·출장 문서의 법인카드 행은 card 전표로,
 *  개인 지출 행만 expense_doc 전표로 생성된다(출장보고서는 법인·개인 혼재라 양식만으로는 못 가른다). */
const KIND_TAGS: Array<[string, string]> = [
  ["", "전체"],
  ["bank_out", "계좌(출금)"],
  ["bank_in", "계좌(입금)"],
  ["tax_invoice_manual", "세금계산서(수기)"],
  ["tax_invoice_auto", "세금계산서(자동)"],
  ["trip_corp", "출장경비(법인)"],
  ["trip_personal", "출장경비(개인)"],
  ["expense_corp", "지출결의(법인)"],
  ["expense_personal", "지출결의(개인)"],
  ["card_unassigned", "구분 미지정"],
];

/** 카드 전표의 경비 성격 배지 라벨(사후 지정 대상 식별용). */
const EXPENSE_KIND_LABEL: Record<string, string> = { trip: "출장경비", expense: "지출결의" };

const STATUS_TAGS: Array<[string, string]> = [
  ["", "전체"],
  ["pending", "확정 필요"],
  ["auto", "자동"],
  ["confirmed", "확정됨"],
  ["excluded", "제외"],
];

/** 기간 프리셋 — 회계 화면이라 월/연 경계로 끊는다(1개월=이번 달, 3개월=이번 달 포함 최근 3개월). */
const monthsRange = (n: number): { from: string; to: string } => {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: ymd(from), to: ymd(to) };
};
const yearRange = (y: number) => ({ from: `${y}-01-01`, to: `${y}-12-31` });

/** 필터 태그 공통 — 미선택은 윤곽선만(cdash 규칙: 채움은 선택된 것만). */
function FilterChip({
  active,
  onClick,
  className,
  children,
}: {
  active: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`cd-chip cd-chip-sm ${active ? "" : "cd-text-muted"} ${className ?? ""}`}
      data-active={active || undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function JournalPanel() {
  const [range, setRange] = useState(() => monthsRange(1));
  const [status, setStatus] = useState<string>("");
  const [kind, setKind] = useState<string>("");
  const [side, setSide] = useState<"bank" | "card">("bank");
  const [pick, setPick] = useState<PickFilter>({ type: "none" });
  const [acctFilter, setAcctFilter] = useState<Set<string>>(() => new Set());
  const [connections, setConnections] = useState<ConnectionTag[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // pending 전표의 계정 지정(전표 → 선택 계정 코드)
  const [assign, setAssign] = useState<Record<string, string>>({});
  // 동일 거래처 일괄 확정 확인 모달(체크를 풀면 그 건은 대상에서 빠진다)
  const [bulk, setBulk] = useState<{ base: Entry; accountCode: string; targets: Entry[] } | null>(null);
  const [bulkOff, setBulkOff] = useState<Set<string>>(() => new Set());
  const [offset, setOffset] = useState(0);
  // 카드 전표 경비 성격 사후 지정 — 목록에서 다중 선택해 일괄 부여(마이그 186)
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const accounts = useAccounts();
  const years = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => y - i);
  }, []);

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
      const params = new URLSearchParams({ view: "list", from: range.from, to: range.to, limit: "1000" });
      if (status) params.set("status", status);
      if (kind) params.set("kind", kind);
      if (pick.type === "account") params.set("accountId", pick.id);
      if (pick.type === "cardCompany") params.set("cardCompany", pick.code);
      if (pick.type === "card") params.set("cardId", pick.id);
      for (const code of acctFilter) params.append("account", code);
      const res = await fetch(`/api/finance/journal?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "전표를 불러오지 못했습니다.");
      setEntries(data.entries ?? []);
      setOffset(0); // 필터가 바뀌면 첫 페이지로
      setChecked(new Set());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [range, status, kind, pick, acctFilter]);

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

  /** pending 전표 1건 확정 — suspense 라인(가지급금·가수금)의 계정만 선택 계정으로 교체해 전송. */
  const confirmOne = (entry: Entry, account: string) => {
    const lines = entry.lines.map((l) => ({
      accountCode: SUSPENSE.has(l.accountCode) ? account : l.accountCode,
      debit: l.debit,
      credit: l.credit,
      memo: l.memo,
    }));
    void act({ action: "confirm", entryId: entry.entryId, lines }, "확정했습니다 — 같은 거래상대는 다음부터 자동 분개됩니다.");
  };

  /** 확정 버튼 — 적요의 입금/출금처가 완전히 같은 미확정 건이 더 있으면 일괄 확정 여부를 먼저 묻는다. */
  const confirm = (entry: Entry) => {
    const account = assign[entry.entryId];
    if (!account) {
      setError("계정과목을 먼저 선택하세요.");
      return;
    }
    const targets = entry.partyNorm
      ? entries.filter((e) => e.entryId !== entry.entryId && e.status === "pending" && e.partyNorm === entry.partyNorm)
      : [];
    if (targets.length) {
      setBulkOff(new Set());
      setBulk({ base: entry, accountCode: account, targets });
      return;
    }
    confirmOne(entry, account);
  };

  const runBulk = () => {
    if (!bulk) return;
    const ids = [bulk.base.entryId, ...bulk.targets.filter((t) => !bulkOff.has(t.entryId)).map((t) => t.entryId)];
    const accountCode = bulk.accountCode;
    setBulk(null);
    void act(
      { action: "confirm_bulk", entryIds: ids, accountCode },
      `${ids.length}건을 확정했습니다 — 같은 거래상대는 다음부터 자동 분개됩니다.`,
    );
  };

  /** 선택한 카드 전표에 경비 성격을 부여/해제한다(결재문서 귀속 건은 서버에서 대상 제외). */
  const applyExpenseKind = (expenseKind: "trip" | "expense" | null) => {
    const ids = [...checked];
    if (!ids.length) return;
    setChecked(new Set());
    void act(
      { action: "set_expense_kind", entryIds: ids, expenseKind },
      expenseKind
        ? `${ids.length}건을 ${EXPENSE_KIND_LABEL[expenseKind]}(으)로 지정했습니다.`
        : `${ids.length}건의 구분 지정을 해제했습니다.`,
    );
  };

  const pendingCount = useMemo(() => entries.filter((e) => e.status === "pending").length, [entries]);
  // 사후 지정 가능 건 = 카드 전표 중 결재문서에 귀속되지 않은 것
  const pageEntries = useMemo(() => entries.slice(offset, offset + PAGE_SIZE), [entries, offset]);
  const assignable = useMemo(() => pageEntries.filter((e) => e.sourceKind === "card" && !e.expenseKindLocked), [pageEntries]);
  const bankTags = useMemo(() => connections.filter((c) => c.kind === "bank"), [connections]);
  const cardCompanies = useMemo(
    () => [...new Map(connections.filter((c) => c.kind === "card").map((c) => [c.code, c.label])).entries()],
    [connections],
  );
  const bulkAccountName = accounts.find((a) => a.accountCode === bulk?.accountCode)?.name ?? bulk?.accountCode ?? "";

  return (
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="cd-card-title mr-auto">분개장 — 자동분개 전표</div>
        <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy} onClick={() => act({ action: "regenerate", from: range.from, to: range.to })}>
          <RefreshCw className="w-3.5 h-3.5" /> 재생성
        </button>
      </div>

      {/* 필터 — 좌: 기간·구분·상태 / 우: 계좌·카드(로고 태그) / 하단: 계정 과목(전체 폭) */}
      <div className="rounded-xl border cd-border-c p-3 mb-3">
        {/* 좌 3 : 우 7 — 컨셉 도면 비율(좌측 기간·구분 블록이 전체 폭의 30%) */}
        <div className="grid grid-cols-1 xl:grid-cols-10 gap-x-8 gap-y-4">
          <div className="min-w-0 xl:col-span-3">
            {/* 프리셋 4칸 균등 + 연도 목록박스(넓게) */}
            <div className="grid gap-1.5 items-center" style={{ gridTemplateColumns: "repeat(4, minmax(0,1fr)) minmax(0,2.4fr)" }}>
              <FilterChip className="w-full justify-center" active={false} onClick={() => setRange(monthsRange(1))}>1개월</FilterChip>
              <FilterChip className="w-full justify-center" active={false} onClick={() => setRange(monthsRange(3))}>3개월</FilterChip>
              <FilterChip className="w-full justify-center" active={false} onClick={() => setRange(yearRange(new Date().getFullYear()))}>올해</FilterChip>
              <FilterChip className="w-full justify-center" active={false} onClick={() => setRange(yearRange(new Date().getFullYear() - 1))}>작년</FilterChip>
              <select
                className="cd-select"
                style={{ width: "100%", minWidth: 0 }}
                value=""
                onChange={(e) => {
                  if (e.target.value) setRange(yearRange(Number(e.target.value)));
                }}
              >
                <option value="">연도 선택…</option>
                {years.map((y) => (
                  <option key={y} value={y}>{y}년</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2 items-center mt-2" style={{ gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)" }}>
              <DigitDateInput fill value={range.from} onChange={(v) => setRange({ from: v, to: range.to })} />
              <span className="cd-text-muted">~</span>
              <DigitDateInput fill value={range.to} onChange={(v) => setRange({ from: range.from, to: v })} />
            </div>

            <div className="cd-label text-xs mt-3 mb-1.5">구분</div>
            {/* 3열 균등(컨셉 도면) — 전체 / 계좌(출금·입금) / 세금계산서(수기·자동) / 출장경비·지출결의(법인·개인) */}
            <div className="grid grid-cols-3 gap-1.5">
              {KIND_TAGS.map(([key, label]) => (
                <FilterChip key={key} className="w-full justify-center" active={kind === key} onClick={() => setKind(key)}>
                  {label}
                </FilterChip>
              ))}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
              {STATUS_TAGS.map(([key, label]) => (
                <FilterChip key={key} active={status === key} onClick={() => setStatus(key)}>
                  {label}
                </FilterChip>
              ))}
              {pendingCount > 0 && <span className="cd-pill cd-pill-warn">확정 필요 {pendingCount}건</span>}
            </div>
          </div>

          <div className="min-w-0 xl:col-span-7">
            <div className="flex items-center gap-1.5 flex-wrap">
              {(["bank", "card"] as const).map((s) => (
                <FilterChip
                  key={s}
                  active={side === s}
                  onClick={() => {
                    setSide(s);
                    setPick({ type: "none" }); // 축이 바뀌면 선택 해제(계좌 ↔ 카드는 상호배타)
                  }}
                >
                  {s === "bank" ? "계좌" : "카드"}
                </FilterChip>
              ))}
            </div>

            {side === "bank" && (
              // 은행 태그 5열 균등(컨셉 도면) — 로고 + 계좌 별칭
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2 mt-2">
                {bankTags.map((c) => {
                  const active = pick.type === "account" && pick.id === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setPick(active ? { type: "none" } : { type: "account", id: c.id })}
                      className="w-full flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-sm text-left transition-colors"
                      style={
                        active
                          ? { borderColor: "var(--cd-primary)", background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }
                          : { borderColor: "var(--cd-faint)" }
                      }
                    >
                      <FinLogo kind="bank" code={c.code} label={c.label} size={26} />
                      <span className="truncate font-medium">{c.alias ?? c.label}</span>
                    </button>
                  );
                })}
                {bankTags.length === 0 && <span className="text-sm cd-text-muted col-span-full">등록된 계좌가 없습니다.</span>}
              </div>
            )}

            {side === "card" && (
              <>
                {/* 카드사 태그 5열 균등(컨셉 도면) */}
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2 mt-2">
                  {cardCompanies.map(([code, label]) => {
                    const active =
                      (pick.type === "cardCompany" && pick.code === code) || (pick.type === "card" && pick.companyCode === code);
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setPick(active ? { type: "none" } : { type: "cardCompany", code })}
                        className="w-full flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-sm text-left transition-colors"
                        style={
                          active
                            ? { borderColor: "var(--cd-primary)", background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }
                            : { borderColor: "var(--cd-faint)" }
                        }
                      >
                        <FinLogo kind="card" code={code} label={label} size={26} />
                        <span className="truncate font-medium">{label}</span>
                      </button>
                    );
                  })}
                  {cardCompanies.length === 0 && <span className="text-sm cd-text-muted col-span-full">등록된 카드가 없습니다.</span>}
                </div>
                {/* 선택된 카드사 산하 카드 태그(별칭+뒤4자리) — 7열 균등(컨셉 도면) */}
                {(pick.type === "cardCompany" || pick.type === "card") && (
                  <div className="grid grid-cols-3 sm:grid-cols-5 xl:grid-cols-7 gap-1.5 mt-2">
                    {connections
                      .filter((c) => c.kind === "card" && c.code === (pick.type === "cardCompany" ? pick.code : pick.companyCode))
                      .map((c) => (
                        <FilterChip
                          key={c.id}
                          className="w-full justify-center"
                          active={pick.type === "card" && pick.id === c.id}
                          onClick={() =>
                            setPick(
                              pick.type === "card" && pick.id === c.id
                                ? { type: "cardCompany", code: c.code }
                                : { type: "card", id: c.id, companyCode: c.code },
                            )
                          }
                        >
                          {cardTagLabel(c)}
                        </FilterChip>
                      ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="cd-label text-xs mt-4 mb-1.5">
          계정 과목
          {acctFilter.size > 0 && (
            <button type="button" className="ml-2 cd-text-muted underline text-[11px]" onClick={() => setAcctFilter(new Set())}>
              선택 해제({acctFilter.size})
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 xl:grid-cols-8 gap-1.5">
          {accounts.map((a) => (
            <FilterChip
              key={a.accountCode}
              className="w-full justify-center"
              active={acctFilter.has(a.accountCode)}
              onClick={() =>
                setAcctFilter((prev) => {
                  const next = new Set(prev);
                  if (next.has(a.accountCode)) next.delete(a.accountCode);
                  else next.add(a.accountCode);
                  return next;
                })
              }
            >
              <span className="truncate">{a.name}</span>
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="text-xs cd-text-muted mb-3">
        전표는 원장(카드·계좌·세금계산서·지출결의)에서 자동 생성됩니다 — 직접 입력하는 화면은 없으며, 계정이 불분명한 건만 아래에서 계정을 지정해 확정하세요.
        재생성해도 확정·제외한 건은 그대로 보존됩니다.
      </div>
      {/* 카드 사용내역 구분 사후 지정 — 결재문서에 귀속되지 않은 카드 건을 골라 출장경비/지출결의로 라벨링한다.
          (귀속 문서가 생기면 그 값이 우선하므로 여기 지정은 자동으로 덮인다) */}
      {assignable.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-xl border cd-border-c p-2 mb-3">
          <span className="text-xs cd-text-muted">
            카드 사용내역 구분 지정 — 이 페이지에 문서 미귀속 카드 전표 {assignable.length}건
            {checked.size > 0 && <span className="cd-text"> · 선택 {checked.size}건</span>}
          </span>
          <button
            type="button"
            className="cd-btn cd-btn-ghost cd-btn-sm"
            onClick={() =>
              setChecked((prev) => (prev.size === assignable.length ? new Set() : new Set(assignable.map((e) => e.entryId))))
            }
          >
            {checked.size === assignable.length ? "전체 해제" : "이 페이지 전체 선택"}
          </button>
          <span className="mx-auto" />
          <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy || !checked.size} onClick={() => applyExpenseKind("trip")}>
            출장경비로 지정
          </button>
          <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" disabled={busy || !checked.size} onClick={() => applyExpenseKind("expense")}>
            지출결의로 지정
          </button>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy || !checked.size} onClick={() => applyExpenseKind(null)}>
            지정 해제
          </button>
        </div>
      )}
      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
      {notice && <div className="text-sm mb-2" style={{ color: "var(--cd-success,#13DEB9)" }}>{notice}</div>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="cd-text-muted text-left">
              <th className="py-1.5 pr-2 font-normal" style={{ width: 28 }}></th>
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
            {pageEntries.map((entry) => {
              const meta = STATUS_META[entry.status] ?? { label: entry.status, pill: "cd-pill-idle" };
              const debits = entry.lines.filter((l) => l.debit > 0);
              const credits = entry.lines.filter((l) => l.credit > 0);
              const canAssign = entry.sourceKind === "card" && !entry.expenseKindLocked;
              return (
                <tr key={entry.entryId} className="border-t cd-hairline-row-c align-top">
                  <td className="py-2 pr-2">
                    {canAssign && (
                      <input
                        type="checkbox"
                        checked={checked.has(entry.entryId)}
                        onChange={() =>
                          setChecked((prev) => {
                            const next = new Set(prev);
                            if (next.has(entry.entryId)) next.delete(entry.entryId);
                            else next.add(entry.entryId);
                            return next;
                          })
                        }
                      />
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">{entry.entryDate}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">
                    <div>{SOURCE_LABEL[entry.sourceKind] ?? entry.sourceKind}</div>
                    {entry.sourceKind === "card" && (
                      <div className="mt-0.5 cd-text-faint">
                        {entry.expenseKind
                          ? `${EXPENSE_KIND_LABEL[entry.expenseKind] ?? entry.expenseKind}${entry.expenseKindLocked ? " (문서)" : ""}`
                          : "구분 미지정"}
                      </div>
                    )}
                  </td>
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
                <td colSpan={9} className="py-6 text-center cd-text-muted text-sm">
                  전표가 없습니다 — "재생성"을 누르면 이 기간의 원장에서 자동분개를 만듭니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mt-3">
        <PaginationControls total={entries.length} limit={PAGE_SIZE} offset={offset} loading={loading} onPageChange={setOffset} />
      </div>

      {/* 동일 거래처 일괄 확정 — 체크를 풀면 그 건은 대상에서 빠진다(확정 필요 상태 유지). */}
      <CdModal
        open={!!bulk}
        onClose={() => setBulk(null)}
        size="xl"
        title="같은 거래처 일괄 확정"
        footer={
          bulk ? (
            <div className="flex items-center gap-2 justify-end">
              <button type="button" className="cd-btn cd-btn-ghost" onClick={() => setBulk(null)}>취소</button>
              <button
                type="button"
                className="cd-btn cd-btn-soft"
                onClick={() => {
                  const base = bulk.base;
                  const account = bulk.accountCode;
                  setBulk(null);
                  confirmOne(base, account);
                }}
              >
                이 건만 확정
              </button>
              <button
                type="button"
                className="cd-btn cd-btn-primary"
                onClick={runBulk}
              >
                <Check className="w-4 h-4" /> {1 + bulk.targets.filter((t) => !bulkOff.has(t.entryId)).length}건 일괄 확정
              </button>
            </div>
          ) : null
        }
      >
        {bulk && (
          <div>
            <div className="text-sm mb-3">
              <span className="font-bold">{bulk.base.partyName}</span> 건이 <span className="font-bold">{bulkAccountName}</span> 으로 확정됩니다.
              현재 목록에 입금/출금처가 같은 미확정 전표가 <span className="font-bold">{bulk.targets.length}건</span> 더 있습니다 — 함께 확정할까요?
            </div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setBulkOff(new Set())}>
                모두 선택
              </button>
              <button
                type="button"
                className="cd-btn cd-btn-ghost cd-btn-sm"
                onClick={() => setBulkOff(new Set(bulk.targets.map((t) => t.entryId)))}
              >
                모두 해제
              </button>
              <span className="text-xs cd-text-muted">체크를 풀면 그 건은 확정하지 않고 "확정 필요"로 남습니다.</span>
            </div>
            <div className="overflow-x-auto" style={{ maxHeight: "46vh" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="cd-text-muted text-left">
                    <th className="py-1.5 pr-3 font-normal" style={{ width: 56 }}></th>
                    <th className="py-1.5 pr-3 font-normal">일자</th>
                    <th className="py-1.5 pr-3 font-normal">구분</th>
                    <th className="py-1.5 pr-3 font-normal">적요</th>
                    <th className="py-1.5 font-normal text-right">금액</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t cd-hairline-row-c">
                    <td className="py-2 pr-3"><span className="cd-pill cd-pill-info">기준</span></td>
                    <td className="py-2 pr-3 whitespace-nowrap text-xs">{bulk.base.entryDate}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-xs">{SOURCE_LABEL[bulk.base.sourceKind] ?? bulk.base.sourceKind}</td>
                    <td className="py-2 pr-3"><div className="truncate max-w-[360px]" title={bulk.base.description ?? ""}>{bulk.base.description ?? "-"}</div></td>
                    <td className="py-2 text-right font-medium whitespace-nowrap">{won(bulk.base.total)}</td>
                  </tr>
                  {bulk.targets.map((t) => (
                    <tr key={t.entryId} className="border-t cd-hairline-row-c">
                      <td className="py-2 pr-3">
                        <input
                          type="checkbox"
                          checked={!bulkOff.has(t.entryId)}
                          onChange={() =>
                            setBulkOff((prev) => {
                              const next = new Set(prev);
                              if (next.has(t.entryId)) next.delete(t.entryId);
                              else next.add(t.entryId);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-xs">{t.entryDate}</td>
                      <td className="py-2 pr-3 whitespace-nowrap text-xs">{SOURCE_LABEL[t.sourceKind] ?? t.sourceKind}</td>
                      <td className="py-2 pr-3"><div className="truncate max-w-[360px]" title={t.description ?? ""}>{t.description ?? "-"}</div></td>
                      <td className="py-2 text-right font-medium whitespace-nowrap">{won(t.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CdModal>
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
