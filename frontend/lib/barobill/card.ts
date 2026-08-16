// 바로빌 카드조회(CARD.asmx) 래퍼 — 매입내역(PURCHASE) 전용 [블루프린트 B2]
// 실측(2026-08-15):
//  · BC·롯데 모두 Amount(공급가액)=0 → 공급가액 = ApprovalAmount - Tax 역산 (호출부 책임)
//  · 롯데 UseDate=null → 사용일시는 ApprovalDT 사용 (BC는 초 단위 정확)
//  · 온라인 결제는 가맹점이 PG사로 잡힘 → PG 사업자번호는 분류 학습 사전에서 제외
//  · 중복키 = CardNum + HistoryKey (공식 가이드)

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

export interface BarobillCard {
  cardCompanyCode: string; // BC / LOTTE ...
  cardCompanyName: string;
  cardNum: string;
  cardType: string; // C / P
  collectTarget: string; // PURCHASE
  collectCycle: string; // DAY1
  alias: string;
  usage: string;
}

export interface BarobillCardPurchase {
  historyKey: string;
  approvalType: string; // 승인/취소/부분취소/거절/환불
  approvalNum: string;
  approvedAt: string; // "YYYY-MM-DD HH:MI:SS"
  useDate: string | null; // "YYYY-MM-DD" (롯데 null)
  amountTotal: number; // ApprovalAmount
  taxAmount: number;
  serviceCharge: number;
  storeCorpNum: string; // 해외결제 등 미제공 시 ""
  storeName: string;
  storeCeo: string;
  storeAddr: string;
  storeBizType: string;
  storeCorpType: number | null;
  storeTaxType: number | null;
  isPurchased: boolean;
  paymentPlan: string;
  installmentMonths: string;
  useLocation: string;
  isDebit: boolean;
  raw: Record<string, string>;
}

// 등록 카드 목록 (AvailOnly: 0 전체 / 1 사용중 / 2 해지)
export async function getCards(availOnly: 0 | 1 | 2 = 0): Promise<BarobillCard[]> {
  const { certKey, corpNum } = getBarobillConfig();
  const xml = await soapCall("CARD", "GetCards", {
    CERTKEY: certKey,
    CorpNum: corpNum,
    CollectTarget: "ALL",
    AvailOnly: availOnly,
  });
  const rows = pickAll(xml, "CardInfo");
  const first = rows.length ? pick(rows[0], "CardNum") : null;
  if (first && isErrCode(first)) {
    throw new BarobillError(`GetCards 실패(${first}): ${await getErrString(first)}`, first);
  }
  return rows.map((row) => ({
    cardCompanyCode: pickText(row, "CardCompanyCode"),
    cardCompanyName: pickText(row, "CardCompanyName"),
    cardNum: pickText(row, "CardNum"),
    cardType: pickText(row, "CardType"),
    collectTarget: pickText(row, "CollectTarget"),
    collectCycle: pickText(row, "CollectCycle"),
    alias: pickText(row, "Alias"),
    usage: pickText(row, "Usage"),
  }));
}

// 카드 등록/관리 호스팅 URL (60초 유효)
export async function getCardManagementUrl(): Promise<string> {
  const { certKey, corpNum, id } = getBarobillConfig();
  const xml = await soapCall("CARD", "GetCardManagementURL", {
    CERTKEY: certKey,
    CorpNum: corpNum,
    ID: id,
    PWD: "",
  });
  return expectString(xml, "GetCardManagementURL");
}

export async function stopCard(cardNum: string): Promise<void> {
  const { certKey, corpNum } = getBarobillConfig();
  const xml = await soapCall("CARD", "Stop", {
    CERTKEY: certKey,
    CorpNum: corpNum,
    CollectTarget: "PURCHASE",
    CardNum: cardNum,
  });
  await expectOk(xml, "Stop");
}

export async function cancelStopCard(cardNum: string): Promise<void> {
  const { certKey, corpNum } = getBarobillConfig();
  const xml = await soapCall("CARD", "CancelStop", {
    CERTKEY: certKey,
    CorpNum: corpNum,
    CollectTarget: "PURCHASE",
    CardNum: cardNum,
  });
  await expectOk(xml, "CancelStop");
}

export async function reRegisterCard(cardNum: string): Promise<void> {
  const { certKey, corpNum } = getBarobillConfig();
  const xml = await soapCall("CARD", "ReRegister", {
    CERTKEY: certKey,
    CorpNum: corpNum,
    CollectTarget: "PURCHASE",
    CardNum: cardNum,
  });
  await expectOk(xml, "ReRegister");
}

