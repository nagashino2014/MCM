// 홈택스 매입매출조회 (TI.asmx 스크래핑 계열) — 블루프린트 P5 ①
// API 실사(2026-08-17, dev.barobill.co.kr 레퍼런스 + testws TI.asmx WSDL):
//   · 신청 = RegistTaxInvoiceScrapEx(CERTKEY, CorpNum, HometaxLoginMethod ID|CERT, HometaxID, HometaxPWD, ShortJuminNum)
//     신청 후 매일 새벽 전날까지 발급분을 바로빌이 수집 보관. 로그인 정보 변경은 UpdateTaxInvoiceScrapEx.
//   · 조회 = GetMonthlyTaxInvoice{Purchase,Sales}ListEx(CERTKEY, CorpNum, UserID, TaxType, DateType, BaseMonth,
//     CountPerPage, CurrentPage, OrderDirection) — TaxType 1=과세+영세 / 3=면세, DateType 1=작성일자,
//     페이지당 최대 100건. 반환 PagedTaxInvoiceEx2(CurrentPage 음수 = 오류코드).
//   · 국세청 전송완료 상태의 문서만 조회된다(신고 모집단과 일치).
// 홈택스 자격증명(ID/PW)은 바로빌에 전달만 하고 앱에는 저장하지 않는다.

import { createHash } from "node:crypto";
import { getDb, withDbWrite, rowsToObjects } from "@/lib/db";
import {
  soapCall,
  pick,
  pickAll,
  pickText,
  expectOk,
  expectString,
  isErrCode,
  getErrString,
  BarobillError,
  getBarobillConfig,
  formatBarobillDT,
} from "@/lib/barobill/client";

const KST_NOW = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");

const hashId = (prefix: string, source: string) =>
  `${prefix}-${createHash("sha256").update(source).digest("hex").slice(0, 12)}`;

// ── 수집 서비스 신청/변경 ──

export interface ScrapRegistInput {
  loginMethod: "ID" | "CERT"; // 홈택스 아이디 / 바로빌 등록 공동인증서
  hometaxId?: string;
  hometaxPwd?: string;
  shortJuminNum?: string; // 대표자 주민번호 앞 7자리 (ID 방식 필수)
}

async function callScrapRegist(method: "RegistTaxInvoiceScrapEx" | "UpdateTaxInvoiceScrapEx", input: ScrapRegistInput): Promise<void> {
  const { certKey, corpNum } = getBarobillConfig();
  const xml = await soapCall("TI", method, {
    CERTKEY: certKey,
    CorpNum: corpNum,
    HometaxLoginMethod: input.loginMethod,
    HometaxID: input.hometaxId ?? "",
    HometaxPWD: input.hometaxPwd ?? "",
    ShortJuminNum: input.shortJuminNum ?? "",
  });
  await expectOk(xml, method);
}

/** 세금계산서 홈택스 수집 서비스 신청. 이미 신청된 경우 바로빌 오류 메시지가 그대로 올라온다. */
export const registTaxInvoiceScrap = (input: ScrapRegistInput) => callScrapRegist("RegistTaxInvoiceScrapEx", input);
/** 신청된 수집 서비스의 홈택스 로그인 정보 변경. */
export const updateTaxInvoiceScrap = (input: ScrapRegistInput) => callScrapRegist("UpdateTaxInvoiceScrapEx", input);

/** 바로빌 호스팅 신청 페이지 URL(60초 유효) — 자격증명을 앱 서버에 거치지 않는 대안 경로. */
export async function getTaxInvoiceScrapRequestUrl(): Promise<string> {
  const { certKey, corpNum, id } = getBarobillConfig();
  const xml = await soapCall("TI", "GetTaxInvoiceScrapRequestURL", {
    CERTKEY: certKey,
    CorpNum: corpNum,
    UserID: id,
    PWD: "",
  });
  return expectString(xml, "GetTaxInvoiceScrapRequestURL");
}

// ── 월별 조회 ──

export interface HometaxInvoiceRow {
  ntsSendKey: string;
  ntsSendDt: string | null;
  issueDt: string | null;
  writeDate: string | null; // YYYY-MM-DD
  modifyCode: string | null;
  taxType: number; // 1 과세 / 2 영세 / 3 면세
  purposeType: number | null;
  invoicerCorpNum: string | null;
  invoicerCorpName: string | null;
  invoicerCeoName: string | null;
  invoicerAddr: string | null;
  invoicerBizType: string | null;
  invoicerBizClass: string | null;
  invoicerEmail: string | null;
  invoiceeCorpNum: string | null;
  invoiceeCorpName: string | null;
  amountTotal: number;
  taxTotal: number;
  totalAmount: number;
  itemName: string | null;
  remark1: string | null;
  lateIssueYn: number | null;
  raw: Record<string, string>;
}

