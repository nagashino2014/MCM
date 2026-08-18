// 계좌·카드 내역 엑셀 파서 (은행/카드사 양식별 프로파일)
// 바로빌은 최근 3개월(계좌)·2개월+(카드)만 보유하고 그 이전은 유료라, 과거분은 은행/카드사에서
// 내려받은 엑셀로 채운다. 양식마다 헤더 위치·날짜 포맷·금액 표기가 달라 프로파일로 나눠 둔다.
//
// 실측 기준(2026-08-18, 사용자 제공 실파일):
//   기업은행 계좌  : 3행 헤더 [" ","거래일시","출금","입금","거래후 잔액","거래내용",...], 마지막 "합계" 행
//   국민은행 계좌  : 7행 헤더 ["No","거래일시","보낸분/받는분","출금액(원)","입금액(원)","잔액(원)",...]
//   롯데 법인카드  : 1행 헤더 ["카드번호","카드번호","회원명(한글)","승인일자","승인시간","승인금액",...]
//   기업은행 카드  : 3행 헤더 [" ","승인구분","이용구분","승인일시","카드번호",...], 마지막 "총 계" 행

import * as XLSX from "xlsx";

export type StatementKind = "bank" | "card";

export interface ParsedBankTxn {
  txnAt: string; // YYYY-MM-DD HH:MM:SS
  direction: "in" | "out";
  amount: number;
  balanceAfter: number | null;
  counterparty: string; // 입금자/출금처 원문 (자동대조 키)
  transType: string; // 거래구분·적요
  transOffice: string; // 상대은행·처리점
  remark1: string;
  remark2: string;
  raw: Record<string, unknown>;
}

export interface ParsedCardTxn {
  approvedAt: string; // YYYY-MM-DD HH:MM:SS
  approvalNum: string;
  /** 앱 표준값으로 정규화한 승인 형태 — 승인 / 취소. 카드사 원문은 raw 에 남긴다. */
  approvalType: "승인" | "취소";
  amountTotal: number;
  storeName: string;
  storeCorpNum: string;
  storeAddr: string;
  storeBizType: string;
  paymentPlan: string;
  installmentMonths: string;
  useLocation: string;
  cardNoMasked: string;
  raw: Record<string, unknown>;
}

export interface ParsedStatement {
  profileId: string;
  profileLabel: string;
  kind: StatementKind;
  /** 파일에서 읽어낸 계좌번호·카드번호(마스킹 포함) — 대상 자동 추정에 쓴다. */
  accountHint: string | null;
  period: { from: string | null; to: string | null };
  bankRows: ParsedBankTxn[];
  cardRows: ParsedCardTxn[];
  warnings: string[];
}

type Row = Array<string | null>;