// 즉시 수집 요청 — 수집 중이면 -51008("이미 수집중") → 정상으로 간주
export async function refreshCardNow(cardNum: string): Promise<{ alreadyRunning: boolean }> {
  const { certKey, corpNum, id } = getBarobillConfig();
  const xml = await soapCall("CARD", "RefreshNow", {
    CERTKEY: certKey,
    CorpNum: corpNum,
    ID: id,
    CollectTarget: "PURCHASE",
    CardNum: cardNum,
  });
  try {
    await expectOk(xml, "RefreshNow");
    return { alreadyRunning: false };
  } catch (err) {
    if (err instanceof BarobillError && err.code === "-51008") return { alreadyRunning: true };
    throw err;
  }
}

function parsePurchase(row: string): BarobillCardPurchase {
  const raw: Record<string, string> = {};
  for (const tag of [
    "HistoryKey", "ApprovalType", "ApprovalNum", "ApprovalDT", "UseDate",
    "ApprovalAmount", "Amount", "Tax", "ServiceCharge", "CurrencyCode",
    "StoreNum", "StoreCorpNum", "StoreName", "StoreCeo", "StoreAddr",
    "StoreBizType", "StoreTel", "StoreCorpType", "StoreTaxType",
    "Issuer", "PaymentPlan", "InstallmentMonths", "UseLocation", "IsDebit", "IsPurchased", "Memo",
  ]) {
    raw[tag] = pickText(row, tag);
  }
  return {
    historyKey: raw.HistoryKey,
    approvalType: raw.ApprovalType,
    approvalNum: raw.ApprovalNum,
    approvedAt: formatBarobillDT(raw.ApprovalDT) ?? raw.ApprovalDT,
    useDate: formatBarobillDT(raw.UseDate),
    amountTotal: Number(raw.ApprovalAmount || 0),
    taxAmount: Number(raw.Tax || 0),
    serviceCharge: Number(raw.ServiceCharge || 0),
    storeCorpNum: raw.StoreCorpNum,
    storeName: raw.StoreName,
    storeCeo: raw.StoreCeo,
    storeAddr: raw.StoreAddr,
    storeBizType: raw.StoreBizType,
    storeCorpType: raw.StoreCorpType === "" ? null : Number(raw.StoreCorpType),
    storeTaxType: raw.StoreTaxType === "" ? null : Number(raw.StoreTaxType),
    isPurchased: raw.IsPurchased === "true",
    paymentPlan: raw.PaymentPlan,
    installmentMonths: raw.InstallmentMonths,
    useLocation: raw.UseLocation,
    isDebit: raw.IsDebit === "true",
    raw,
  };
}

// 기간 매입내역 전체 페이지 수집 (100건/페이지. 200일 초과 기간은 자동 분할)
export async function fetchCardPurchases(
  cardNum: string,
  startDate: string, // YYYYMMDD
  endDate: string, // YYYYMMDD
): Promise<BarobillCardPurchase[]> {
  const chunks = splitDateRange(startDate, endDate);
  if (chunks.length > 1) {
    const out: BarobillCardPurchase[] = [];
    for (const chunk of chunks) out.push(...(await fetchCardPurchases(cardNum, chunk.start, chunk.end)));
    return out;
  }
  const { certKey, corpNum, id } = getBarobillConfig();
  const out: BarobillCardPurchase[] = [];
  let currentPage = 1;
  let maxPage = 1;
  do {
    const xml = await soapCall("CARD", "GetPurchaseHistories", {
      CERTKEY: certKey,
      CorpNum: corpNum,
      ID: id,
      CardNum: cardNum,
      StartDate: startDate,
      EndDate: endDate,
      CountPerPage: 100,
      CurrentPage: currentPage,
      OrderDirection: 1, // ASC
    });
    const cur = pick(xml, "CurrentPage");
    if (isErrCode(cur)) {
      throw new BarobillError(`GetPurchaseHistories 실패(${cur}): ${await getErrString(cur!)}`, cur!);
    }
    maxPage = parseInt(pick(xml, "MaxPageNum") || "1", 10) || 1;
    for (const row of pickAll(xml, "CardPurchaseHistory")) out.push(parsePurchase(row));
    currentPage += 1;
  } while (currentPage <= maxPage);
  return out;
}
