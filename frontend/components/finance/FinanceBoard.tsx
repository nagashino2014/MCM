"use client";

// 재무 보드 (P0) — 바로빌 연결 관리(F0) + 계좌/법인카드 원장 최소 조회.
// 설계: docs/barobill-finance-blueprint.md §4 F0 · §5 P0.
// - 연결 관리: 등록(바로빌 호스팅 URL 팝업, 60초 유효 — 자격증명이 앱 서버를 거치지 않음),
//   해지/해지취소/재등록(Stop 계열 API), 카드 즉시 수집(RefreshNow), 수집 로그.
// - 수집(catch-up)은 /api/finance/connections GET 이 stale 판정 시 서버가 백그라운드 실행.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Landmark,
  CreditCard,
  RefreshCw,
  Plus,
  StopCircle,
  RotateCcw,
  Undo2,
  Download,
  Store,
  Trash2,
  AlertTriangle,
  Upload,
} from "lucide-react";
import { useCdashTheme } from "@/components/cdash/useCdashTheme";
import { CdPageHeader } from "@/components/cdash/CdPageHeader";
import { CdModal } from "@/components/cdash/CdModal";
import { FinLogo, logoFileCode } from "@/components/finance/FinLogo";
import { PaginationControls } from "@/components/ui/PaginationControls";
import { JournalPanel, LedgerPanel, TrialPanel } from "@/components/finance/JournalPanels";
import { PnlPanel, CashPanel } from "@/components/finance/ManagementPanels";
import { HometaxPanel, VatReturnPanel, WithholdingPanel } from "@/components/finance/VatReturnPanels";
import { FixedAssetPanel, TripLogPanel, BudgetPanel } from "@/components/finance/AssetBudgetPanels";
import { ReceiptCollectPanel } from "@/components/finance/ReceiptCollectPanel";
import { BalanceSheetPanel, ClosingPanel } from "@/components/finance/ClosingPanels";
import { ExpenseSettlementPanel } from "@/components/finance/ExpenseSettlementPanel";
import { IncomeLedgerPanel } from "@/components/finance/IncomeLedgerPanel";
import { SeverancePanel } from "@/components/finance/SeverancePanel";
import "@/components/cdash/cdash.css";

/** 최근 수집 로그 카드에 한 번에 보여줄 줄 수. */
const LOG_PAGE_SIZE = 10;

type Tab =
  | "connections" | "bank" | "card" | "recon" | "vat" | "invoice" | "journal" | "ledger" | "trial" | "pnl" | "cash"
  | "hometax" | "vatreturn" | "fixedassets" | "triplog" | "budget" | "withholding" | "balance" | "closing"
  | "shopreceipt" | "expsettle" | "incomeledger" | "severance";

const TAB_KEYS: Tab[] = [
  "connections", "bank", "card", "recon", "vat", "invoice", "journal", "ledger", "trial", "pnl", "cash",
  "hometax", "vatreturn", "fixedassets", "triplog", "budget", "withholding", "balance", "closing",
  "shopreceipt", "expsettle", "incomeledger", "severance",
];

/** 사이드바 소메뉴 = 탭 그룹. 소메뉴 진입 시 첫 탭이 열린다(menu.ts 의 href 와 짝). */
const TAB_GROUPS: Array<{ title: string; tabs: [Tab, string][] }> = [
  { title: "연결 관리", tabs: [["connections", "연결 관리"]] },
  { title: "계좌·카드 원장", tabs: [["bank", "계좌 원장"], ["card", "법인카드 원장"]] },
  { title: "계산서·수금", tabs: [["invoice", "세금계산서"], ["recon", "수금 대조"]] },
  // 부가세 신고(P5) — 카드 매입 집계 + 홈택스 매입·매출 계산서 + 신고서 자동 작성(accounting-expansion §5 P5).
  { title: "부가세 신고", tabs: [["vat", "카드 매입 집계"], ["shopreceipt", "쇼핑몰 전표 수집"], ["hometax", "매입·매출 계산서"], ["vatreturn", "신고서"], ["withholding", "원천세"], ["incomeledger", "소득대장"]] },
  // 전표·장부(P3) — 자동분개 파생 계층. 회계 관리자 전용(설계: accounting-expansion-blueprint §5 P3).
  { title: "전표·장부", tabs: [["journal", "분개장"], ["ledger", "계정별원장"], ["trial", "시산표·백테스트"]] },
  // 손익·자금(P4) + 결산(P9) — 전표 파생 관리 손익·자금수지·재무상태표·연차 마감.
  { title: "손익·자금", tabs: [["pnl", "월별 손익"], ["cash", "자금수지"], ["balance", "재무상태표"], ["closing", "결산"]] },
  // 자산·예산(P6) — 고정자산 상각(전표 연동)·운행기록부·연간 예산(기안 사전검토 연동).
  { title: "자산·예산", tabs: [["fixedassets", "고정자산"], ["triplog", "운행기록부"], ["budget", "예산"]] },
  // 개인카드 경비 정산(FRM-P6, 203)·퇴직 정산(FRM-P5, 207).
  { title: "경비 정산", tabs: [["expsettle", "개인카드 경비 정산"], ["severance", "퇴직 정산"]] },
];
const toTab = (raw: string | null): Tab => (TAB_KEYS.includes(raw as Tab) && raw !== "connections" ? (raw as Tab) : "connections");

interface ConnectionRow {
  id: string;
  kind: "bank" | "card";
  label: string;
  code: string; // 바로빌 은행/카드사 코드 — 로고 매핑 키
  numberMasked: string;
  alias: string | null;
  holderEmployeeId: string | null;
  collectCycle: string;
  barobillStatus: string;
  isActive: boolean;
  lastSyncedAt: string | null;
  txnCount: number;
  firstTxnAt: string | null;
  lastTxnAt: string | null;
}

interface SyncLog {
  syncId: string;
  kind: string;
  targetId: string | null;
  status: string;
  fetched: number;
  inserted: number;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const fmtAmount = (n: number) => n.toLocaleString("ko-KR");
/** 사업자번호 표시 — 000-00-00000 (10자리가 아니면 원문 그대로) */
const fmtCorpNum = (v: string) => {
  const d = String(v ?? "").replace(/[^0-9]/g, "");
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : v;
};
const ymdInput = (d: Date) => d.toISOString().slice(0, 10);
const monthsAgo = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
};
const lastDayOfMonth = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
};

/* ================= 은행·카드사 로고 (public/finance/logos, 공식 파비콘 수집본) ================= */

// 바로빌 지원 전체 기관(로고 등록 카드의 목록용 — 원장 태그 버튼은 등록된 연결만 렌더).
const ALL_BANKS: Array<{ code: string; name: string }> = [
  { code: "KB", name: "국민은행" }, { code: "SHINHAN", name: "신한은행" }, { code: "NH", name: "농협은행" },
  { code: "HANA", name: "하나은행" }, { code: "SC", name: "제일은행" }, { code: "WOORI", name: "우리은행" },
  { code: "IBK", name: "기업은행" }, { code: "KDB", name: "산업은행" }, { code: "KFCC", name: "새마을금고" },
  { code: "CITI", name: "씨티은행" }, { code: "SUHYUP", name: "수협은행" }, { code: "CU", name: "신협은행" },
  { code: "EPOST", name: "우체국" }, { code: "KJBANK", name: "광주은행" }, { code: "JBBANK", name: "전북은행" },
  { code: "DGB", name: "대구은행" }, { code: "BUSANBANK", name: "부산은행" }, { code: "KNBANK", name: "경남은행" },
  { code: "EJEJUBANK", name: "제주은행" }, { code: "KBANK", name: "케이뱅크" }, { code: "TOSS", name: "토스뱅크" },
];
const ALL_CARD_COMPANIES: Array<{ code: string; name: string }> = [
  { code: "BC", name: "비씨카드" }, { code: "HANA", name: "하나카드" }, { code: "HYUNDAI", name: "현대카드" },
  { code: "KB", name: "KB카드" }, { code: "LOTTE", name: "롯데카드" }, { code: "NH", name: "NH카드" },
  { code: "SAMSUNG", name: "삼성카드" }, { code: "SHINHAN", name: "신한카드" }, { code: "WOORI", name: "우리카드" },
  { code: "SUHYUP", name: "수협카드" }, { code: "KJBANK", name: "광주카드" }, { code: "JBBANK", name: "전북카드" },
];

/* ================= YYYYMMDD 자동완성 날짜 입력 (기존 앱 날짜 8자리 관례) ================= */

function DigitDateInput({
  value,
  onChange,
  mode = "ymd",
  className,
}: {
  value: string; // "YYYY-MM-DD" | "YYYY-MM" | ""
  onChange: (v: string) => void;
  mode?: "ymd" | "ym";
  className?: string;
}) {
  const maxDigits = mode === "ymd" ? 8 : 6;
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
      placeholder={mode === "ymd" ? "YYYYMMDD" : "YYYYMM"}
      className={className ?? "cd-input w-full"}
      value={text}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, maxDigits);
        const formatted = format(digits);
        setText(formatted);
        onChange(digits.length === maxDigits ? formatted : "");
      }}
    />
  );
}

/* ================= 원장 공용 검색 필터 (PDF 레이아웃 — 좌측 세로 열) ================= */

interface LedgerFilter {
  from: string; // YYYY-MM-DD ('' = 제한 없음)
  to: string;
  keyword: string;
  amountMin: string;
  amountMax: string;
}

const EMPTY_FILTER: LedgerFilter = { from: "", to: "", keyword: "", amountMin: "", amountMax: "" };

function LedgerFilterColumn({
  keywordPlaceholder,
  onApply,
}: {
  keywordPlaceholder: string;
  onApply: (f: LedgerFilter) => void;
}) {
  const [mode, setMode] = useState<"day" | "month">("day");
  const [draft, setDraft] = useState<LedgerFilter>(EMPTY_FILTER);
  const [fromYm, setFromYm] = useState(""); // 월 단위 모드(YYYY-MM)
  const [toYm, setToYm] = useState("");
  const [preset, setPreset] = useState<number | null>(null);

  const applyPreset = (months: number) => {
    const next = { ...draft, from: ymdInput(monthsAgo(months)), to: ymdInput(new Date()) };
    setPreset(months);
    setMode("day");
    setDraft(next);
    onApply(next);
  };

  const apply = () => {
    setPreset(null);
    if (mode === "month") {
      const next = { ...draft, from: fromYm ? `${fromYm}-01` : "", to: toYm ? lastDayOfMonth(toYm) : "" };
      setDraft(next);
      onApply(next);
    } else {
      onApply(draft);
    }
  };

  const reset = () => {
    setDraft(EMPTY_FILTER);
    setFromYm("");
    setToYm("");
    setPreset(null);
    onApply(EMPTY_FILTER);
  };

  return (
    <div className="flex flex-col gap-2 w-full lg:w-[380px] shrink-0">
      <div className="flex items-center gap-1.5 flex-wrap">
        {[1, 3, 6, 12].map((m) => (
          <button
            key={m}
            type="button"
            className={`cd-chip cd-chip-sm ${preset === m ? "" : "cd-text-muted"}`}
            data-active={preset === m || undefined}
            onClick={() => applyPreset(m)}
          >
            {m === 12 ? "1년" : `${m}개월`}
          </button>
        ))}
        <span className="cd-divider mx-0.5" />
        <button
          type="button"
          className={`cd-chip cd-chip-sm ${mode === "day" ? "" : "cd-text-muted"}`}
          data-active={mode === "day" || undefined}
          onClick={() => setMode("day")}
        >
          일 단위
        </button>
        <button
          type="button"
          className={`cd-chip cd-chip-sm ${mode === "month" ? "" : "cd-text-muted"}`}
          data-active={mode === "month" || undefined}
          onClick={() => setMode("month")}
        >
          월 단위
        </button>
      </div>
      {/* 기간·금액은 [입력 ~ 입력] 형태로 정렬(사용자 확정) */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {mode === "day" ? (
          <>
            <DigitDateInput value={draft.from} onChange={(v) => setDraft((p) => ({ ...p, from: v }))} />
            <span className="cd-text-muted">~</span>
            <DigitDateInput value={draft.to} onChange={(v) => setDraft((p) => ({ ...p, to: v }))} />
          </>
        ) : (
          <>
            <DigitDateInput mode="ym" value={fromYm} onChange={setFromYm} />
            <span className="cd-text-muted">~</span>
            <DigitDateInput mode="ym" value={toYm} onChange={setToYm} />
          </>
        )}
      </div>
      <input
        type="search"
        className="cd-input w-full"
        placeholder={keywordPlaceholder}
        value={draft.keyword}
        onChange={(e) => setDraft((p) => ({ ...p, keyword: e.target.value }))}
        onKeyDown={(e) => e.key === "Enter" && apply()}
      />
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <input
          type="number"
          className="cd-input w-full"
          placeholder="금액 이상"
          value={draft.amountMin}
          onChange={(e) => setDraft((p) => ({ ...p, amountMin: e.target.value }))}
        />
        <span className="cd-text-muted">~</span>
        <input
          type="number"
          className="cd-input w-full"
          placeholder="금액 이하"
          value={draft.amountMax}
          onChange={(e) => setDraft((p) => ({ ...p, amountMax: e.target.value }))}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" onClick={apply}>
          조회
        </button>
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={reset}>
          초기화
        </button>
      </div>
    </div>
  );
}

function filterToParams(f: LedgerFilter, params: URLSearchParams) {
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  if (f.keyword.trim()) params.set("keyword", f.keyword.trim());
  if (f.amountMin !== "" && Number.isFinite(Number(f.amountMin))) params.set("amountMin", f.amountMin);
  if (f.amountMax !== "" && Number.isFinite(Number(f.amountMax))) params.set("amountMax", f.amountMax);
}

export function FinanceBoard() {
  const { theme } = useCdashTheme();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => toTab(searchParams.get("tab")));

  // 사이드바 서브메뉴(/finance?tab=...)로 진입 시 페이지가 리마운트되지 않고 쿼리만 바뀐다
  // → 쿼리 변경을 탭 상태에 동기화(누락 시 서브메뉴 클릭이 무반응으로 보이는 버그).
  useEffect(() => {
    setTab(toTab(searchParams.get("tab")));
  }, [searchParams]);

  // 사이드바 소메뉴 단위로 화면을 나눈다 — 탭은 소메뉴 안에 2개 이상일 때만 쓴다.
  const group = TAB_GROUPS.find((g) => g.tabs.some(([k]) => k === tab)) ?? TAB_GROUPS[0];

  return (
    <div className="cdash cd-fields-white min-h-full p-4 rounded-3xl" data-theme={theme}>
      <div>
        <CdPageHeader title={`재무 · ${group.title}`} />

        {group.tabs.length > 1 && (
          <div className="flex items-center gap-1.5 mb-4 flex-wrap">
            {group.tabs.map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`cd-chip ${tab === k ? "" : "cd-text-muted"}`}
                data-active={tab === k || undefined}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {tab === "connections" && <ConnectionsPanel />}
        {tab === "bank" && <BankLedgerPanel />}
        {tab === "card" && <CardLedgerPanel />}
        {tab === "recon" && <ReconPanel />}
        {tab === "vat" && <VatPanel />}
        {tab === "shopreceipt" && <ReceiptCollectPanel />}
        {tab === "hometax" && <HometaxPanel />}
        {tab === "vatreturn" && <VatReturnPanel />}
        {tab === "withholding" && <WithholdingPanel />}
        {tab === "balance" && <BalanceSheetPanel />}
        {tab === "closing" && <ClosingPanel />}
        {tab === "fixedassets" && <FixedAssetPanel />}
        {tab === "triplog" && <TripLogPanel />}
        {tab === "budget" && <BudgetPanel />}
        {tab === "invoice" && <TaxInvoicePanel />}
        {tab === "journal" && <JournalPanel />}
        {tab === "ledger" && <LedgerPanel />}
        {tab === "trial" && <TrialPanel />}
        {tab === "pnl" && <PnlPanel />}
        {tab === "cash" && <CashPanel />}
        {tab === "expsettle" && <ExpenseSettlementPanel />}
        {tab === "incomeledger" && <IncomeLedgerPanel />}
        {tab === "severance" && <SeverancePanel />}
      </div>
    </div>
  );
}

/* ================= 은행·카드사 로고 등록 카드 (F0 — 사용자 직접 등록/교체) ================= */

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={
        ok
          ? { width: 8, height: 8, background: "#22c55e", boxShadow: "0 0 6px 2px rgba(34,197,94,0.55)" }
          : { width: 8, height: 8, background: "#f59e0b", boxShadow: "0 0 6px 2px rgba(245,158,11,0.55)" }
      }
    />
  );
}