const ROW_TAGS = [
  "NTSSendKey", "NTSSendDT", "IssueDT", "WriteDate", "ModifyCode", "TaxType", "PurposeType",
  "InvoicerCorpNum", "InvoicerCorpName", "InvoicerCEOName", "InvoicerAddr", "InvoicerBizType", "InvoicerBizClass", "InvoicerEmail",
  "InvoiceeCorpNum", "InvoiceeCorpName",
  "AmountTotal", "TaxTotal", "TotalAmount", "ItemName", "Remark1", "LateIssueYN",
] as const;

function parseRow(xml: string): HometaxInvoiceRow {
  const raw: Record<string, string> = {};
  for (const tag of ROW_TAGS) raw[tag] = pickText(xml, tag);
  const num = (v: string) => Number(String(v ?? "").replace(/[^0-9.-]/g, "") || 0);
  return {
    ntsSendKey: raw.NTSSendKey,
    ntsSendDt: formatBarobillDT(raw.NTSSendDT),
    issueDt: formatBarobillDT(raw.IssueDT),
    writeDate: formatBarobillDT(raw.WriteDate),
    modifyCode: raw.ModifyCode || null,
    taxType: Number(raw.TaxType || 1),
    purposeType: raw.PurposeType ? Number(raw.PurposeType) : null,
    invoicerCorpNum: raw.InvoicerCorpNum || null,
    invoicerCorpName: raw.InvoicerCorpName || null,
    invoicerCeoName: raw.InvoicerCEOName || null,
    invoicerAddr: raw.InvoicerAddr || null,
    invoicerBizType: raw.InvoicerBizType || null,
    invoicerBizClass: raw.InvoicerBizClass || null,
    invoicerEmail: raw.InvoicerEmail || null,
    invoiceeCorpNum: raw.InvoiceeCorpNum || null,
    invoiceeCorpName: raw.InvoiceeCorpName || null,
    amountTotal: num(raw.AmountTotal),
    taxTotal: num(raw.TaxTotal),
    totalAmount: num(raw.TotalAmount),
    itemName: raw.ItemName || null,
    remark1: raw.Remark1 || null,
    lateIssueYn: raw.LateIssueYN ? Number(raw.LateIssueYN) : null,
    raw,
  };
}

/**
 * 월 단위 조회 (페이징 자동 순회).
 * @param direction sales=매출(자사가 공급자) / purchase=매입(자사가 공급받는자)
 * @param taxTypeParam 1=과세+영세 / 3=면세 — 두 번 호출해야 전체가 모인다
 * @param baseMonth YYYYMM
 */
export async function fetchHometaxMonthly(
  direction: "sales" | "purchase",
  taxTypeParam: 1 | 3,
  baseMonth: string,
): Promise<HometaxInvoiceRow[]> {
  const { certKey, corpNum, id } = getBarobillConfig();
  const method = direction === "sales" ? "GetMonthlyTaxInvoiceSalesListEx" : "GetMonthlyTaxInvoicePurchaseListEx";
  const out: HometaxInvoiceRow[] = [];
  let page = 1;
  for (;;) {
    const xml = await soapCall("TI", method, {
      CERTKEY: certKey,
      CorpNum: corpNum,
      UserID: id,
      TaxType: taxTypeParam,
      DateType: 1, // 작성일자 기준 — 부가세 귀속 기간과 일치
      BaseMonth: baseMonth,
      CountPerPage: 100,
      CurrentPage: page,
      OrderDirection: 1,
    });
    const body = pick(xml, `${method}Result`);
    if (!body) throw new BarobillError(`${method} 응답이 비었습니다.`, undefined, method);
    const currentPage = Number(pickText(body, "CurrentPage") || 0);
    if (currentPage < 0) {
      const code = String(currentPage);
      // -32004(수집 내역 없음) 류는 빈 목록으로 취급하지 않고 메시지를 그대로 노출해
      // "수집 미신청" 상태를 화면에서 구분할 수 있게 한다. 단 페이지 초과는 정상 종료.
      if (isErrCode(code)) throw new BarobillError(`${method} 실패(${code}): ${await getErrString(code)}`, code, method);
    }
    const rows = pickAll(body, "SimpleTaxInvoiceEx2").map(parseRow);
    out.push(...rows);
    const maxPage = Number(pickText(body, "MaxPageNum") || 1);
    if (page >= maxPage || rows.length === 0) break;
    page += 1;
  }
  return out;
}

// ── 수집 적재 (원장 불변 — nts_send_key ON CONFLICT DO NOTHING) ──

export interface HometaxSyncResult {
  months: string[];
  fetched: number;
  inserted: number;
  errors: Array<{ month: string; direction: string; error: string }>;
}

const monthOf = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;