const text = (v: unknown): string => (v == null ? "" : String(v).trim());
const num = (v: unknown): number => {
  const s = text(v).replace(/[^0-9.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  const s = text(v).replace(/[^0-9.-]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** "2026.05.30 20:37:01" · "2026-05-29 17:47:26" · "20260102"+"150126" → "YYYY-MM-DD HH:MM:SS" */
function toDateTime(dateRaw: string, timeRaw = ""): string | null {
  const d = text(dateRaw);
  const t = text(timeRaw);
  const merged = t ? `${d} ${t}` : d;
  const digits = merged.replace(/[^0-9]/g, "");
  if (digits.length < 8) return null;
  const [y, mo, da] = [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)];
  const hh = digits.slice(8, 10) || "00";
  const mi = digits.slice(10, 12) || "00";
  const ss = digits.slice(12, 14) || "00";
  if (Number(mo) < 1 || Number(mo) > 12 || Number(da) < 1 || Number(da) > 31) return null;
  return `${y}-${mo}-${da} ${hh}:${mi}:${ss}`;
}

/** 헤더 행 찾기 — 주어진 키워드가 모두 들어 있는 첫 행. 양식마다 상단 안내 행 수가 달라 고정할 수 없다. */
function findHeaderRow(rows: Row[], keys: string[], limit = 20): number {
  for (let i = 0; i < Math.min(limit, rows.length); i += 1) {
    const cells = (rows[i] ?? []).map((c) => text(c).replace(/\s+/g, ""));
    if (keys.every((k) => cells.some((c) => c.includes(k.replace(/\s+/g, ""))))) return i;
  }
  return -1;
}

/** 헤더 라벨 → 열 인덱스. 같은 라벨이 두 번 나오면(롯데 "카드번호") 첫 번째를 쓴다. */
function columnIndex(header: Row): (label: string) => number {
  const norm = header.map((c) => text(c).replace(/\s+/g, ""));
  return (label: string) => norm.indexOf(label.replace(/\s+/g, ""));
}

/** 시트 전체에서 "계좌번호 : 123-456" 같은 안내 문구를 찾아 번호만 뽑는다. */
function findAccountNo(rows: Row[], labels: string[]): string | null {
  for (const row of rows.slice(0, 12)) {
    for (const cell of row ?? []) {
      const s = text(cell);
      for (const label of labels) {
        const m = s.match(new RegExp(`${label}\\s*[:：]\\s*([0-9][0-9-]{6,})`));
        if (m) return m[1];
      }
    }
  }
  return null;
}

function findPeriod(rows: Row[]): { from: string | null; to: string | null } {
  for (const row of rows.slice(0, 12)) {
    for (const cell of row ?? []) {
      const s = text(cell);
      const range = s.match(/(\d{4}[.\-]\d{2}[.\-]\d{2})\s*~\s*(\d{4}[.\-]\d{2}[.\-]\d{2})/);
      if (range) return { from: range[1].replace(/\./g, "-"), to: range[2].replace(/\./g, "-") };
      const start = s.match(/조회시작일자\s*[:：]\s*(\d{4}[.\-]\d{2}[.\-]\d{2})/);
      const end = s.match(/조회종료일자\s*[:：]\s*(\d{4}[.\-]\d{2}[.\-]\d{2})/);
      if (start && end) return { from: start[1].replace(/\./g, "-"), to: end[1].replace(/\./g, "-") };
    }
  }
  return { from: null, to: null };
}

interface Profile {
  id: string;
  label: string;
  kind: StatementKind;
  /** 헤더 판별 키워드 — 전부 있어야 이 양식으로 본다. */
  headerKeys: string[];
  parse: (rows: Row[], headerAt: number) => Omit<ParsedStatement, "profileId" | "profileLabel" | "kind">;
}

const PROFILES: Profile[] = [
  {
    id: "ibk-bank",
    label: "기업은행 계좌",
    kind: "bank",
    headerKeys: ["거래일시", "거래후 잔액", "거래내용"],
    parse: (rows, headerAt) => {
      const at = columnIndex(rows[headerAt]);
      const [cDt, cOut, cIn, cBal, cDesc, cBank, cMemo, cType, cPeer] = [
        at("거래일시"), at("출금"), at("입금"), at("거래후 잔액"), at("거래내용"),
        at("상대은행"), at("메모"), at("거래구분"), at("상대계좌예금주명"),
      ];
      const bankRows: ParsedBankTxn[] = [];
      const warnings: string[] = [];
      for (const row of rows.slice(headerAt + 1)) {
        const txnAt = toDateTime(text(row[cDt]));
        if (!txnAt) continue; // 합계 행·빈 행
        const out = num(row[cOut]);
        const inAmt = num(row[cIn]);
        if (!out && !inAmt) continue;
        // 상대계좌예금주명이 비면 거래내용이 곧 상대방 표기다(기업은행 실측).
        const peer = text(row[cPeer]) || text(row[cDesc]);
        bankRows.push({
          txnAt,
          direction: inAmt > 0 ? "in" : "out",
          amount: inAmt > 0 ? inAmt : out,
          balanceAfter: numOrNull(row[cBal]),
          counterparty: peer,
          transType: text(row[cType]),
          transOffice: text(row[cBank]),
          remark1: text(row[cDesc]) || peer,
          remark2: text(row[cMemo]),
          raw: { source: "excel", bank: "IBK", row: row.map((c) => text(c)) },
        });
      }
      return { accountHint: findAccountNo(rows, ["계좌번호"]), period: findPeriod(rows), bankRows, cardRows: [], warnings };
    },
  },
  {
    id: "kb-bank",
    label: "국민은행 계좌",
    kind: "bank",
    headerKeys: ["거래일시", "보낸분/받는분", "잔액(원)"],
    parse: (rows, headerAt) => {
      const at = columnIndex(rows[headerAt]);
      const [cDt, cPeer, cOut, cIn, cBal, cLabel, cMemo, cType, cOffice] = [
        at("거래일시"), at("보낸분/받는분"), at("출금액(원)"), at("입금액(원)"), at("잔액(원)"),
        at("내 통장 표시"), at("메모"), at("적요"), at("처리점"),
      ];
      const bankRows: ParsedBankTxn[] = [];
      for (const row of rows.slice(headerAt + 1)) {
        const txnAt = toDateTime(text(row[cDt]));
        if (!txnAt) continue;
        const out = num(row[cOut]);
        const inAmt = num(row[cIn]);
        if (!out && !inAmt) continue;
        const peer = text(row[cPeer]);
        bankRows.push({
          txnAt,
          direction: inAmt > 0 ? "in" : "out",
          amount: inAmt > 0 ? inAmt : out,
          balanceAfter: numOrNull(row[cBal]),
          counterparty: peer,
          transType: text(row[cType]),
          transOffice: text(row[cOffice]),
          remark1: text(row[cLabel]) || peer,
          remark2: text(row[cMemo]),
          raw: { source: "excel", bank: "KB", row: row.map((c) => text(c)) },
        });
      }
      return { accountHint: findAccountNo(rows, ["계좌번호"]), period: findPeriod(rows), bankRows, cardRows: [], warnings: [] };
    },
  },
  {
    id: "lotte-card",
    label: "롯데 법인카드",
    kind: "card",
    headerKeys: ["승인일자", "승인시간", "가맹점사업자번호"],
    parse: (rows, headerAt) => {
      const at = columnIndex(rows[headerAt]);
      const [cCard, cDate, cTime, cAmt, cNo, cStore, cType, cLoc, cCorp, cAddr, cBiz] = [
        at("카드번호"), at("승인일자"), at("승인시간"), at("승인금액"), at("승인번호"),
        at("가맹점명"), at("승인구분"), at("국내외사용구분"), at("가맹점사업자번호"), at("가맹점 주소"), at("가맹점 업종"),
      ];
      const cardRows: ParsedCardTxn[] = [];
      let cardNo = "";
      for (const row of rows.slice(headerAt + 1)) {
        const approvedAt = toDateTime(text(row[cDate]), text(row[cTime]));
        if (!approvedAt) continue;
        const amount = num(row[cAmt]);
        if (!amount) continue;
        cardNo = cardNo || text(row[cCard]);
        const typeRaw = text(row[cType]);
        cardRows.push({
          approvedAt,
          approvalNum: text(row[cNo]),
          // 롯데 실측(2026 1분기): 승인구분이 빈 값이면 정상 승인, "매입취소"·"전액승인취소"는 취소.
          // 매입취소는 원 승인 행과 취소 행이 같은 내용으로 2행(드물게 3행) 들어와 상계되는 형태다.
          approvalType: typeRaw ? "취소" : "승인",
          amountTotal: amount,
          storeName: text(row[cStore]),
          storeCorpNum: text(row[cCorp]).replace(/[^0-9]/g, ""),
          storeAddr: text(row[cAddr]),
          storeBizType: text(row[cBiz]),
          paymentPlan: "",
          installmentMonths: "",
          useLocation: text(row[cLoc]),
          cardNoMasked: text(row[cCard]),
          raw: { source: "excel", issuer: "LOTTE", approvalTypeRaw: typeRaw, row: row.map((c) => text(c)) },
        });
      }
      return { accountHint: cardNo || null, period: cardPeriod(cardRows), bankRows: [], cardRows, warnings: [] };
    },
  },
  {
    id: "ibk-card",
    label: "기업은행 법인카드",
    kind: "card",
    headerKeys: ["승인일시", "이용가맹점명", "승인번호"],
    parse: (rows, headerAt) => {
      const at = columnIndex(rows[headerAt]);
      const [cCard, cDt, cAmt, cNo, cStore, cType, cUse, cPlan, cCorp] = [
        at("카드번호"), at("승인일시"), at("승인금액"), at("승인번호"), at("이용가맹점명"),
        at("승인구분"), at("이용구분"), at("할부개월"), at("가맹점사업자번호"),
      ];
      const cardRows: ParsedCardTxn[] = [];
      let cardNo = "";
      for (const row of rows.slice(headerAt + 1)) {
        const approvedAt = toDateTime(text(row[cDt]));
        if (!approvedAt) continue;
        const amount = num(row[cAmt]);
        if (!amount) continue;
        cardNo = cardNo || text(row[cCard]);
        // 취소금액이 승인금액과 같으면 취소 건 — 기업은행은 별도 취소 열로 표기한다.
        const canceled = num(row[at("취소금액")]) > 0;
        cardRows.push({
          approvedAt,
          approvalNum: text(row[cNo]),
          approvalType: canceled ? "취소" : "승인",
          amountTotal: amount,
          storeName: text(row[cStore]),
          storeCorpNum: text(row[cCorp]).replace(/[^0-9]/g, ""),
          storeAddr: "",
          storeBizType: "",
          paymentPlan: text(row[cType]),
          installmentMonths: text(row[cPlan]),
          useLocation: text(row[cType]),
          cardNoMasked: text(row[cCard]),
          raw: { source: "excel", issuer: "IBK", row: row.map((c) => text(c)) },
        });
      }
      return { accountHint: cardNo || null, period: cardPeriod(cardRows), bankRows: [], cardRows, warnings: [] };
    },
  },
];

function cardPeriod(rows: ParsedCardTxn[]): { from: string | null; to: string | null } {
  if (!rows.length) return { from: null, to: null };
  const days = rows.map((r) => r.approvedAt.slice(0, 10)).sort();
  return { from: days[0], to: days[days.length - 1] };
}

export const SUPPORTED_PROFILES = PROFILES.map((p) => ({ id: p.id, label: p.label, kind: p.kind }));

/**
 * 업로드된 엑셀을 양식 자동 판별해 파싱한다.
 * 시트가 여러 개면(롯데=승인내역+영수증) 프로파일이 잡히는 첫 시트를 쓴다.
 */
export function parseStatementWorkbook(buffer: Buffer): ParsedStatement {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[sheetName], { header: 1, raw: false, defval: null });
    for (const profile of PROFILES) {
      const headerAt = findHeaderRow(rows, profile.headerKeys);
      if (headerAt < 0) continue;
      const parsed = profile.parse(rows, headerAt);
      return { profileId: profile.id, profileLabel: profile.label, kind: profile.kind, ...parsed };
    }
  }
  throw Object.assign(
    new Error(
      `지원하는 양식이 아닙니다. 현재 인식 가능한 양식: ${PROFILES.map((p) => p.label).join(" · ")}. ` +
        "은행/카드사 홈페이지에서 받은 원본 엑셀을 그대로 올려 주세요(열을 편집하면 인식하지 못합니다).",
    ),
    { status: 400 },
  );
}

/** 카드번호 매칭용 — 마스킹(****)을 뺀 앞·뒤 숫자만 남긴다. "5105-****-****-*242" → {head:"5105", tail:"242"} */
export function maskedCardParts(masked: string): { head: string; tail: string } {
  const groups = masked.split(/[-\s]/).filter(Boolean);
  const head = (groups[0] ?? "").replace(/[^0-9]/g, "");
  const tail = (groups[groups.length - 1] ?? "").replace(/[^0-9]/g, "");
  return { head, tail };
}