interface ImportSummary {
  profileLabel: string;
  kind: "bank" | "card";
  fileName: string;
  accountHint: string | null;
  period: { from: string | null; to: string | null };
  target: { id: string; label: string; no: string } | null;
  guessed: boolean;
  total: number;
  canceled: number;
  duplicated: number;
  newRows: number;
  inserted: number;
  needTarget?: boolean;
  targets?: { id: string; label: string; no: string }[];
  sample: Record<string, string | number | null>[];
}

/**
 * 계좌·카드내역 엑셀 업로드 — 바로빌이 보유하지 않는 과거분(3개월 이전)을 은행/카드사 엑셀로 채운다.
 * 파일을 고르면 양식을 자동 판별해 미리보기(대상·기간·신규/중복 건수)를 보여주고, 확인 후 적재한다.
 */
function StatementUploadCard({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [targetId, setTargetId] = useState("");
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const send = async (nextFile: File, mode: "preview" | "commit", target: string) => {
    setBusy(mode);
    setError(null);
    try {
      const fd = new FormData();
      fd.set("file", nextFile, nextFile.name);
      fd.set("mode", mode);
      if (target) fd.set("targetId", target);
      const res = await fetch("/api/finance/statements", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "엑셀을 읽지 못했습니다.");
      setSummary(data as ImportSummary);
      if (data.target?.id) setTargetId(String(data.target.id));
      if (mode === "commit") {
        setDone(`${data.inserted}건 적재 완료 (중복 ${data.duplicated}건 건너뜀)`);
        onImported();
      }
      return data as ImportSummary;
    } catch (err) {
      setError((err as Error).message);
      setSummary(null);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const pick = async (next: File | null) => {
    setFile(next);
    setSummary(null);
    setDone(null);
    setTargetId("");
    if (next) await send(next, "preview", "");
  };

  const period = summary?.period.from ? `${summary.period.from} ~ ${summary.period.to ?? ""}` : "기간 미상";

  return (
    <div className="cd-card p-4 min-w-0">
      <div className="cd-card-title mb-1">계좌/카드내역 엑셀 업로드</div>
      <p className="text-xs cd-text-muted mb-3">
        바로빌이 보유하지 않는 과거분(계좌 3개월·카드 2개월 이전)을 은행·카드사에서 내려받은 엑셀로 채웁니다.
        기업은행·국민은행 계좌, 롯데·기업은행 법인카드 양식을 자동 인식하며, 이미 적재된 건은 중복 없이 건너뜁니다.
      </p>

      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => void pick(e.target.files?.[0] ?? null)}
        />
        <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => inputRef.current?.click()} disabled={busy !== null}>
          <Upload className="w-4 h-4" /> {busy === "preview" ? "분석 중..." : "엑셀 선택"}
        </button>
        {file && <span className="text-xs cd-text-muted truncate max-w-[220px]" title={file.name}>{file.name}</span>}
      </div>

      {error && <div className="text-xs cd-error-text mt-2">{error}</div>}
      {done && <div className="text-xs mt-2" style={{ color: "var(--cd-success)" }}>{done}</div>}

      {summary && (
        <div className="mt-3 rounded-xl border cd-border-c p-3 text-xs space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="cd-pill cd-pill-info">{summary.profileLabel}</span>
            <span className="cd-text-muted">{period}</span>
            <span className="cd-text-muted">파일 {summary.total}건</span>
            {summary.canceled > 0 && <span className="cd-text-muted">취소 {summary.canceled}건 제외</span>}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="cd-text-faint shrink-0">적재 대상</span>
            <select
              className="cd-select"
              style={{ width: "auto", minWidth: 200 }}
              value={targetId}
              onChange={(e) => {
                setTargetId(e.target.value);
                if (file && e.target.value) void send(file, "preview", e.target.value);
              }}
            >
              <option value="">선택하세요</option>
              {(summary.targets ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.label} ({t.no})</option>
              ))}
            </select>
            {summary.guessed && summary.target && <span className="cd-pill cd-pill-success">자동 인식</span>}
            {summary.accountHint && <span className="cd-text-faint">파일 번호 {summary.accountHint}</span>}
          </div>

          {targetId && (
            <div className="flex items-center gap-3 flex-wrap">
              <span>
                신규 <b>{summary.newRows}</b>건
              </span>
              <span className="cd-text-muted">중복 {summary.duplicated}건</span>
              <button
                type="button"
                className="cd-btn cd-btn-primary cd-btn-sm ml-auto"
                disabled={busy !== null || summary.newRows === 0}
                onClick={() => file && void send(file, "commit", targetId)}
              >
                {busy === "commit" ? "적재 중..." : `${summary.newRows}건 적재`}
              </button>
            </div>
          )}

          {summary.sample.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="cd-text-muted text-left">
                    {Object.keys(summary.sample[0]).map((k) => (
                      <th key={k} className="py-1 pr-2 font-normal">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summary.sample.map((row, i) => (
                    <tr key={i} className="border-t cd-hairline-row-c">
                      {Object.values(row).map((v, j) => (
                        <td key={j} className="py-1 pr-2 whitespace-nowrap">
                          {typeof v === "number" ? v.toLocaleString("ko-KR") : v ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="cd-text-faint mt-1">위 5건은 파일에서 읽은 내용 미리보기입니다.</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LogoRegistryCard() {
  const [tab, setTab] = useState<"bank" | "card">("bank");
  const [version, setVersion] = useState(1); // 업로드 후 캐시 무효화 + 재검사
  const [registered, setRegistered] = useState<Set<string>>(new Set()); // fileCode 기준
  const [target, setTarget] = useState<{ kind: "bank" | "card"; code: string; name: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 등록 상태 = 서빙 API 가 실제로 이미지를 주는지(업로드본·번들 정적 모두 포함) — 표시 상태와 100% 일치.
  // 로드되는 대로 점진 반영한다(일괄 카운터는 파일코드 중복(광주·전북·수협 = 은행/카드사 공용) 때문에 어긋난다).
  useEffect(() => {
    let alive = true;
    const fileCodes = [
      ...new Set([
        ...ALL_BANKS.map((b) => logoFileCode("bank", b.code)),
        ...ALL_CARD_COMPANIES.map((c) => logoFileCode("card", c.code)),
      ]),
    ];
    setRegistered(new Set());
    for (const fileCode of fileCodes) {
      const img = new Image();
      img.onload = () => {
        if (alive) setRegistered((prev) => new Set(prev).add(fileCode));
      };
      img.src = `/api/finance/logos/img/${fileCode}?v=${version}`;
    }
    return () => {
      alive = false;
    };
  }, [version]);

  const openUpload = (kind: "bank" | "card", code: string, name: string) => {
    setTarget({ kind, code, name });
    setFile(null);
    setPreview(null);
    setError(null);
  };

  const pickFile = (f: File | null) => {
    setFile(f);
    setError(null);
    if (!f) {
      setPreview(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.readAsDataURL(f);
  };

  const upload = async () => {
    if (!target || !file || !preview) return;
    if (file.size > 1024 * 1024) {
      setError("이미지는 1MB 이하여야 합니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/logos/${logoFileCode(target.kind, target.code)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mime: file.type, dataBase64: preview }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "로고 등록에 실패했습니다.");
      setTarget(null);
      setVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const list = tab === "bank" ? ALL_BANKS : ALL_CARD_COMPANIES;

  return (
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="cd-card-title mr-auto">은행·카드사 로고 등록</div>
        {(["bank", "card"] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={`cd-chip cd-chip-sm ${tab === k ? "" : "cd-text-muted"}`}
            data-active={tab === k || undefined}
            onClick={() => setTab(k)}
          >
            {k === "bank" ? "은행" : "카드사"}
          </button>
        ))}
      </div>
      {/* 태그 너비 통일(그리드 균등 분할) — 사용자 확정 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-1.5">
        {list.map((item) => {
          const ok = registered.has(logoFileCode(tab, item.code));
          return (
            <button
              key={item.code}
              type="button"
              onClick={() => openUpload(tab, item.code, item.name)}
              title={ok ? "로고 등록됨 — 클릭해 교체" : "로고 미등록 — 클릭해 등록"}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:cd-tint-primary w-full min-w-0"
              style={{ borderColor: "var(--cd-faint)" }}
            >
              <StatusDot ok={ok} />
              {ok && <FinLogo kind={tab} code={item.code} label={item.name} size={16} version={version} />}
              <span className="truncate">{item.name}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] cd-text-faint">
        <span className="inline-flex items-center gap-1 mr-3"><StatusDot ok /> 등록됨(클릭 시 교체)</span>
        <span className="inline-flex items-center gap-1"><StatusDot ok={false} /> 미등록(클릭 시 등록)</span>
        — PNG·JPG·WebP·SVG, 1MB 이하. 표시 크기는 아이콘 영역에 맞게 자동 조정됩니다.
      </p>

      <CdModal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target ? `${target.name} 로고 ${registered.has(logoFileCode(target.kind, target.code)) ? "교체" : "등록"}` : ""}
        footer={
          <>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setTarget(null)}>
              취소
            </button>
            <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={!file || busy} onClick={upload}>
              {busy ? "등록 중..." : "등록"}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-sm cd-text">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="cd-input w-full"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          {preview && (
            <div className="flex items-center gap-3">
              <span className="cd-text-muted text-xs">미리보기</span>
              {[36, 24, 16].map((s) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={s} src={preview} alt="미리보기" width={s} height={s} className="rounded-full object-contain" style={{ background: "#fff", border: "1px solid var(--cd-border)" }} />
              ))}
            </div>
          )}
          {error && <div className="cd-error-text text-xs">{error}</div>}
          <p className="text-[11px] cd-text-faint">정사각형에 가까운 이미지가 가장 깔끔하게 표시됩니다. 등록 즉시 원장 태그 버튼에 반영됩니다.</p>
        </div>
      </CdModal>
    </div>
  );
}

/* ================= 연결 관리 (F0) ================= */

function ConnectionsPanel() {
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // 액션 진행 중 표시 (id:action)
  const [confirmStop, setConfirmStop] = useState<ConnectionRow | null>(null);
  // 수집 범위 선택 모달 — 증분(기본) / 기간 지정(200일 초과는 서버가 자동 분할)
  const [syncModal, setSyncModal] = useState(false);
  const [syncMode, setSyncMode] = useState<"incremental" | "range">("incremental");
  // 수집 로그는 계좌·카드 수만큼 매번 쌓여 표가 길어진다 — 5행씩 끊어 본다(3개월 지난 로그는 서버에서 정리).
  const [logOffset, setLogOffset] = useState(0);
  const [syncFrom, setSyncFrom] = useState(() => ymdInput(monthsAgo(3)));
  const [syncTo, setSyncTo] = useState(() => ymdInput(new Date()));

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/connections${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "연결 정보를 불러오지 못했습니다.");
      setConnections(data.connections ?? []);
      setLogs(data.logs ?? []);
      setLogOffset(0);
      setStale(Boolean(data.stale));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const action = useCallback(
    async (body: Record<string, unknown>, busyKey: string, confirmMsg?: string) => {
      if (confirmMsg && !window.confirm(confirmMsg)) return;
      setBusy(busyKey);
      setError(null);
      setNotice(null);
      try {
        const res = await fetch("/api/finance/connections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "요청이 실패했습니다.");
        return data;
      } catch (err) {
        setError((err as Error).message);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  // 등록 팝업 — URL 60초 유효라 발급 즉시 새 창으로 연다
  const openRegister = async (kind: "bank" | "card") => {
    const data = await action({ action: "manage-url", kind }, `register:${kind}`);
    if (data?.url) {
      window.open(data.url, "barobill-register", "width=1100,height=800");
    }
  };

  const runSync = async () => {
    setSyncModal(false);
    setBusy("sync");
    setError(null);
    try {
      const body = syncMode === "range" ? { from: syncFrom, to: syncTo } : {};
      const res = await fetch("/api/finance/sync?force=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "수집 실행이 실패했습니다.");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doStop = async () => {
    if (!confirmStop) return;
    const target = confirmStop;
    setConfirmStop(null);
    const ok = await action({ action: "stop", kind: target.kind, id: target.id }, `stop:${target.id}`);
    if (ok) await load();
  };

  const banks = connections.filter((c) => c.kind === "bank");
  const cards = connections.filter((c) => c.kind === "card");

  return (
    <div className="space-y-4">
      {/* 툴바 */}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" onClick={() => openRegister("bank")} disabled={busy !== null}>
          <Plus className="w-4 h-4" /> 계좌 등록
        </button>
        <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" onClick={() => openRegister("card")} disabled={busy !== null}>
          <Plus className="w-4 h-4" /> 카드 등록
        </button>
        <button type="button" className="cd-btn cd-btn-soft cd-btn-sm" onClick={() => setSyncModal(true)} disabled={busy !== null}>
          <Download className="w-4 h-4" /> {busy === "sync" ? "수집 중..." : "지금 수집"}
        </button>
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => load(true)} disabled={loading}>
          <RefreshCw className="w-4 h-4" /> 새로고침
        </button>
        {stale && (
          <span className="cd-pill cd-pill-warn">마지막 수집이 오래됨 — 백그라운드 수집 시작됨</span>
        )}
      </div>

      {error && <div className="cd-card p-3 cd-error-text text-sm">{error}</div>}
      {notice && (
        <div className="cd-card p-3 text-sm" style={{ color: "var(--cd-success)" }}>{notice}</div>
      )}

      {/* 등록 안내 */}
      <div className="text-xs cd-text-muted">
        등록 버튼을 누르면 바로빌 등록 창이 새 창으로 열립니다(발급 URL 60초 유효 — 만료 시 다시 클릭).
        계좌·카드 자격증명은 바로빌에만 저장되며, 은행 빠른조회(신한=간편조회·우리=스피드조회) 선가입이 필요합니다.
        카드 수집대상은 <b>매입내역</b>, 수집주기는 <b>1일</b>로 선택하세요.
      </div>

      {/* 위: 계좌·법인카드 목록(전체 폭) / 아래: 로고 등록 + 수집 로그 가로 2단 — 폭 합이 위와 일치한다 */}
      <div className="space-y-4">
        <div className="space-y-4 min-w-0">
          <ConnectionTable
            title="계좌"
            icon={<Landmark className="w-4 h-4" />}
            rows={banks}
            busy={busy}
            onStop={setConfirmStop}
            onResume={async (row, kind) => {
              const ok = await action({ action: kind, kind: row.kind, id: row.id }, `${kind}:${row.id}`);
              if (ok) await load();
            }}
          />
          <ConnectionTable
            title="법인카드"
            icon={<CreditCard className="w-4 h-4" />}
            rows={cards}
            busy={busy}
            onStop={setConfirmStop}
            onResume={async (row, kind) => {
              const ok = await action({ action: kind, kind: row.kind, id: row.id }, `${kind}:${row.id}`);
              if (ok) await load();
            }}
            onRefreshNow={async (row) => {
              const data = await action({ action: "refresh-now", kind: "card", id: row.id }, `refresh:${row.id}`);
              if (data?.alreadyRunning) {
                setError("바로빌에서 이미 수집이 진행 중입니다. 잠시 후 '지금 수집'으로 가져오세요.");
              } else if (data?.ok) {
                // 운영은 접수번호로 보이는 양수(실측 303)를 준다 — 오류가 아니므로 접수 안내로 표시한다.
                setNotice(
                  data.code && data.code !== "1"
                    ? `수집을 요청했습니다(바로빌 응답 ${data.code}${data.note ? ` — ${data.note}` : ""}). 반영까지 수 분 걸립니다.`
                    : "수집을 요청했습니다. 반영까지 수 분 걸립니다.",
                );
              }
            }}
          />
        </div>

        <div className="grid gap-4 items-start xl:grid-cols-2 min-w-0">
        {/* 은행·카드사 로고 등록 + 계좌/카드내역 엑셀 업로드 (같은 컬럼 = 같은 너비) */}
        <div className="space-y-4 min-w-0">
          <LogoRegistryCard />
          <StatementUploadCard onImported={() => load(true)} />
        </div>

        {/* 수집 로그 */}
        <div className="cd-card p-4 min-w-0">
          <div className="cd-card-title mb-3">최근 수집 로그</div>
          {logs.length === 0 ? (
            <div className="text-sm cd-text-muted">수집 이력이 없습니다.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="cd-text-muted text-left">
                    <th className="py-1.5 pr-3 font-normal">시작</th>
                    <th className="py-1.5 pr-3 font-normal">종류</th>
                    <th className="py-1.5 pr-3 font-normal">상태</th>
                    <th className="py-1.5 pr-3 font-normal text-right">조회</th>
                    <th className="py-1.5 pr-3 font-normal text-right">신규</th>
                    <th className="py-1.5 font-normal">오류</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.slice(logOffset, logOffset + LOG_PAGE_SIZE).map((l) => (
                    <tr key={l.syncId} className="border-t cd-hairline-row-c">
                      <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{l.startedAt}</td>
                      <td className="py-1.5 pr-3">{l.kind === "bank" ? "계좌" : l.kind === "card" ? "카드" : l.kind}</td>
                      <td className="py-1.5 pr-3">
                        <span className={`cd-pill ${l.status === "ok" ? "cd-pill-success" : l.status === "error" ? "cd-pill-error" : "cd-pill-idle"}`}>
                          {l.status === "ok" ? "성공" : l.status === "error" ? "실패" : "진행중"}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-right">{l.fetched}</td>
                      <td className="py-1.5 pr-3 text-right">{l.inserted}</td>
                      <td className="py-1.5 text-xs cd-text-muted max-w-[160px] truncate" title={l.error ?? ""}>{l.error ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2">
                <PaginationControls
                  total={logs.length}
                  limit={LOG_PAGE_SIZE}
                  offset={logOffset}
                  loading={loading}
                  onPageChange={setLogOffset}
                />
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* 수집 범위 선택 모달 */}
      <CdModal
        open={syncModal}
        onClose={() => setSyncModal(false)}
        title="지금 수집"
        footer={
          <>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setSyncModal(false)}>
              취소
            </button>
            <button
              type="button"
              className="cd-btn cd-btn-primary cd-btn-sm"
              disabled={syncMode === "range" && (!syncFrom || !syncTo || syncFrom > syncTo)}
              onClick={runSync}
            >
              수집 실행
            </button>
          </>
        }
      >
        <div className="text-sm cd-text space-y-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="radio" className="mt-0.5" checked={syncMode === "incremental"} onChange={() => setSyncMode("incremental")} />
            <span>
              <b>증분 수집</b>
              <span className="block text-xs cd-text-muted">마지막 적재분 이후만 가져옵니다(권장 — 매일 상태에서 가장 빠름).</span>
            </span>
          </label>
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="radio" className="mt-0.5" checked={syncMode === "range"} onChange={() => setSyncMode("range")} />
            <span>
              <b>기간 지정 수집</b>
              <span className="block text-xs cd-text-muted">
                지정 기간을 다시 가져옵니다(누락 의심 구간 재수집). 200일 초과 기간은 자동 분할 조회되며, 이미 적재된 건은 중복 없이 건너뜁니다.
                <b className="block mt-1">
                  단, 바로빌이 보유한 원장은 최근 3개월(계좌)·2개월+(카드)뿐이라 그보다 과거는 기간을 넓혀도 수집되지 않습니다.
                </b>
              </span>
            </span>
          </label>
          {syncMode === "range" && (
            <div className="flex items-center gap-2 pl-6">
              <input type="date" className="cd-input" value={syncFrom} onChange={(e) => setSyncFrom(e.target.value)} />
              <span className="cd-text-muted">~</span>
              <input type="date" className="cd-input" value={syncTo} onChange={(e) => setSyncTo(e.target.value)} />
            </div>
          )}
          <p className="text-[11px] cd-text-faint">
            ※ 바로빌이 보관 중인 범위 안에서만 조회됩니다(등록 시점 소급: 계좌 3개월·카드 약 2개월). 그 이전 과거분이 필요하면 바로빌에 별도 문의가 필요합니다.
          </p>
        </div>
      </CdModal>

      {/* 해지 확인 모달 */}
      <CdModal
        open={confirmStop !== null}
        onClose={() => setConfirmStop(null)}
        title="연결 해지"
        footer={
          <>
            <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={() => setConfirmStop(null)}>
              취소
            </button>
            <button type="button" className="cd-btn cd-btn-danger cd-btn-sm" onClick={doStop}>
              해지
            </button>
          </>
        }
      >
        {confirmStop && (
          <div className="text-sm cd-text space-y-2">
            <p>
              <b>{confirmStop.label} {confirmStop.numberMasked}</b> 의 바로빌 수집을 해지합니다.
            </p>
            <ul className="list-disc pl-5 cd-text-muted text-xs space-y-1">
              <li>해지 당월 요금은 환불되지 않으며, 당월 말까지는 계속 수집됩니다(익월부터 중단).</li>
              <li>해지 취소는 해지 당월에만 가능합니다.</li>
              <li>기존에 수집된 원장 데이터는 보존됩니다.</li>
            </ul>
          </div>
        )}
      </CdModal>
    </div>
  );
}

function ConnectionTable({
  title,
  icon,
  rows,
  busy,
  onStop,
  onResume,
  onRefreshNow,
}: {
  title: string;
  icon: React.ReactNode;
  rows: ConnectionRow[];
  busy: string | null;
  onStop: (row: ConnectionRow) => void;
  onResume: (row: ConnectionRow, action: "cancel-stop" | "re-regist") => void;
  onRefreshNow?: (row: ConnectionRow) => void;
}) {
  return (
    <div className="cd-card p-4">
      <div className="cd-card-title mb-3 flex items-center gap-1.5">
        {icon} {title}
        <span className="cd-text-muted font-normal text-xs ml-1">{rows.length}건</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-sm cd-text-muted">등록된 {title}이(가) 없습니다. 상단의 등록 버튼으로 추가하세요.</div>
      ) : (
        <div className="overflow-x-auto">
          {/* 계좌·법인카드 두 표의 열 너비를 일치시키기 위한 공통 colgroup(table-fixed) — 사용자 요청 */}
          <table className="w-full text-sm table-fixed min-w-[560px]">
            <colgroup>
              <col className="w-[12%]" />
              <col className="w-[19%]" />
              <col className="w-[7%]" />
              <col className="w-[8%]" />
              <col className="w-[10%]" />
              <col className="w-[9%]" />
              <col className="w-[16%]" />
              <col className="w-[19%]" />
            </colgroup>
            <thead>
              <tr className="cd-text-muted text-left">
                <th className="py-1.5 pr-3 font-normal">{title === "계좌" ? "은행" : "카드사"}</th>
                <th className="py-1.5 pr-3 font-normal">번호</th>
                <th className="py-1.5 pr-3 font-normal">별칭</th>
                <th className="py-1.5 pr-3 font-normal">주기</th>
                <th className="py-1.5 pr-3 font-normal">상태</th>
                <th className="py-1.5 pr-3 font-normal text-right">적재 건수</th>
                <th className="py-1.5 pr-3 font-normal">수집 데이터 기간</th>
                <th className="py-1.5 font-normal">작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t cd-hairline-row-c">
                  <td className="py-2 pr-3 truncate">{row.label}</td>
                  <td className="py-2 pr-3 truncate font-mono text-xs" title={row.numberMasked}>{row.numberMasked}</td>
                  <td className="py-2 pr-3">{row.alias ?? <span className="cd-text-muted">—</span>}</td>
                  <td className="py-2 pr-3">{row.collectCycle}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={`cd-pill ${row.barobillStatus === "active" ? "cd-pill-success" : row.barobillStatus === "unlinked" ? "cd-pill-warn" : "cd-pill-idle"}`}
                      title={row.barobillStatus === "unlinked" ? "바로빌 계정에 이 연결이 없습니다(운영 전환·해지 후 잔존). 적재된 원장은 보존되며, 같은 번호로 다시 등록하면 이어집니다." : undefined}
                    >
                      {row.barobillStatus === "active" ? "수집중" : row.barobillStatus === "unlinked" ? "바로빌 미등록" : "해지됨"}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right">{row.txnCount.toLocaleString()}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-xs cd-text-muted" title="현재 적재된 데이터의 최초~최근 거래일">
                    {row.firstTxnAt && row.lastTxnAt ? `${row.firstTxnAt.slice(2, 10)} ~ ${row.lastTxnAt.slice(2, 10)}` : "—"}
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {row.barobillStatus === "active" ? (
                        <>
                          {onRefreshNow && (
                            <button
                              type="button"
                              className="cd-btn cd-btn-soft cd-btn-sm"
                              title="바로빌에 즉시 수집 요청"
                              disabled={busy !== null}
                              onClick={() => onRefreshNow(row)}
                            >
                              <RefreshCw className="w-3.5 h-3.5" /> 즉시 수집
                            </button>
                          )}
                          <button
                            type="button"
                            className="cd-btn cd-btn-ghost cd-btn-sm cd-error-text"
                            disabled={busy !== null}
                            onClick={() => onStop(row)}
                          >
                            <StopCircle className="w-3.5 h-3.5" /> 해지
                          </button>
                        </>
                      ) : row.barobillStatus === "unlinked" ? (
                        <span className="text-xs cd-text-muted">바로빌에서 등록하면 자동으로 다시 연결됩니다</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="cd-btn cd-btn-soft cd-btn-sm"
                            title="해지 당월에만 가능"
                            disabled={busy !== null}
                            onClick={() => onResume(row, "cancel-stop")}
                          >
                            <Undo2 className="w-3.5 h-3.5" /> 해지 취소
                          </button>
                          <button
                            type="button"
                            className="cd-btn cd-btn-soft cd-btn-sm"
                            title="해지 월 경과 후 재신청(과금 재개)"
                            disabled={busy !== null}
                            onClick={() => onResume(row, "re-regist")}
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> 재등록
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ================= 계좌 원장 ================= */

interface BankTxn {
  txnId: string;
  accountLabel: string;
  txnAt: string;
  direction: string;
  amount: number;
  balanceAfter: number | null;
  remitterRaw: string | null;
  transType: string | null;
  remark2: string | null;
  reconStatus: string;
}

// 원장 패널이 공유하는 등록 연결 요약 로더 (등록 계좌/카드 태그용)
function useConnectionList() {
  const [connections, setConnections] = useState<ConnectionRow[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/finance/connections", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (alive) setConnections(data.connections ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return connections;
}

function BankLedgerPanel() {
  const connections = useConnectionList();
  const bankAccounts = useMemo(() => connections.filter((c) => c.kind === "bank"), [connections]);
  // 은행 태그는 단일 선택(상호배타) — 하나를 켜면 나머지는 꺼진다(사용자 확정)
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [rows, setRows] = useState<BankTxn[]>([]);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<{ deposit: number; withdraw: number }>({ deposit: 0, withdraw: 0 });
  const [page, setPage] = useState(0);
  const [direction, setDirection] = useState<"" | "in" | "out">("");
  const [filter, setFilter] = useState<LedgerFilter>(EMPTY_FILTER);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 50;

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ kind: "bank", limit: String(limit), offset: String(page * limit) });
        if (direction) params.set("direction", direction);
        if (selectedAccount) params.set("accountId", selectedAccount);
        filterToParams(filter, params);
        const res = await fetch(`/api/finance/transactions?${params}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "원장을 불러오지 못했습니다.");
        if (!alive) return;
        setRows(data.rows ?? []);
        setTotal(data.total ?? 0);
        setTotals(data.totals ?? { deposit: 0, withdraw: 0 });
      } catch (err) {
        if (alive) setError((err as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [page, direction, filter, selectedAccount]);

  const toggleAccount = (id: string) => {
    setSelectedAccount((prev) => (prev === id ? null : id));
    setPage(0);
  };

  return (
    <div className="space-y-4">
      {/* 필터(좌) + 등록 계좌 태그(우) — PDF 컨셉 레이아웃 */}
      <div className="cd-card p-4">
        <div className="flex flex-col lg:flex-row gap-6">
          <LedgerFilterColumn
            keywordPlaceholder="거래상대·메모·거래종류 검색"
            onApply={(f) => {
              setFilter(f);
              setPage(0);
            }}
          />
          <div className="min-w-0 flex-1">
            <div className="cd-label text-xs mb-2">등록 계좌</div>
            {/* 태그 폭 30% 축소(max-w) + 미선택 테두리 선명화(cd-faint) — 사용자 확정 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2 max-w-[700px]">
              {bankAccounts.map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => toggleAccount(acc.id)}
                  className="flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-sm text-left transition-colors"
                  style={
                    selectedAccount === acc.id
                      ? { borderColor: "var(--cd-primary)", background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }
                      : { borderColor: "var(--cd-faint)" }
                  }
                >
                  <FinLogo kind="bank" code={acc.code} label={acc.label} size={30} />
                  <span className="truncate font-medium">{acc.alias || acc.label}</span>
                </button>
              ))}
              {bankAccounts.length === 0 && <span className="text-sm cd-text-muted col-span-full">등록된 계좌가 없습니다.</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="cd-card p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="cd-card-title mr-auto">계좌 입출금 원장</div>
        {([["", "전체"], ["in", "입금"], ["out", "출금"]] as ["" | "in" | "out", string][]).map(([k, label]) => (
          <button
            key={k || "all"}
            type="button"
            className={`cd-chip cd-chip-sm ${direction === k ? "" : "cd-text-muted"}`}
            data-active={direction === k || undefined}
            onClick={() => {
              setDirection(k);
              setPage(0);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {/* 필터(기간·키워드·금액대) 기준 입금/출금 총계 — 입금만/출금만 칩과 무관하게 둘 다 표시 */}
      <div className="flex items-center gap-4 mb-3 text-sm flex-wrap">
        <span>
          <span className="cd-text-muted mr-1.5">입금 총계</span>
          <b style={{ color: "var(--cd-success)" }}>{fmtAmount(totals.deposit)}원</b>
        </span>
        <span>
          <span className="cd-text-muted mr-1.5">출금 총계</span>
          <b style={{ color: "var(--cd-error)" }}>{fmtAmount(totals.withdraw)}원</b>
        </span>
        <span className="text-xs cd-text-faint">{filter.from || filter.to ? `${filter.from || "…"} ~ ${filter.to || "…"} 기준` : "전체 기간 기준"}</span>
      </div>
      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="cd-text-muted text-left">
              <th className="py-1.5 pr-3 font-normal">일시</th>
              <th className="py-1.5 pr-3 font-normal">계좌</th>
              <th className="py-1.5 pr-3 font-normal">구분</th>
              <th className="py-1.5 pr-3 font-normal text-right">금액</th>
              <th className="py-1.5 pr-3 font-normal">거래상대(원문)</th>
              <th className="py-1.5 pr-3 font-normal">거래종류</th>
              <th className="py-1.5 font-normal">메모</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.txnId} className="border-t cd-hairline-row-c">
                <td className="py-1.5 pr-3 whitespace-nowrap text-xs">{r.txnAt}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{r.accountLabel}</td>
                <td className="py-1.5 pr-3">
                  <span className={`cd-pill ${r.direction === "in" ? "cd-pill-success" : r.direction === "out" ? "cd-pill-error" : "cd-pill-idle"}`}>
                    {r.direction === "in" ? "입금" : r.direction === "out" ? "출금" : "기타"}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-right font-medium whitespace-nowrap">{fmtAmount(r.amount)}</td>
                <td className="py-1.5 pr-3">{r.remitterRaw ?? ""}</td>
                <td className="py-1.5 pr-3 text-xs cd-text-muted">{r.transType ?? ""}</td>
                <td className="py-1.5 text-xs cd-text-muted max-w-[200px] truncate" title={r.remark2 ?? ""}>{r.remark2 ?? ""}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center cd-text-muted text-sm">거래 내역이 없습니다. 연결 관리에서 계좌를 등록하고 수집하세요.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={total} limit={limit} onPage={setPage} />
      </div>
    </div>
  );
}

/* ================= 법인카드 원장 ================= */

interface CardTxn {
  cardTxnId: string;
  cardLabel: string;
  approvedAt: string;
  approvalType: string;
  amountTotal: number;
  supplyAmount: number | null;
  taxAmount: number | null;
  storeName: string | null;
  storeBizType: string | null;
  storeCorpNum: string | null;
  isPurchased: boolean;
  categoryKey: string | null;
  categorySource: string | null;
  vatDeductible: number | null;
  excluded: boolean;
  docId: string | null;
}

function CardLedgerPanel() {
  const connections = useConnectionList();
  const cards = useMemo(() => connections.filter((c) => c.kind === "card"), [connections]);
  // 등록 카드의 카드사만(유니크, 등록 순) — API 미등록 카드사는 표시하지 않는다(사용자 확정)
  const cardCompanies = useMemo(() => {
    const seen = new Map<string, string>(); // code → label
    for (const c of cards) if (c.code && !seen.has(c.code)) seen.set(c.code, c.label);
    return [...seen.entries()].map(([code, label]) => ({ code, label }));
  }, [cards]);
  // 카드사 태그는 단일 선택(상호배타). 선택된 카드사의 등록 카드만 하단에 노출하고, 카드는 다중 선택 가능.
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const companyCards = useMemo(
    () => (selectedCompany ? cards.filter((c) => c.code === selectedCompany) : []),
    [cards, selectedCompany],
  );
  const [rows, setRows] = useState<CardTxn[]>([]);
  const [total, setTotal] = useState(0);
  const [cardTotals, setCardTotals] = useState({ count: 0, amountTotal: 0, supplyAmount: 0, taxAmount: 0 });
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<LedgerFilter>(EMPTY_FILTER);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // P2 분류 편집
  const [categories, setCategories] = useState<Array<{ key: string; label: string }>>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkKey, setBulkKey] = useState("");
  const [ruleTarget, setRuleTarget] = useState<CardTxn | null>(null); // 가맹점 고정 규칙 모달 대상
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const limit = 50;

  useEffect(() => {
    const today = ymdInput(new Date());
    fetch(`/api/finance/vat?from=${ymdInput(monthsAgo(3))}&to=${today}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCategories(d.categories ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ kind: "card", limit: String(limit), offset: String(page * limit) });
        // 카드 개별 선택이 있으면 그 카드들, 없으면 선택된 카드사의 전체 카드로 조회
        const scopeIds = selectedCards.size ? [...selectedCards] : companyCards.map((c) => c.id);
        if (scopeIds.length) params.set("cardIds", scopeIds.join(","));
        filterToParams(filter, params);
        const res = await fetch(`/api/finance/transactions?${params}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "원장을 불러오지 못했습니다.");
        if (!alive) return;
        setRows(data.rows ?? []);
        setTotal(data.total ?? 0);
        setCardTotals(data.totals ?? { count: 0, amountTotal: 0, supplyAmount: 0, taxAmount: 0 });
        setChecked(new Set());
      } catch (err) {
        if (alive) setError((err as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [page, filter, selectedCards, companyCards, reloadKey]);

  const callVat = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/finance/vat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "요청이 실패했습니다.");
      setReloadKey((k) => k + 1);
      return data;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const setRowCategory = (cardTxnId: string, categoryKey: string) => {
    // 낙관적 반영 후 서버 확정(학습 사전에도 반영된다)
    setRows((prev) => prev.map((r) => (r.cardTxnId === cardTxnId ? { ...r, categoryKey: categoryKey || null, categorySource: "manual" } : r)));
    void callVat({ action: "update", cardTxnId, categoryKey: categoryKey || null });
  };

  const toggleCard = (id: string) => {
    setSelectedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPage(0);
  };

  // 카드사 태그 = 단일 선택. 바꾸면 개별 카드 선택은 초기화(다른 카드사 카드가 남지 않도록).
  const toggleCompany = (code: string) => {
    setSelectedCompany((prev) => (prev === code ? null : code));
    setSelectedCards(new Set());
    setPage(0);
  };

  const last4 = (masked: string) => masked.replace(/[^0-9]/g, "").slice(-4);

  return (
    <div className="space-y-4">
      {/* 필터(좌) + 등록 카드 태그(우: 카드사 5열 1행 + 카드 7열 3행, 우측 끝 일치) */}
      <div className="cd-card p-4">
        <div className="flex flex-col lg:flex-row gap-6">
          <LedgerFilterColumn
            keywordPlaceholder="상호·업태 검색"
            onApply={(f) => {
              setFilter(f);
              setPage(0);
            }}
          />
          <div className="min-w-0 flex-1">
            <div className="cd-label text-xs mb-2">등록 카드</div>
            {/* 카드사 5열·카드 7열이 같은 max-w 컨테이너를 공유 → 우측 끝 일치 + 태그 폭 30% 축소 */}
            <div className="max-w-[700px]">
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2 mb-2">
                {cardCompanies.map((company) => (
                  <button
                    key={company.code}
                    type="button"
                    onClick={() => toggleCompany(company.code)}
                    className="flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-sm text-left transition-colors"
                    style={
                      selectedCompany === company.code
                        ? { borderColor: "var(--cd-primary)", background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }
                        : { borderColor: "var(--cd-faint)" }
                    }
                  >
                    <FinLogo kind="card" code={company.code} label={company.label} size={30} />
                    <span className="truncate font-medium">{company.label}</span>
                  </button>
                ))}
                {cardCompanies.length === 0 && <span className="text-sm cd-text-muted col-span-full">등록된 카드가 없습니다.</span>}
              </div>
              {/* 카드 태그는 카드사를 선택했을 때만, 해당 카드사 것만 노출(사용자 확정) */}
              <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-7 gap-2">
                {companyCards.map((card) => (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => toggleCard(card.id)}
                    className="rounded-full border px-2 py-1.5 text-xs text-center truncate transition-colors"
                    title={`${card.label} ${card.numberMasked}`}
                    style={
                      selectedCards.has(card.id)
                        ? { borderColor: "var(--cd-primary)", background: "var(--cd-primary-soft)", color: "var(--cd-primary)" }
                        : { borderColor: "var(--cd-faint)" }
                    }
                  >
                    {(card.alias || card.label) + " " + last4(card.numberMasked)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="cd-card p-4">
      <div className="cd-card-title mb-2">법인카드 매입 원장</div>
      {/* 선택된 카드·필터 기준 요약 — 취소 건은 금액을 왜곡하므로 승인 건만 합산 */}
      <div className="flex items-center gap-4 mb-3 text-sm flex-wrap">
        <span>
          <span className="cd-text-muted mr-1.5">총 건수</span>
          <b>{cardTotals.count.toLocaleString()}건</b>
        </span>
        <span>
          <span className="cd-text-muted mr-1.5">합계금액</span>
          <b>{fmtAmount(cardTotals.amountTotal)}원</b>
        </span>
        <span>
          <span className="cd-text-muted mr-1.5">공급가액</span>
          <b>{fmtAmount(cardTotals.supplyAmount)}원</b>
        </span>
        <span>
          <span className="cd-text-muted mr-1.5">부가세</span>
          <b style={{ color: "var(--cd-primary)" }}>{fmtAmount(cardTotals.taxAmount)}원</b>
        </span>
        <span className="text-xs cd-text-faint">
          {selectedCompany ? (selectedCards.size ? `선택 카드 ${selectedCards.size}장` : "카드사 전체") : "등록 카드 전체"} ·{" "}
          {filter.from || filter.to ? `${filter.from || "…"} ~ ${filter.to || "…"}` : "전체 기간"} · 승인 건 기준
        </span>
      </div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {/* P2 — 계정과목 일괄 지정 / 자동분류 재실행 (.cd-select 은 width:100% 라 폭을 명시해야 한 행에 들어온다) */}
        <select className="cd-select flex-none" style={{ width: 180 }} value={bulkKey} onChange={(e) => setBulkKey(e.target.value)}>
          <option value="">계정과목 일괄 지정…</option>
          {categories.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="cd-btn cd-btn-soft cd-btn-sm flex-none"
          disabled={busy || !bulkKey || checked.size === 0}
          onClick={() => callVat({ action: "bulk-assign", cardTxnIds: [...checked], categoryKey: bulkKey })}
        >
          선택 {checked.size}건 지정
        </button>
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm flex-none" disabled={busy} onClick={() => callVat({ action: "auto-classify" })}>
          <RefreshCw className="w-3.5 h-3.5" /> 자동분류 재실행
        </button>
      </div>
      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="cd-text-muted text-left">
              <th className="py-1.5 pr-2 font-normal w-8">
                <input
                  type="checkbox"
                  checked={rows.length > 0 && checked.size === rows.length}
                  onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((r) => r.cardTxnId)) : new Set())}
                />
              </th>
              <th className="py-1.5 pr-3 font-normal">승인일시</th>
              <th className="py-1.5 pr-3 font-normal">카드</th>
              <th className="py-1.5 pr-3 font-normal text-right">금액</th>
              <th className="py-1.5 pr-3 font-normal text-right">부가세</th>
              <th className="py-1.5 pr-3 font-normal">상호</th>
              <th className="py-1.5 pr-3 font-normal">업태</th>
              <th className="py-1.5 pr-3 font-normal">계정과목</th>
              <th className="py-1.5 font-normal">공제</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cardTxnId} className="border-t cd-hairline-row-c">
                <td className="py-1.5 pr-2">
                  <input
                    type="checkbox"
                    checked={checked.has(r.cardTxnId)}
                    onChange={() =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (next.has(r.cardTxnId)) next.delete(r.cardTxnId);
                        else next.add(r.cardTxnId);
                        return next;
                      })
                    }
                  />
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap text-xs">
                  {r.approvedAt}
                  {r.approvalType !== "승인" && <span className="ml-1 cd-pill cd-pill-error">{r.approvalType}</span>}
                </td>
                <td className="py-1.5 pr-3 whitespace-nowrap">{r.cardLabel}</td>
                <td className="py-1.5 pr-3 text-right font-medium whitespace-nowrap">{fmtAmount(r.amountTotal)}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap cd-text-muted">{r.taxAmount != null ? fmtAmount(r.taxAmount) : ""}</td>
                <td className="py-1.5 pr-3 max-w-[200px] truncate" title={r.storeName ?? ""}>
                  {r.storeName ?? ""}
                  {r.docId && <span className="ml-1 text-[10px] cd-text-faint">결의서</span>}
                </td>
                <td className="py-1.5 pr-3 text-xs cd-text-muted">{r.storeBizType ?? ""}</td>
                <td className="py-1.5 pr-3">
                  <div className="flex items-center gap-1">
                    <select
                      className="cd-select text-xs flex-1 min-w-0"
                      value={r.categoryKey ?? ""}
                      disabled={busy}
                      onChange={(e) => setRowCategory(r.cardTxnId, e.target.value)}
                      title={r.categorySource ? `분류 근거: ${CATEGORY_SOURCE_LABEL[r.categorySource] ?? r.categorySource}` : "미분류"}
                    >
                      <option value="">미분류</option>
                      {categories.map((c) => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
                    </select>
                    {/* 가맹점 고정 — 이 매입처의 지출이 항상 같은 용도일 때만 사용자가 판단해 일괄 적용 */}
                    <button
                      type="button"
                      className="cd-btn cd-btn-ghost cd-btn-sm flex-none px-1.5"
                      title="이 가맹점 전체에 이 계정과목 적용"
                      disabled={busy || !r.categoryKey}
                      onClick={() => setRuleTarget(r)}
                    >
                      <Store className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
                <td className="py-1.5">
                  <span className={`cd-pill ${(r.vatDeductible ?? 1) === 1 ? "cd-pill-success" : "cd-pill-warn"}`}>
                    {(r.vatDeductible ?? 1) === 1 ? "공제" : "불공제"}
                  </span>
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-6 text-center cd-text-muted text-sm">매입 내역이 없습니다. 연결 관리에서 카드를 등록하고 수집하세요.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={total} limit={limit} onPage={setPage} />
      </div>

      <StoreRuleModal
        txn={ruleTarget}
        categories={categories}
        onClose={() => setRuleTarget(null)}
        onSaved={() => {
          setRuleTarget(null);
          setReloadKey((k) => k + 1);
        }}
      />
    </div>
  );
}

/* ================= 가맹점 계정과목 고정 규칙 (마이그 173) ================= */

const CATEGORY_SOURCE_LABEL: Record<string, string> = {
  store_rule: "가맹점 고정 규칙",
  learned: "학습 사전",
  keyword: "상호 키워드",
  rule: "업태 규칙",
  manual: "수동 지정",
};

interface StoreRulePreview {
  matchType: "corp_num" | "store_name";
  matchValue: string;
  storeName: string | null;
  storeBizType: string | null;
  storeCorpNum: string | null;
  total: number;
  applicable: number;
  lockedByDoc: number;
  isPg: boolean;
  distinctStores: number;
  breakdown: Array<{ categoryKey: string | null; label: string; count: number }>;
  existingCategoryKey: string | null;
}

/**
 * "이 가맹점은 항상 이 계정과목" 고정 규칙 생성 모달.
 * 전자상거래·PG 경유 결제는 건마다 용도가 달라 일괄 적용이 위험하므로 경고 + 별도 확인을 받는다.
 */
function StoreRuleModal({
  txn,
  categories,
  onClose,
  onSaved,
}: {
  txn: CardTxn | null;
  categories: Array<{ key: string; label: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [matchType, setMatchType] = useState<"corp_num" | "store_name">("corp_num");
  const [categoryKey, setCategoryKey] = useState("");
  const [preview, setPreview] = useState<StoreRulePreview | null>(null);
  const [ack, setAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!txn) return;
    setMatchType(txn.storeCorpNum ? "corp_num" : "store_name");
    setCategoryKey(txn.categoryKey ?? "");
    setAck(false);
    setError(null);
    setPreview(null);
  }, [txn]);

  useEffect(() => {
    if (!txn) return;
    let alive = true;
    setError(null);
    fetch("/api/finance/store-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preview", cardTxnId: txn.cardTxnId, matchType }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error ?? "영향 범위를 확인하지 못했습니다.");
        if (alive) setPreview(d);
      })
      .catch((e) => {
        if (alive) {
          setPreview(null);
          setError((e as Error).message);
        }
      });
    return () => {
      alive = false;
    };
  }, [txn, matchType]);

  // 일괄 적용을 말려야 하는 신호: PG 업태이거나, 같은 사업자번호 아래 상호가 여러 개(=전자상거래 중개)
  const risky = Boolean(preview && matchType === "corp_num" && (preview.isPg || preview.distinctStores > 1));

  const save = async () => {
    if (!preview || !categoryKey) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/finance/store-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          matchType,
          matchValue: preview.matchValue,
          categoryKey,
          storeName: preview.storeName,
          storeBizType: preview.storeBizType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "규칙을 저장하지 못했습니다.");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CdModal
      open={txn !== null}
      onClose={onClose}
      title="가맹점 계정과목 고정"
      footer={
        <>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="cd-btn cd-btn-primary cd-btn-sm"
            disabled={busy || !preview || !categoryKey || (risky && !ack)}
            onClick={save}
          >
            규칙 저장 + {preview?.applicable ?? 0}건 적용
          </button>
        </>
      }
    >
      <div className="text-sm cd-text space-y-3">
        <div className="rounded-xl border cd-border-c p-3">
          <div className="font-medium">{txn?.storeName || "(상호 없음)"}</div>
          <div className="text-xs cd-text-muted mt-0.5">
            사업자번호 {txn?.storeCorpNum || "—"} · 업태 {txn?.storeBizType || "—"}
          </div>
        </div>

        <div>
          <div className="cd-label text-xs mb-1">적용 기준</div>
          <div className="space-y-1.5">
            <label className={`flex items-start gap-2 ${txn?.storeCorpNum ? "cursor-pointer" : "opacity-50"}`}>
              <input
                type="radio"
                className="mt-0.5"
                checked={matchType === "corp_num"}
                disabled={!txn?.storeCorpNum}
                onChange={() => setMatchType("corp_num")}
              />
              <span>
                <b>가맹점 사업자번호</b>
                <span className="block text-xs cd-text-muted">같은 사업자번호로 결제된 모든 건에 적용(일반적인 경우).</span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="radio" className="mt-0.5" checked={matchType === "store_name"} onChange={() => setMatchType("store_name")} />
              <span>
                <b>상호</b>
                <span className="block text-xs cd-text-muted">
                  PG 경유 결제라 사업자번호가 결제대행사인 경우(예: 이니시스·NHN) — 상호가 실제 사용처일 때 선택.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div>
          <div className="cd-label text-xs mb-1">계정과목</div>
          <select className="cd-select" value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)}>
            <option value="">선택…</option>
            {categories.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </div>

        {preview && (
          <div className="rounded-xl border cd-border-c p-3 text-xs space-y-1">
            <div>
              매칭 <b>{preview.total}건</b> · 이번에 적용 <b>{preview.applicable}건</b>
              {preview.lockedByDoc > 0 && <span className="cd-text-muted"> (결의서 귀속 {preview.lockedByDoc}건 제외)</span>}
            </div>
            <div className="cd-text-muted">
              현재 분류: {preview.breakdown.map((b) => `${b.label} ${b.count}`).join(" · ") || "—"}
            </div>
            {preview.existingCategoryKey && (
              <div className="cd-text-muted">
                이미 등록된 규칙이 있습니다 — {categories.find((c) => c.key === preview.existingCategoryKey)?.label ?? preview.existingCategoryKey} → 새 값으로 교체됩니다.
              </div>
            )}
          </div>
        )}

        {risky && (
          <div className="rounded-xl border p-3 text-xs" style={{ borderColor: "var(--cd-warning)", background: "var(--cd-warning-soft)" }}>
            <div className="flex items-center gap-1.5 font-medium mb-1">
              <AlertTriangle className="w-3.5 h-3.5" /> 일괄 지정을 권장하지 않는 매입처입니다
            </div>
            <p className="cd-text-muted">
              {preview?.isPg ? "결제대행(PG) 업태입니다. " : ""}
              {preview && preview.distinctStores > 1 ? `이 사업자번호로 서로 다른 상호 ${preview.distinctStores}곳이 결제되었습니다. ` : ""}
              전자상거래·결제대행 매입처는 건마다 용도(사무용품비·복리후생비 등)가 다를 수 있습니다. 상호 기준으로 좁히거나 개별 지정을 검토하세요.
            </p>
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>확인했으며 이 매입처는 용도가 하나로 고정됨을 보증합니다.</span>
            </label>
          </div>
        )}

        {error && <div className="cd-error-text text-xs">{error}</div>}
        <p className="text-[11px] cd-text-faint">
          ※ 저장 후 새로 수집되는 매입건도 이 규칙으로 자동 분류됩니다. 규칙은 부가세 집계 탭에서 확인·삭제할 수 있습니다.
        </p>
      </div>
    </CdModal>
  );
}

/* ================= 수금 자동대조 (P3 F4) ================= */

interface ReconLine {
  milestoneId: string;
  allocatedAmount: number;
  contractTitle: string;
  stageLabel: string;
  invoicedAt: string | null;
  remaining: number;
}

interface ReconItem {
  matchId: string;
  txnId: string;
  txnAt: string;
  amount: number;
  accountLabel: string;
  remitterRaw: string | null;
  transType: string | null;
  remark2: string | null;
  matchType: string;
  status: string;
  confidence: number;
  facilityId: string | null;
  facilityName: string | null;
  matchedAmount: number;
  residualAmount: number;
  reason: Record<string, unknown> | null;
  confirmedAt: string | null;
  rejectReason: string | null;
  rejectNote: string | null;
  lines: ReconLine[];
}

/** 제외 사유(마이그 174) — 결산·분개 기능 전까지 "왜 들어온 돈인지"를 남기는 최소 기록. */
const REJECT_REASONS: Array<[string, string]> = [
  ["mismatch", "오매칭(다른 거래처·금액)"],
  ["subsidy", "지원금·보조금 (예: 청년고용장려금)"],
  ["interest", "이자·금융수익"],
  ["tax_refund", "세금 환급"],
  ["transfer", "자금 이동(계좌 간)"],
  ["other", "기타"],
];
const REJECT_LABEL = Object.fromEntries(REJECT_REASONS) as Record<string, string>;

interface Receivable {
  milestoneId: string;
  contractId: string;
  contractTitle: string;
  stageLabel: string;
  facilityId: string | null;
  facilityName: string;
  invoicedAt: string | null;
  paymentTerms: string | null;
  baseAmount: number;
  remaining: number;
  collected: boolean;
  collectedAmount: number;
  settlementAmount: number | null;
}

const MATCH_TYPE_LABEL: Record<string, string> = {
  exact_1to1: "금액 일치",
  already_collected: "기록된 수금 확인",
  sum_nto1: "합계 매칭",
  partial: "부분입금",
  overpaid: "과대입금",
  prepaid: "선입금",
  non_receivable: "수금 아님",
  unmatched: "미매칭",
  manual: "수동 지정",
};

type ReconBucket = "high" | "review" | "other" | "confirmed" | "rejected";

function ReconPanel() {
  const [bucket, setBucket] = useState<ReconBucket>("high");
  const [items, setItems] = useState<ReconItem[]>([]);
  const [counts, setCounts] = useState({ high: 0, review: 0, other: 0, confirmed: 0, rejected: 0 });
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ReconItem | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [manualTarget, setManualTarget] = useState<ReconItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/finance/recon?bucket=${bucket}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "검토 큐를 불러오지 못했습니다.");
        if (!alive) return;
        setItems(data.items ?? []);
        setCounts(data.counts ?? { high: 0, review: 0, other: 0, confirmed: 0, rejected: 0 });
        setLastRunAt(data.lastRunAt ?? null);
        setChecked(new Set());
      } catch (err) {
        if (alive) setError((err as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [bucket, reloadKey]);

  const call = async (body: Record<string, unknown>, successMsg?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/finance/recon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "요청이 실패했습니다.");
      if (successMsg) setNotice(successMsg);
      setReloadKey((k) => k + 1);
      return data;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const runMatching = async () => {
    const data = await call({ action: "run" });
    if (data) setNotice(`대조 실행 — 입금 ${data.scanned}건 검사, 제안 ${data.suggested}건(고신뢰 ${data.highConfidence}건).`);
  };

  const confirmSelected = async () => {
    const ids = [...checked];
    if (!ids.length) return;
    const data = await call({ action: "bulk-confirm", matchIds: ids });
    if (data) {
      const failed = (data.failed ?? []) as Array<{ error: string }>;
      setNotice(`${data.confirmed}건 승인${failed.length ? ` · 실패 ${failed.length}건(${failed[0].error})` : ""}`);
    }
  };

  const BUCKETS: Array<[ReconBucket, string, number]> = [
    ["high", "고신뢰", counts.high],
    ["review", "검토 필요", counts.review],
    ["other", "미매칭·보류", counts.other],
    ["confirmed", "확정됨", counts.confirmed],
    ["rejected", "제외됨", counts.rejected],
  ];

  return (
    <div className="space-y-4">
      <div className="cd-card p-4">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="cd-card-title mr-auto">수금 자동대조</div>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={runMatching}>
            <RefreshCw className="w-3.5 h-3.5" /> 대조 실행
          </button>
          {bucket !== "confirmed" && (
            <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={busy || checked.size === 0} onClick={confirmSelected}>
              선택 {checked.size}건 승인
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {BUCKETS.map(([k, label, n]) => (
            <button
              key={k}
              type="button"
              className={`cd-chip cd-chip-sm ${bucket === k ? "" : "cd-text-muted"}`}
              data-active={bucket === k || undefined}
              onClick={() => setBucket(k)}
            >
              {label} {n}
            </button>
          ))}
          {bucket !== "confirmed" && bucket !== "rejected" && items.length > 0 && (
            <button
              type="button"
              className="cd-btn cd-btn-ghost cd-btn-sm ml-2"
              onClick={() => setChecked(checked.size === items.length ? new Set() : new Set(items.map((i) => i.matchId)))}
            >
              {checked.size === items.length ? "전체 해제" : "전체 선택"}
            </button>
          )}
        </div>
        <p className="text-xs cd-text-muted mb-2">
          입금 내역을 발행된 계산서(계약 단계)와 대조해 수금 후보를 제안합니다. 승인해야 실제 수금으로 반영되며, 확정 건은 되돌릴 수 있습니다.
          {" "}거래처를 식별하지 못한 입금은 금액이 같아도 제안하지 않습니다(오매칭 방지) — 수동 매칭으로 한 번 지정하면 입금자명이 학습됩니다.
        </p>
        <p className="text-[11px] cd-text-faint mb-2">
          {lastRunAt ? `마지막 대조 실행: ${lastRunAt}` : "아직 대조를 실행하지 않았습니다."} · 매칭 규칙이 바뀌면 <b>대조 실행</b>을 다시 눌러야 목록이 갱신됩니다.
        </p>
        {notice && <div className="text-sm mb-2" style={{ color: "var(--cd-success)" }}>{notice}</div>}
        {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
        {loading && <div className="text-sm cd-text-muted py-4">불러오는 중…</div>}
        {!loading && items.length === 0 && (
          <div className="py-8 text-center cd-text-muted text-sm">
            해당 상태의 건이 없습니다. 원장 수집 후 <b>대조 실행</b>을 눌러보세요.
          </div>
        )}

        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.matchId} className="rounded-xl border cd-border-c p-3">
              <div className="flex items-start gap-3 flex-wrap">
                {bucket !== "confirmed" && bucket !== "rejected" && (
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={checked.has(item.matchId)}
                    disabled={item.lines.length === 0}
                    onChange={() =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (next.has(item.matchId)) next.delete(item.matchId);
                        else next.add(item.matchId);
                        return next;
                      })
                    }
                  />
                )}
                {/* 입금 정보 */}
                <div className="min-w-[220px]">
                  <div className="font-medium">{fmtAmount(item.amount)}원</div>
                  <div className="text-xs cd-text-muted">
                    {item.txnAt} · {item.accountLabel}
                  </div>
                  <div className="text-xs">
                    입금자 <b>{item.remitterRaw || "—"}</b>
                  </div>
                  {(item.transType || item.remark2) && (
                    <div className="text-[11px] cd-text-faint truncate max-w-[220px]" title={`${item.transType ?? ""} ${item.remark2 ?? ""}`}>
                      {item.transType} {item.remark2}
                    </div>
                  )}
                </div>
                {/* 제안 매칭 */}
                <div className="flex-1 min-w-[280px]">
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    <span className="cd-pill cd-pill-info">{MATCH_TYPE_LABEL[item.matchType] ?? item.matchType}</span>
                    {item.confidence > 0 && (
                      <span className={`cd-pill ${item.confidence >= 90 ? "cd-pill-success" : "cd-pill-warn"}`}>신뢰도 {item.confidence}</span>
                    )}
                    <span className="text-sm font-medium">{item.facilityName || "거래처 미식별"}</span>
                    {item.residualAmount > 0 && <span className="cd-pill cd-pill-warn">잔여 {fmtAmount(item.residualAmount)}원</span>}
                  </div>
                  {item.lines.map((l) => (
                    <div key={l.milestoneId} className="text-xs cd-text-muted">
                      {l.contractTitle} · {l.stageLabel} — 배분 <b className="cd-text">{fmtAmount(l.allocatedAmount)}원</b>
                      {l.invoicedAt && <span className="cd-text-faint"> (발행 {l.invoicedAt})</span>}
                    </div>
                  ))}
                  {item.lines.length === 0 && (
                    <div className="text-xs cd-text-muted">{String(item.reason?.rule ?? "매칭 후보 없음")} — 수동 매칭으로 지정하세요.</div>
                  )}
                  {item.lines.length > 0 && Boolean(item.reason?.rule) && (
                    <div className="text-[11px] cd-text-faint mt-0.5">근거: {String(item.reason?.rule)}</div>
                  )}
                  {item.rejectReason && (
                    <div className="text-xs mt-1">
                      <span className="cd-pill cd-pill-idle">{REJECT_LABEL[item.rejectReason] ?? item.rejectReason}</span>
                      {item.rejectNote && <span className="ml-1.5 cd-text-muted">{item.rejectNote}</span>}
                    </div>
                  )}
                </div>
                {/* 액션 */}
                <div className="flex items-center gap-1.5">
                  {bucket === "confirmed" ? (
                    <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={() => call({ action: "unconfirm", matchId: item.matchId }, "확정을 되돌렸습니다.")}>
                      <Undo2 className="w-3.5 h-3.5" /> 되돌리기
                    </button>
                  ) : bucket === "rejected" ? (
                    <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={() => call({ action: "unreject", matchId: item.matchId }, "제외를 되돌렸습니다. 다음 대조 실행에서 다시 후보로 잡힙니다.")}>
                      <Undo2 className="w-3.5 h-3.5" /> 제외 해제
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="cd-btn cd-btn-soft cd-btn-sm"
                        disabled={busy || item.lines.length === 0}
                        onClick={() => call({ action: "confirm", matchId: item.matchId }, "수금으로 반영했습니다.")}
                      >
                        승인
                      </button>
                      <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={() => setManualTarget(item)}>
                        수동 매칭
                      </button>
                      <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={() => setRejectTarget(item)} title="수금이 아니거나 매칭이 틀린 건 — 사유를 남깁니다">
                        제외·사유 기록
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <RejectReasonModal
        item={rejectTarget}
        busy={busy}
        onClose={() => setRejectTarget(null)}
        onSubmit={async (reason, note) => {
          const ok = await call({ action: "reject", matchId: rejectTarget?.matchId, rejectReason: reason, rejectNote: note }, "제외로 기록했습니다.");
          if (ok) setRejectTarget(null);
        }}
      />

      <ManualMatchModal
        item={manualTarget}
        onClose={() => setManualTarget(null)}
        onSaved={() => {
          setManualTarget(null);
          setNotice("수동 매칭으로 수금 반영했습니다.");
          setReloadKey((k) => k + 1);
        }}
      />
    </div>
  );
}

/**
 * 제외 사유 기록 — 오매칭이거나 애초에 수금이 아닌 입금을 사유와 함께 남긴다.
 * 정식 분개(결산 원장)는 별도 기능이므로, 여기서는 "왜 들어온 돈인지"만 기록해 둔다.
 */
function RejectReasonModal({
  item,
  busy,
  onClose,
  onSubmit,
}: {
  item: ReconItem | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string, note: string) => void;
}) {
  const [reason, setReason] = useState("mismatch");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!item) return;
    // 거래처가 안 잡혔거나 매칭 후보가 없으면 수금 자체가 아닐 가능성이 높다 → 기본값을 바꿔 준다.
    setReason(item.lines.length === 0 || !item.facilityId ? "subsidy" : "mismatch");
    setNote("");
  }, [item]);

  return (
    <CdModal
      open={item !== null}
      onClose={onClose}
      title="제외 · 입금 사유 기록"
      footer={
        <>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>
            취소
          </button>
          <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={busy} onClick={() => onSubmit(reason, note.trim())}>
            제외로 기록
          </button>
        </>
      }
    >
      <div className="text-sm cd-text space-y-3">
        <div className="rounded-xl border cd-border-c p-3">
          <div className="font-medium">{item ? fmtAmount(item.amount) : 0}원</div>
          <div className="text-xs cd-text-muted">
            {item?.txnAt} · 입금자 {item?.remitterRaw || "—"}
          </div>
          {item && item.lines.length > 0 && (
            <div className="text-xs cd-text-faint mt-1">
              제안: {item.facilityName} · {item.lines[0].contractTitle} {item.lines[0].stageLabel}
            </div>
          )}
        </div>
        <div>
          <div className="cd-label text-xs mb-1">입금 성격</div>
          <select className="cd-select" value={reason} onChange={(e) => setReason(e.target.value)}>
            {REJECT_REASONS.map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <div className="cd-label text-xs mb-1">메모</div>
          <input
            className="cd-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 고용노동부 청년고용장려금 지원금"
          />
        </div>
        <p className="text-[11px] cd-text-faint">
          제외한 건은 대조 대상에서 빠지고 <b>제외됨</b> 탭에 남습니다. 잘못 제외했다면 거기서 되돌릴 수 있습니다.
          계정과목 분개는 결산 원장 기능이 붙은 뒤 이 기록을 이어받습니다.
        </p>
      </div>
    </CdModal>
  );
}

/** 수동 매칭 — 미수 계산서를 직접 골라 배분액을 지정하고 즉시 수금 반영한다. */
function ManualMatchModal({ item, onClose, onSaved }: { item: ReconItem | null; onClose: () => void; onSaved: () => void }) {
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [keyword, setKeyword] = useState("");
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  // 이미 수금 처리된 단계 — 금액을 다시 더하지 않고 "이 입금이 그 수금이다"라고 확인만 한다.
  const [confirmOnly, setConfirmOnly] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!item) return;
    setAlloc({});
    setConfirmOnly(new Set());
    setKeyword(item.facilityName ?? "");
    setError(null);
    fetch("/api/finance/recon?receivables=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setReceivables(d.receivables ?? []))
      .catch(() => setReceivables([]));
  }, [item]);

  const filtered = useMemo(() => {
    const k = keyword.trim();
    if (!k) return receivables.slice(0, 50);
    return receivables.filter((r) => `${r.facilityName} ${r.contractTitle} ${r.stageLabel}`.includes(k)).slice(0, 50);
  }, [receivables, keyword]);

  const allocatedTotal = Object.values(alloc).reduce((acc, v) => acc + (Number(v) || 0), 0);
  // 확인만 하는 수금 완료 단계의 금액 합(반영은 안 하지만 입금액과 맞는지 눈으로 대조해야 한다)
  const confirmTotal = receivables
    .filter((r) => confirmOnly.has(r.milestoneId))
    .reduce((acc, r) => acc + (r.settlementAmount && r.settlementAmount > 0 ? r.settlementAmount : r.collectedAmount), 0);
  const comparedTotal = allocatedTotal + confirmTotal;

  const submit = async () => {
    if (!item) return;
    const lines = [
      ...Object.entries(alloc)
        .map(([milestoneId, v]) => ({ milestoneId, allocatedAmount: Number(v) || 0 }))
        .filter((l) => l.allocatedAmount > 0),
      // 수금 완료 단계는 배분액 0 — 승인해도 수금액이 다시 더해지지 않고 입금 건만 닫힌다.
      ...[...confirmOnly].filter((id) => !Number(alloc[id])).map((milestoneId) => ({ milestoneId, allocatedAmount: 0 })),
    ];
    if (!lines.length) {
      setError("배분액을 입력하거나, 이미 수금된 단계를 확인으로 선택하세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const target = receivables.find((r) => r.milestoneId === lines[0].milestoneId);
      const res = await fetch("/api/finance/recon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "manual", txnId: item.txnId, facilityId: target?.facilityId ?? null, lines }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "수동 매칭에 실패했습니다.");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CdModal
      open={item !== null}
      onClose={onClose}
      size="xl"
      title="수동 매칭"
      footer={
        <>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="cd-btn cd-btn-primary cd-btn-sm"
            disabled={busy || (allocatedTotal <= 0 && confirmOnly.size === 0)}
            onClick={submit}
          >
            {allocatedTotal > 0 ? `${fmtAmount(allocatedTotal)}원 수금 반영` : `${confirmOnly.size}건 대조 확인`}
          </button>
        </>
      }
    >
      <div className="text-sm cd-text space-y-3">
        <div className="rounded-xl border cd-border-c p-3">
          <div className="font-medium">{item ? fmtAmount(item.amount) : 0}원 입금</div>
          <div className="text-xs cd-text-muted">
            {item?.txnAt} · 입금자 {item?.remitterRaw || "—"}
          </div>
        </div>
        <input className="cd-input" placeholder="거래처·계약명 검색" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
        <div className="max-h-[320px] overflow-y-auto rounded-xl border cd-border-c divide-y">
          {filtered.map((r) => {
            // 실적 정산이 있으면 실제 청구액은 정산액 — 채우기·표시 모두 이 기준을 쓴다.
            // 이미 수금된 단계는 잔액이 0 이므로 기록된 수금액을 보여준다(정산이 있으면 정산액).
            const due =
              r.settlementAmount && r.settlementAmount > 0
                ? r.settlementAmount
                : r.collected
                  ? r.collectedAmount
                  : r.remaining;
            const picked = confirmOnly.has(r.milestoneId);
            return (
              <div key={r.milestoneId} className="p-2 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium">{r.facilityName || "거래처 미지정"}</div>
                  <div className="text-[11px] cd-text-muted break-words">
                    {r.contractTitle} · {r.stageLabel}
                    {r.invoicedAt ? ` (발행 ${r.invoicedAt})` : ""}
                  </div>
                </div>
                {/* 매칭 대상 금액 — 공급가액과 VAT 포함액을 함께 보여야 입금액과 대조할 수 있다. */}
                <div className="shrink-0 text-right leading-tight" style={{ width: 150 }}>
                  <div className="text-xs font-mono font-medium">{fmtAmount(due)}원</div>
                  <div className="text-[11px] cd-text-faint font-mono">VAT 포함 {fmtAmount(Math.round(due * 1.1))}</div>
                  {r.collected && <span className="cd-pill cd-pill-idle mt-0.5 inline-block">수금 완료</span>}
                  {r.settlementAmount != null && r.settlementAmount > 0 && (
                    <span className="block text-[10px] cd-text-faint">실적 정산액</span>
                  )}
                </div>
                {r.collected ? (
                  <button
                    type="button"
                    className={`cd-btn cd-btn-sm shrink-0 ${picked ? "cd-btn-primary" : "cd-btn-ghost"}`}
                    style={{ width: 200 }}
                    title="이 입금이 그 수금이라고 확인만 합니다(수금액은 다시 더해지지 않습니다)"
                    onClick={() =>
                      setConfirmOnly((prev) => {
                        const next = new Set(prev);
                        if (next.has(r.milestoneId)) next.delete(r.milestoneId);
                        else next.add(r.milestoneId);
                        return next;
                      })
                    }
                  >
                    {picked ? "확인 선택됨" : "이 수금으로 확인"}
                  </button>
                ) : (
                  <>
                    <input
                      className="cd-input text-right shrink-0"
                      style={{ width: 140 }}
                      placeholder="배분액"
                      inputMode="numeric"
                      value={alloc[r.milestoneId] ? Number(alloc[r.milestoneId]).toLocaleString("ko-KR") : ""}
                      onChange={(e) => setAlloc((prev) => ({ ...prev, [r.milestoneId]: e.target.value.replace(/[^0-9]/g, "") }))}
                    />
                    <button
                      type="button"
                      className="cd-btn cd-btn-ghost cd-btn-sm shrink-0"
                      title="이 단계의 청구액(정산액)을 배분액으로 채웁니다"
                      onClick={() => setAlloc((prev) => ({ ...prev, [r.milestoneId]: String(Math.round(due)) }))}
                    >
                      채우기
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && <div className="p-4 text-center text-xs cd-text-muted">미수 계산서가 없습니다.</div>}
        </div>
        <div className="text-xs cd-text-muted">
          선택 합계 <b className="cd-text">{fmtAmount(comparedTotal)}원</b>
          <span className="ml-1 cd-text-faint">(VAT 포함 {fmtAmount(Math.round(comparedTotal * 1.1))}원)</span>
          {confirmTotal > 0 && (
            <span className="ml-1 cd-text-faint">— 이 중 {fmtAmount(confirmTotal)}원은 확인만(수금액 재반영 없음)</span>
          )}
          {item && comparedTotal !== item.amount && (
            Math.abs(Math.round(comparedTotal * 1.1) - item.amount) <= 1 ? (
              <span className="ml-1" style={{ color: "var(--cd-success)" }}>VAT 포함액이 입금액과 일치합니다</span>
            ) : (
              <span className="ml-1 cd-warn-text">입금액과 다릅니다({fmtAmount(item.amount - comparedTotal)}원 차이)</span>
            )
          )}
        </div>
        {error && <div className="cd-error-text text-xs">{error}</div>}
      </div>
    </CdModal>
  );
}

/* ================= 부가세 집계 (P2 F3) ================= */

interface VatRow {
  categoryKey: string | null;
  categoryLabel: string;
  count: number;
  amountTotal: number;
  supplyAmount: number;
  taxAmount: number;
  deductibleTax: number;
  nonDeductibleTax: number;
}

// 분기 프리셋 — 부가세 신고 단위(1~4분기). 확정 신고는 반기지만 실무 집계는 분기 단위가 편하다.
function quarterRange(year: number, q: number): { from: string; to: string } {
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(year, endMonth, 0).getDate();
  const p = (n: number) => String(n).padStart(2, "0");
  return { from: `${year}-${p(startMonth)}-01`, to: `${year}-${p(endMonth)}-${p(lastDay)}` };
}

function VatPanel() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [range, setRange] = useState(() => quarterRange(now.getFullYear(), Math.floor(now.getMonth() / 3) + 1));
  const [rows, setRows] = useState<VatRow[]>([]);
  const [totals, setTotals] = useState<Omit<VatRow, "categoryKey" | "categoryLabel"> | null>(null);
  const [unclassified, setUnclassified] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/finance/vat?from=${range.from}&to=${range.to}`, { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "집계를 불러오지 못했습니다.");
        if (!alive) return;
        setRows(data.summary?.rows ?? []);
        setTotals(data.summary?.totals ?? null);
        setUnclassified(data.summary?.unclassified ?? 0);
      } catch (err) {
        if (alive) setError((err as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [range]);

  const applyQuarter = (y: number, q: number) => {
    setYear(y);
    setQuarter(q);
    setRange(quarterRange(y, q));
  };

  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  return (
    <div className="space-y-4">
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="cd-card-title mr-auto">부가세 집계 — 계정과목별</div>
        <select className="cd-select" value={year} onChange={(e) => applyQuarter(Number(e.target.value), quarter)}>
          {years.map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        {[1, 2, 3, 4].map((q) => (
          <button
            key={q}
            type="button"
            className={`cd-chip cd-chip-sm ${quarter === q ? "" : "cd-text-muted"}`}
            data-active={quarter === q || undefined}
            onClick={() => applyQuarter(year, q)}
          >
            {q}분기
          </button>
        ))}
        <a className="cd-btn cd-btn-soft cd-btn-sm" href={`/api/finance/vat?from=${range.from}&to=${range.to}&format=xlsx`}>
          <Download className="w-3.5 h-3.5" /> 엑셀 내려받기
        </a>
      </div>
      <div className="text-xs cd-text-muted mb-3">
        {range.from} ~ {range.to} · 승인 건 기준(취소·제외 건 제외)
        {unclassified > 0 && (
          <span className="ml-2 cd-pill cd-pill-warn">미분류 {unclassified}건 — 법인카드 원장에서 분류하세요</span>
        )}
      </div>
      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="cd-text-muted text-left">
              <th className="py-1.5 pr-3 font-normal">계정과목</th>
              <th className="py-1.5 pr-3 font-normal text-right">건수</th>
              <th className="py-1.5 pr-3 font-normal text-right">합계금액</th>
              <th className="py-1.5 pr-3 font-normal text-right">공급가액</th>
              <th className="py-1.5 pr-3 font-normal text-right">부가세</th>
              <th className="py-1.5 pr-3 font-normal text-right">공제 대상</th>
              <th className="py-1.5 font-normal text-right">불공제</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.categoryKey ?? "none"} className="border-t cd-hairline-row-c">
                <td className="py-1.5 pr-3">{r.categoryLabel}</td>
                <td className="py-1.5 pr-3 text-right">{r.count.toLocaleString()}</td>
                <td className="py-1.5 pr-3 text-right font-medium">{fmtAmount(r.amountTotal)}</td>
                <td className="py-1.5 pr-3 text-right cd-text-muted">{fmtAmount(r.supplyAmount)}</td>
                <td className="py-1.5 pr-3 text-right">{fmtAmount(r.taxAmount)}</td>
                <td className="py-1.5 pr-3 text-right" style={{ color: "var(--cd-success)" }}>{fmtAmount(r.deductibleTax)}</td>
                <td className="py-1.5 text-right" style={{ color: "var(--cd-warning)" }}>{fmtAmount(r.nonDeductibleTax)}</td>
              </tr>
            ))}
            {totals && rows.length > 0 && (
              <tr className="border-t-2 cd-border-c font-bold">
                <td className="py-2 pr-3">합계</td>
                <td className="py-2 pr-3 text-right">{totals.count.toLocaleString()}</td>
                <td className="py-2 pr-3 text-right">{fmtAmount(totals.amountTotal)}</td>
                <td className="py-2 pr-3 text-right">{fmtAmount(totals.supplyAmount)}</td>
                <td className="py-2 pr-3 text-right">{fmtAmount(totals.taxAmount)}</td>
                <td className="py-2 pr-3 text-right" style={{ color: "var(--cd-success)" }}>{fmtAmount(totals.deductibleTax)}</td>
                <td className="py-2 text-right" style={{ color: "var(--cd-warning)" }}>{fmtAmount(totals.nonDeductibleTax)}</td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center cd-text-muted text-sm">해당 기간 매입 내역이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>

    <StoreRuleListCard />
    </div>
  );
}

/** 등록된 가맹점 고정 규칙 목록 — 잘못 지정한 규칙을 확인·삭제하는 자리. */
function StoreRuleListCard() {
  interface RuleRow {
    ruleId: string;
    matchType: "corp_num" | "store_name";
    matchValue: string;
    categoryLabel: string;
    storeName: string | null;
    storeBizType: string | null;
    txnCount: number;
    createdAt: string;
  }
  const [rules, setRules] = useState<RuleRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/finance/store-rules", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error ?? "규칙을 불러오지 못했습니다.");
        setRules(d.rules ?? []);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  useEffect(load, [load]);

  const remove = async (ruleId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/finance/store-rules?ruleId=${encodeURIComponent(ruleId)}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json())?.error ?? "삭제하지 못했습니다.");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cd-card p-4">
      <div className="cd-card-title mb-1">가맹점 계정과목 고정 규칙</div>
      <div className="text-xs cd-text-muted mb-3">
        법인카드 원장에서 <Store className="inline w-3 h-3" /> 버튼으로 등록합니다. 규칙을 지워도 이미 분류된 건은 그대로 남습니다.
      </div>
      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="cd-text-muted text-left">
              <th className="py-1.5 pr-3 font-normal">가맹점</th>
              <th className="py-1.5 pr-3 font-normal">업태</th>
              <th className="py-1.5 pr-3 font-normal">기준</th>
              <th className="py-1.5 pr-3 font-normal">계정과목</th>
              <th className="py-1.5 pr-3 font-normal text-right">해당 건수</th>
              <th className="py-1.5 pr-3 font-normal">등록일</th>
              <th className="py-1.5 font-normal w-8" />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.ruleId} className="border-t cd-hairline-row-c">
                <td className="py-1.5 pr-3">{r.storeName || r.matchValue}</td>
                <td className="py-1.5 pr-3 text-xs cd-text-muted">{r.storeBizType ?? ""}</td>
                <td className="py-1.5 pr-3 text-xs cd-text-muted whitespace-nowrap">
                  {r.matchType === "store_name" ? "상호" : "사업자번호"} · {r.matchType === "corp_num" ? fmtCorpNum(r.matchValue) : r.matchValue}
                </td>
                <td className="py-1.5 pr-3">{r.categoryLabel}</td>
                <td className="py-1.5 pr-3 text-right">{r.txnCount.toLocaleString()}</td>
                <td className="py-1.5 pr-3 text-xs cd-text-muted">{r.createdAt.slice(0, 10)}</td>
                <td className="py-1.5">
                  <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm px-1.5" disabled={busy} title="규칙 삭제" onClick={() => remove(r.ruleId)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center cd-text-muted text-sm">등록된 고정 규칙이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ================= 전자세금계산서 (P4 F5) ================= */

interface TaxInvoiceRow {
  invoiceId: string;
  mgtKey: string;
  writeDate: string;
  amountTotal: number;
  taxTotal: number;
  totalAmount: number;
  invoiceeCorpName: string | null;
  invoiceeEmail: string | null;
  barobillState: number | null;
  ntsSendState: number | null;
  ntsSendKey: string | null;
  canceledAt: string | null;
  contractId: string | null;
  contractTitle: string | null;
  stageLabel: string | null;
}

const NTS_LABEL: Record<number, string> = { 1: "전송전", 2: "전송중", 3: "전송중", 4: "전송완료", 5: "전송실패" };

/**
 * 발행 이력 — 발행 자체는 계약 상세의 청구·수금 단계에서 한다(발주처·단계 정보가 거기 있다).
 * 이 탭은 발행분의 국세청 전송 상태를 확인·갱신하고 원본을 여는 자리다.
 */
function TaxInvoicePanel() {
  const [rows, setRows] = useState<TaxInvoiceRow[]>([]);
  const [modifyTarget, setModifyTarget] = useState<TaxInvoiceRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch("/api/finance/tax-invoices", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error ?? "발행 이력을 불러오지 못했습니다.");
        if (alive) setRows(d.invoices ?? []);
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const call = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/finance/tax-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "요청이 실패했습니다.");
      return data;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    const data = await call({ action: "refresh" });
    if (data) {
      setNotice(`${data.updated}/${data.checked}건 상태를 갱신했습니다.`);
      setReloadKey((k) => k + 1);
    }
  };

  // 국세청 전송은 바로빌이 익일 일괄 처리 — 수동 버튼만으로는 "전송전"이 계속 남는다(2026-08-25 사용자 리포트).
  // 미전송 건이 보이면 화면 진입 시 1회 자동 갱신한다(보관 PDF 백필도 이 호출에 함께 실린다).
  const autoRefreshed = useRef(false);
  useEffect(() => {
    if (loading || autoRefreshed.current) return;
    if (!rows.some((r) => !r.canceledAt && (r.ntsSendState ?? 1) < 4)) return;
    autoRefreshed.current = true;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, rows]);

  const openOriginal = async (invoiceId: string) => {
    const data = await call({ action: "popup-url", invoiceId });
    if (data?.url) window.open(data.url, "_blank", "noopener,width=1100,height=900");
  };

  const cancel = async (invoiceId: string) => {
    const data = await call({ action: "cancel", invoiceId });
    if (data) {
      setNotice("발행을 취소했습니다(단계의 발행 기록도 되돌렸습니다).");
      setReloadKey((k) => k + 1);
    }
  };

  return (
    <div className="cd-card p-4">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="cd-card-title mr-auto">전자세금계산서 발행 이력</div>
        <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={refresh}>
          <RefreshCw className="w-3.5 h-3.5" /> 상태 갱신
        </button>
      </div>
      <p className="text-xs cd-text-muted mb-2">
        발행은 계약 상세의 청구·수금 단계에서 <b>전자발행</b> 버튼으로 합니다. 국세청 전송은 발행 다음 날 일괄 처리되므로, 전송 상태는 상태 갱신 후에 반영됩니다.
        <br />
        발급된 계산서는 취소할 수 없습니다 — 금액·내용을 정정하려면 수정세금계산서를 발행해야 합니다(현재는 바로빌 홈페이지에서 처리).
      </p>
      {notice && <div className="text-sm mb-2" style={{ color: "var(--cd-success)" }}>{notice}</div>}
      {error && <div className="cd-error-text text-sm mb-2">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="cd-text-muted text-left">
              <th className="py-1.5 pr-3 font-normal">작성일자</th>
              <th className="py-1.5 pr-3 font-normal">공급받는자</th>
              <th className="py-1.5 pr-3 font-normal">계약·단계</th>
              <th className="py-1.5 pr-3 font-normal text-right">공급가액</th>
              <th className="py-1.5 pr-3 font-normal text-right">세액</th>
              <th className="py-1.5 pr-3 font-normal text-right">합계</th>
              <th className="py-1.5 pr-3 font-normal">국세청</th>
              <th className="py-1.5 font-normal" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.invoiceId} className="border-t cd-hairline-row-c">
                <td className="py-1.5 pr-3 whitespace-nowrap">{r.writeDate}</td>
                <td className="py-1.5 pr-3">
                  {r.invoiceeCorpName ?? "—"}
                  {r.invoiceeEmail && <span className="block text-[11px] cd-text-faint">{r.invoiceeEmail}</span>}
                </td>
                <td className="py-1.5 pr-3 max-w-[240px] truncate text-xs cd-text-muted" title={`${r.contractTitle ?? ""} ${r.stageLabel ?? ""}`}>
                  {r.contractTitle ?? "—"}
                  {r.stageLabel ? ` · ${r.stageLabel}` : ""}
                </td>
                <td className="py-1.5 pr-3 text-right font-mono">{fmtAmount(r.amountTotal)}</td>
                <td className="py-1.5 pr-3 text-right font-mono cd-text-muted">{fmtAmount(r.taxTotal)}</td>
                <td className="py-1.5 pr-3 text-right font-mono font-medium">{fmtAmount(r.totalAmount)}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap">
                  {r.canceledAt ? (
                    <span className="cd-pill cd-pill-error">취소됨</span>
                  ) : (
                    <>
                      <span className={`cd-pill ${r.ntsSendState === 4 ? "cd-pill-success" : r.ntsSendState === 5 ? "cd-pill-error" : "cd-pill-warn"}`}>
                        {NTS_LABEL[r.ntsSendState ?? 1] ?? "전송전"}
                      </span>
                      {r.ntsSendKey && <span className="block text-[11px] cd-text-faint">{r.ntsSendKey}</span>}
                    </>
                  )}
                </td>
                <td className="py-1.5 text-right whitespace-nowrap">
                  <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={() => void openOriginal(r.invoiceId)}>
                    원본
                  </button>
                  {/* 수정세금계산서(P5) — 발급분 정정의 유일한 경로. 원본 승인번호가 필요해 전송완료 건만. */}
                  {!r.canceledAt && r.ntsSendState === 4 && r.ntsSendKey && (
                    <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={() => setModifyTarget(r)}>
                      수정발행
                    </button>
                  )}
                  {/* 실측: 발급완료(3014) 건은 API 취소 불가(-21003) — 임시저장 건에만 삭제를 노출한다. */}
                  {!r.canceledAt && (r.barobillState ?? 0) < 3000 && (
                    <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={busy} onClick={() => void cancel(r.invoiceId)} title="임시저장 문서만 삭제할 수 있습니다">
                      삭제
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="py-6 text-center cd-text-muted text-sm">발행 이력이 없습니다.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ModifyInvoiceModal
        origin={modifyTarget}
        onClose={() => setModifyTarget(null)}
        onIssued={() => {
          setModifyTarget(null);
          setNotice("수정세금계산서를 발행했습니다. 국세청 전송 상태는 다음 상태 갱신에서 반영됩니다.");
          setReloadKey((k) => k + 1);
        }}
      />
    </div>
  );
}

/** 수정세금계산서 사유(국세청 6종) — lib/barobill/tax-invoice.ts 의 MODIFY_CODES 와 동일. */
const MODIFY_CODES: Array<{ code: string; label: string; hint: string; negative: boolean }> = [
  { code: "1", label: "기재사항 착오정정", hint: "금액 외 기재사항을 잘못 적은 경우", negative: false },
  { code: "2", label: "공급가액 변동", hint: "정산·단가 조정 등 — 증감분만 발행(감액이면 음수)", negative: false },
  { code: "3", label: "환입", hint: "반품 — 환입 금액만큼 음수 발행", negative: true },
  { code: "4", label: "계약의 해제", hint: "당초 발행을 되돌림 — 음수 발행", negative: true },
  { code: "5", label: "내국신용장 사후개설", hint: "내국신용장이 사후 개설된 경우", negative: false },
  { code: "6", label: "착오에 의한 이중발급", hint: "같은 건 중복 발행 — 당초분 취소(음수)", negative: true },
];

/**
 * 수정세금계산서 발행 모달(P5) — 발급분은 취소가 안 되므로(실측) 정정은 이 경로뿐이다.
 * 환입·계약해제·이중발급은 음수 금액이 원칙이라, 사유를 고르면 부호를 자동으로 맞춰 준다.
 */
function ModifyInvoiceModal({ origin, onClose, onIssued }: { origin: TaxInvoiceRow | null; onClose: () => void; onIssued: () => void }) {
  const [modifyCode, setModifyCode] = useState("2");
  const [writeDate, setWriteDate] = useState("");
  const [supplyInput, setSupplyInput] = useState("");
  const [itemName, setItemName] = useState("");
  const [remark1, setRemark1] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = MODIFY_CODES.find((m) => m.code === modifyCode) ?? MODIFY_CODES[1];

  useEffect(() => {
    if (!origin) return;
    setModifyCode("2");
    setWriteDate(new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10));
    setSupplyInput(String(Math.abs(Math.round(origin.amountTotal))));
    setItemName(`${origin.contractTitle ?? ""} ${origin.stageLabel ?? ""} 수정분`.trim());
    setRemark1("");
    setError(null);
  }, [origin]);

  // 음수 사유면 부호를 자동으로 뒤집는다. 입력은 항상 양수로 받는다.
  const sign = meta.negative ? -1 : 1;
  const supply = sign * (Number(supplyInput.replace(/[^0-9]/g, "")) || 0);
  const tax = Math.round(supply * 0.1);
  const total = supply + tax;

  const submit = async () => {
    if (!origin) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/finance/tax-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "modify",
          originalInvoiceId: origin.invoiceId,
          modifyCode,
          writeDate,
          amountTotal: supply,
          taxTotal: tax,
          totalAmount: total,
          itemName,
          remark1,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "수정 발행에 실패했습니다.");
      onIssued();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <CdModal
      open={origin !== null}
      onClose={onClose}
      size="lg"
      title="수정세금계산서 발행"
      footer={
        <>
          <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" onClick={onClose}>
            취소
          </button>
          <button type="button" className="cd-btn cd-btn-primary cd-btn-sm" disabled={busy || !supplyInput || !itemName.trim()} onClick={submit}>
            {fmtAmount(total)}원 수정 발행
          </button>
        </>
      }
    >
      <div className="text-sm cd-text space-y-3">
        <div className="rounded-xl border cd-border-c p-3 text-xs">
          <div className="font-medium cd-text mb-0.5">원본: {origin?.invoiceeCorpName} · {origin ? fmtAmount(origin.totalAmount) : 0}원 ({origin?.writeDate})</div>
          <div className="cd-text-muted">승인번호 {origin?.ntsSendKey} — 수정분은 이 승인번호에 연결되어 국세청에 전송됩니다.</div>
        </div>
        <div>
          <div className="cd-label text-xs mb-1">수정 사유</div>
          <select className="cd-select" value={modifyCode} onChange={(e) => setModifyCode(e.target.value)}>
            {MODIFY_CODES.map((m) => (
              <option key={m.code} value={m.code}>{m.code}. {m.label}</option>
            ))}
          </select>
          <p className="text-[11px] cd-text-faint mt-1">{meta.hint}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label>
            <span className="text-[11px] cd-text-faint">작성일자</span>
            <input type="date" className="cd-input mt-0.5" value={writeDate} onChange={(e) => setWriteDate(e.target.value)} />
          </label>
          <label>
            <span className="text-[11px] cd-text-faint">공급가액{meta.negative ? " (음수로 발행됩니다)" : ""}</span>
            <input
              className="cd-input mt-0.5 text-right font-mono"
              inputMode="numeric"
              value={supplyInput ? Number(supplyInput.replace(/[^0-9]/g, "")).toLocaleString("ko-KR") : ""}
              onChange={(e) => setSupplyInput(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </label>
        </div>
        <label className="block">
          <span className="text-[11px] cd-text-faint">품목</span>
          <input className="cd-input mt-0.5" value={itemName} onChange={(e) => setItemName(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-[11px] cd-text-faint">비고</span>
          <input className="cd-input mt-0.5" value={remark1} onChange={(e) => setRemark1(e.target.value)} placeholder="선택" />
        </label>
        <div className="flex items-center gap-4 text-xs">
          <span><span className="cd-text-muted mr-1">공급가액</span><b className="font-mono">{fmtAmount(supply)}</b></span>
          <span><span className="cd-text-muted mr-1">세액</span><b className="font-mono">{fmtAmount(tax)}</b></span>
          <span><span className="cd-text-muted mr-1">합계</span><b className="font-mono text-[13px]">{fmtAmount(total)}원</b></span>
        </div>
        <p className="text-[11px] cd-text-faint">
          ※ 수정 발행도 발급 즉시 되돌릴 수 없습니다. 계약 단계 금액(청구·수금)은 자동으로 바뀌지 않으니, 정정 후 계약 화면에서 확인하세요.
        </p>
        {error && <div className="cd-error-text text-xs">{error}</div>}
      </div>
    </CdModal>
  );
}

/* ================= 공통 페이저 ================= */

function Pager({ page, total, limit, onPage }: { page: number; total: number; limit: number; onPage: (p: number) => void }) {
  const maxPage = Math.max(0, Math.ceil(total / limit) - 1);
  const label = useMemo(() => {
    if (total === 0) return "0건";
    const from = page * limit + 1;
    const to = Math.min(total, (page + 1) * limit);
    return `${from.toLocaleString()}–${to.toLocaleString()} / ${total.toLocaleString()}건`;
  }, [page, total, limit]);
  if (total <= limit) return <div className="mt-3 text-xs cd-text-muted">{label}</div>;
  return (
    <div className="mt-3 flex items-center gap-2">
      <span className="text-xs cd-text-muted mr-auto">{label}</span>
      <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={page === 0} onClick={() => onPage(page - 1)}>
        이전
      </button>
      <button type="button" className="cd-btn cd-btn-ghost cd-btn-sm" disabled={page >= maxPage} onClick={() => onPage(page + 1)}>
        다음
      </button>
    </div>
  );
}