/** fromMonth~toMonth(YYYYMM)의 월 목록. */
export function monthRange(fromMonth: string, toMonth: string): string[] {
  const out: string[] = [];
  let y = Number(fromMonth.slice(0, 4));
  let m = Number(fromMonth.slice(4, 6));
  const endY = Number(toMonth.slice(0, 4));
  const endM = Number(toMonth.slice(4, 6));
  while (y < endY || (y === endY && m <= endM)) {
    out.push(`${y}${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * 홈택스 수집분 적재. 기본 범위 = (마지막 적재 작성월 - 1개월) ~ 이번 달, 초회 = 올해 1월부터.
 * 수정세금계산서는 승인번호가 별도라 별건으로 들어온다(합산 시 증감이 자연 반영).
 */
export async function syncHometaxInvoices(range?: { fromMonth: string; toMonth: string }): Promise<HometaxSyncResult> {
  const db = await getDb();
  let fromMonth = range?.fromMonth;
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000);
  const toMonth = range?.toMonth ?? monthOf(nowKst);
  if (!fromMonth) {
    const rows = rowsToObjects(await db.exec(`SELECT max(write_date) AS last_date FROM hometax_tax_invoices`));
    const lastDate = rows[0]?.last_date as string | null;
    if (lastDate) {
      const d = new Date(`${String(lastDate).slice(0, 10)}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - 1); // 지연 전송·수정분 커버 오버랩 1개월
      fromMonth = monthOf(d);
    } else {
      fromMonth = `${nowKst.getFullYear()}0101`.slice(0, 6); // 초회: 올해 1월
    }
  }
  const months = monthRange(fromMonth, toMonth);

  const result: HometaxSyncResult = { months, fetched: 0, inserted: 0, errors: [] };
  const syncId = hashId("fs", `hometax:${Date.now()}`);
  await withDbWrite(async (db2) => {
    await db2.run(
      `INSERT INTO finance_sync_logs (sync_id, kind, target_id, range_from, range_to, status, started_at)
       VALUES ($1, 'hometax', NULL, $2, $3, 'running', $4) ON CONFLICT (sync_id) DO NOTHING`,
      [syncId, months[0] ?? "", months[months.length - 1] ?? "", KST_NOW()],
    );
  });

  outer: for (const month of months) {
    for (const direction of ["purchase", "sales"] as const) {
      for (const taxTypeParam of [1, 3] as const) {
        // 수집 미신청 등 동일 오류가 월마다 반복되면 조기 중단 (첫 달 4콤보가 전부 실패한 경우)
        if (result.errors.length >= 4 && result.fetched === 0) break outer;
        try {
          const rows = await fetchHometaxMonthly(direction, taxTypeParam, month);
          result.fetched += rows.length;
          if (!rows.length) continue;
          await withDbWrite(async (tx) => {
            for (const r of rows) {
              if (!r.ntsSendKey) continue;
              const res = await tx.exec(
                `INSERT INTO hometax_tax_invoices
                   (hti_id, direction, nts_send_key, nts_send_dt, issue_dt, write_date, modify_code,
                    tax_type, purpose_type,
                    invoicer_corp_num, invoicer_corp_name, invoicer_ceo_name, invoicer_addr,
                    invoicer_biz_type, invoicer_biz_class, invoicer_email,
                    invoicee_corp_num, invoicee_corp_name,
                    amount_total, tax_total, total_amount, item_name, remark1, late_issue_yn, raw_json, created_at)
                 VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6, NULLIF($7, ''),
                         $8, $9,
                         NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), NULLIF($13, ''),
                         NULLIF($14, ''), NULLIF($15, ''), NULLIF($16, ''),
                         NULLIF($17, ''), NULLIF($18, ''),
                         $19, $20, $21, NULLIF($22, ''), NULLIF($23, ''), $24, $25::jsonb, $26)
                 ON CONFLICT (nts_send_key) DO NOTHING
                 RETURNING hti_id`,
                [
                  hashId("hti", r.ntsSendKey),
                  direction,
                  r.ntsSendKey,
                  r.ntsSendDt ?? "",
                  r.issueDt ?? "",
                  r.writeDate ?? `${month.slice(0, 4)}-${month.slice(4, 6)}-01`,
                  r.modifyCode ?? "",
                  r.taxType,
                  r.purposeType,
                  r.invoicerCorpNum ?? "",
                  r.invoicerCorpName ?? "",
                  r.invoicerCeoName ?? "",
                  r.invoicerAddr ?? "",
                  r.invoicerBizType ?? "",
                  r.invoicerBizClass ?? "",
                  r.invoicerEmail ?? "",
                  r.invoiceeCorpNum ?? "",
                  r.invoiceeCorpName ?? "",
                  r.amountTotal,
                  r.taxTotal,
                  r.totalAmount,
                  r.itemName ?? "",
                  r.remark1 ?? "",
                  r.lateIssueYn,
                  JSON.stringify(r.raw),
                  KST_NOW(),
                ],
              );
              if (rowsToObjects(res).length > 0) result.inserted += 1;
            }
          });
        } catch (err) {
          result.errors.push({ month, direction, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  }

  await withDbWrite(async (db2) => {
    await db2.run(
      `UPDATE finance_sync_logs SET status = $2, fetched = $3, inserted = $4, error = NULLIF($5, ''), finished_at = $6 WHERE sync_id = $1`,
      [
        syncId,
        result.errors.length ? "error" : "ok",
        result.fetched,
        result.inserted,
        result.errors.map((e) => `${e.month}/${e.direction}: ${e.error}`).join(" | ").slice(0, 900),
        KST_NOW(),
      ],
    );
  });
  return result;
}
