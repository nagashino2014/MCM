// 바로빌 계좌조회(BANKACCOUNT.asmx) 래퍼
// 실측(2026-08-15): 응답 컨테이너 <BankAccountLogList> > 반복 <BankAccountTransLog>,
// 국민·기업 모두 거래상대명 = TransRemark1, TransRemark2 = 이체메모.

import {
  getBarobillConfig,
  soapCall,
  pick,
  pickText,
  pickAll,
  isErrCode,
  getErrString,
  expectOk,
  expectString,
  formatBarobillDT,
  splitDateRange,
  BarobillError,
} from "@/lib/barobill/client";

export interface BarobillBankAccount {
  bankCode: string; // KB / IBK / SHINHAN ...
  bankName: string;
  accountNum: string;
  collectCycle: string;
  alias: string;
  usage: string;
}

export interface BarobillBankTransLog {
  transRefKey: string;
  transDT: string; // "YYYY-MM-DD HH:MI:SS"
  direction: "in" | "out" | "etc"; // TransDirection 입금/출금/기타
  deposit: number;
  withdraw: number;
  balance: number | null;
  transType: string;
  transOffice: string;
  remark1: string;
  remark2: string;
  raw: Record<string, string>;
}

// 실측(2026-08-15): GetBankAccountEx2 응답에 Bank(코드) 필드가 없고 BankName(한글)만 온다
// → 로고·코드 매핑을 위해 은행명 → 바로빌 은행코드 변환. (조회 계층에서도 안전망으로 재사용)
export const BANK_NAME_TO_CODE: Record<string, string> = {
  국민은행: "KB", 신한은행: "SHINHAN", 농협은행: "NH", 하나은행: "HANA", 제일은행: "SC",
  우리은행: "WOORI", 기업은행: "IBK", 산업은행: "KDB", 새마을금고: "KFCC", 씨티은행: "CITI",
  수협은행: "SUHYUP", 신협은행: "CU", 신협: "CU", 우체국: "EPOST", 광주은행: "KJBANK",
  전북은행: "JBBANK", 대구은행: "DGB", 부산은행: "BUSANBANK", 경남은행: "KNBANK",
  제주은행: "EJEJUBANK", 케이뱅크: "KBANK", 토스뱅크: "TOSS",
};

// 등록 계좌 목록 (AvailOnly: 0 전체 / 1 사용중 / 2 해지)
export async function getBankAccounts(availOnly: 0 | 1 | 2 = 0): Promise<BarobillBankAccount[]> {
  const { certKey, corpNum } = getBarobillConfig();
  const xml = await soapCall("BANKACCOUNT", "GetBankAccountEx2", {
    CERTKEY: certKey,
    CorpNum: corpNum,
    AvailOnly: availOnly,
  });
  const rows = pickAll(xml, "BankAccountEx");
  const first = rows.length ? pick(rows[0], "BankAccountNum") : null;
  if (first && isErrCode(first)) {
    throw new BarobillError(`GetBankAccountEx2 실패(${first}): ${await getErrString(first)}`, first);
  }
  return rows.map((row) => ({
    bankCode: pickText(row, "Bank") || BANK_NAME_TO_CODE[pickText(row, "BankName")] || "",
    bankName: pickText(row, "BankName"),
    accountNum: pickText(row, "BankAccountNum"),
    collectCycle: pickText(row, "CollectCycle"),
    alias: pickText(row, "Alias"),
    usage: pickText(row, "Usage"),
  }));
}

// 계좌 등록/관리 호스팅 URL (60초 유효) — 자격증명을 앱에 저장하지 않는 권장 등록 경로
export async function getBankAccountManagementUrl(): Promise<string> {
  const { certKey, corpNum, id } = getBarobillConfig();
  const xml = await soapCall("BANKACCOUNT", "GetBankAccountManagementURL", {
    CERTKEY: certKey,
    CorpNum: corpNum,
    ID: id,
    PWD: "",
  });
  return expectString(xml, "GetBankAccountManagementURL");
}

export async function stopBankAccount(accountNum: string): Promise<void> {
  const { certKey, corpNum } = getBarobillConfig();
  const xml = await soapCall("BANKACCOUNT", "StopBankAccount", {
    CERTKEY: certKey,
    CorpNum: corpNum,
    BankAccountNum: accountNum,
  });
  await expectOk(xml, "StopBankAccount");
}

export async function cancelStopBankAccount(accountNum: string): Promise<void> {
  const { certKey, corpNum } = getBarobillConfig();
  const xml = await soapCall("BANKACCOUNT", "CancelStopBankAccount", {
    CERTKEY: certKey,
    CorpNum: corpNum,
    BankAccountNum: accountNum,
  });
  await expectOk(xml, "CancelStopBankAccount");
}

export async function reRegistBankAccount(accountNum: string): Promise<void> {
  const { certKey, corpNum } = getBarobillConfig();
  const xml = await soapCall("BANKACCOUNT", "ReRegistBankAccount", {
    CERTKEY: certKey,
    CorpNum: corpNum,
    BankAccountNum: accountNum,
  });
  await expectOk(xml, "ReRegistBankAccount");
}

function parseTransLog(row: string): BarobillBankTransLog {
  const rawDirection = pickText(row, "TransDirection");
  const direction = rawDirection === "입금" ? "in" : rawDirection === "출금" ? "out" : "etc";
  const raw: Record<string, string> = {};
  for (const tag of [
    "TransRefKey", "TransDirection", "Deposit", "Withdraw", "Balance", "TransDT",
    "TransType", "TransOffice", "TransRemark1", "TransRemark2", "CurrencyCode", "CmsCode", "Memo",
  ]) {
    raw[tag] = pickText(row, tag);
  }
  return {
    transRefKey: raw.TransRefKey,
    transDT: formatBarobillDT(raw.TransDT) ?? raw.TransDT,
    direction,
    deposit: Number(raw.Deposit || 0),
    withdraw: Number(raw.Withdraw || 0),
    balance: raw.Balance === "" ? null : Number(raw.Balance),
    transType: raw.TransType,
    transOffice: raw.TransOffice,
    remark1: raw.TransRemark1,
    remark2: raw.TransRemark2,
    raw,
  };
}

// 기간 입출금내역 전체 페이지 수집 (100건/페이지. 200일 초과 기간은 자동 분할)
export async function fetchBankTransLogs(
  accountNum: string,
  startDate: string, // YYYYMMDD
  endDate: string, // YYYYMMDD
): Promise<BarobillBankTransLog[]> {
  const chunks = splitDateRange(startDate, endDate);
  if (chunks.length > 1) {
    const out: BarobillBankTransLog[] = [];
    for (const chunk of chunks) out.push(...(await fetchBankTransLogs(accountNum, chunk.start, chunk.end)));
    return out;
  }
  const { certKey, corpNum, id } = getBarobillConfig();
  const out: BarobillBankTransLog[] = [];
  let currentPage = 1;
  let maxPage = 1;
  do {
    const xml = await soapCall("BANKACCOUNT", "GetPeriodBankAccountTransLog", {
      CERTKEY: certKey,
      CorpNum: corpNum,
      ID: id,
      BankAccountNum: accountNum,
      StartDate: startDate,
      EndDate: endDate,
      TransDirection: 1, // 전체 (입금+출금 — 출금은 부가세 준비용 원장)
      CountPerPage: 100,
      CurrentPage: currentPage,
      OrderDirection: 1, // ASC (원장 적재는 오래된 것부터)
    });
    const cur = pick(xml, "CurrentPage");
    if (isErrCode(cur)) {
      throw new BarobillError(
        `GetPeriodBankAccountTransLog 실패(${cur}): ${await getErrString(cur!)}`,
        cur!,
      );
    }
    maxPage = parseInt(pick(xml, "MaxPageNum") || "1", 10) || 1;
    for (const row of pickAll(xml, "BankAccountTransLog")) out.push(parseTransLog(row));
    currentPage += 1;
  } while (currentPage <= maxPage);
  return out;
}
