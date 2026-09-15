// 전자세금계산서 (TI.asmx) 커넥터 — 블루프린트 P4 / F5
// WSDL 실사(2026-08-16, testws.baroservice.com/TI.asmx?WSDL)로 요소명·순서 확정:
//   TaxInvoice   = InvoiceKey, InvoicerParty, InvoiceeParty, BrokerParty, InvoiceeASPEmail,
//                  IssueDirection, TaxInvoiceType, TaxType, TaxCalcType, PurposeType, ModifyCode,
//                  Kwon, Ho, SerialNum, Cash, ChkBill, Note, Credit, WriteDate,
//                  AmountTotal, TaxTotal, TotalAmount, Remark1~3, TaxInvoiceTradeLineItems
//   InvoiceParty = ContactID, CorpNum, MgtNum, CorpName, TaxRegID, CEOName, Addr,
//                  BizClass, BizType, ContactName, TEL, HP, Email
//   TaxInvoiceTradeLineItem = PurchaseExpiry, Name, Information(규격), ChargeableUnit(수량),
//                  UnitPrice, Amount, Tax, Description(비고)
//     ⚠ Information 은 계산서 "규격" 열, Description 은 품목행 "비고" 열이다(문서 상단 Remark1 과 별개).
//       2026-08-31 이전에는 Information 을 안 쓰고 규격을 Description 에 넣어 비고 열로 찍혔다.
// ⚠ s:sequence 라 요소 순서를 지켜야 하고, 금액은 문자열(콤마·소수점 불가)이다.

import { soapCall, escXml, rawXml, expectOk, expectString, methodResult, isErrCode, getErrString, BarobillError, getBarobillConfig, pick, pickText } from "@/lib/barobill/client";

/** 상호의 "㈜"는 전자세금계산서에서 거부되므로 "(주)"로 되돌린다(앱 표기 규칙의 역변환). */
export function toPlainCompanyName(name: string | null | undefined): string {
  return String(name ?? "")
    .replace(/㈜/g, "(주)")
    .replace(/㈐|㈜/g, "(주)")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .trim();
}

export interface InvoiceParty {
  contactId?: string; // 공급자 필수 = 바로빌 회원 ID
  corpNum: string;
  mgtNum?: string; // 정발급은 공급자 측 필수(연동사 부여 고유키 ≤24자)
  corpName: string;
  ceoName?: string;
  addr?: string;
  bizClass?: string; // 업종
  bizType?: string; // 업태
  contactName?: string;
  tel?: string;
  hp?: string;
  email?: string;
}

export interface InvoiceLineItem {
  purchaseExpiry: string; // 공급일자 YYYYMMDD
  name: string;
  /** 규격 — 계산서 품목행의 "규격" 열. WSDL 실사: Name 과 ChargeableUnit 사이의 Information. */
  information?: string;
  chargeableUnit?: string; // 수량
  unitPrice?: string;
  amount: string; // 공급가액
  tax: string; // 세액
  /** 비고 — 계산서 품목행의 "비고" 열(문서 상단 Remark1 과 다른 자리다). */
  description?: string;
}

export interface TaxInvoiceInput {
  invoicer: InvoiceParty;
  invoicee: InvoiceParty;
  taxType?: number; // 1 과세 / 2 영세 / 3 면세
  purposeType?: number; // 1 영수 / 2 청구
  writeDate: string; // YYYYMMDD
  amountTotal: string;
  taxTotal: string;
  totalAmount: string;
  remark1?: string;
  remark2?: string;
  modifyCode?: string;
  items: InvoiceLineItem[];
}

const el = (tag: string, value: unknown) => {
  const text = String(value ?? "").trim();
  return text ? `<${tag}>${escXml(text)}</${tag}>` : "";
};

function partyXml(tag: string, p: InvoiceParty): string {
  return (
    `<${tag}>` +
    el("ContactID", p.contactId) +
    el("CorpNum", p.corpNum.replace(/[^0-9]/g, "")) +
    el("MgtNum", p.mgtNum) +
    el("CorpName", toPlainCompanyName(p.corpName)) +
    el("CEOName", p.ceoName) +
    el("Addr", p.addr) +
    el("BizClass", p.bizClass) +
    el("BizType", p.bizType) +
    el("ContactName", p.contactName) +
    el("TEL", p.tel) +
    el("HP", p.hp) +
    el("Email", p.email) +
    `</${tag}>`
  );
}

function invoiceXml(input: TaxInvoiceInput): string {
  const items = input.items
    .map(
      (it) =>
        "<TaxInvoiceTradeLineItem>" +
        el("PurchaseExpiry", it.purchaseExpiry) +
        el("Name", it.name) +
        el("Information", it.information) +
        el("ChargeableUnit", it.chargeableUnit ?? "1") +
        el("UnitPrice", it.unitPrice ?? it.amount) +
        el("Amount", it.amount) +
        el("Tax", it.tax) +
        el("Description", it.description) +
        "</TaxInvoiceTradeLineItem>",
    )
    .join("");
  return (
    partyXml("InvoicerParty", input.invoicer) +
    partyXml("InvoiceeParty", input.invoicee) +
    `<IssueDirection>1</IssueDirection>` + // 정발급
    `<TaxInvoiceType>1</TaxInvoiceType>` + // 세금계산서
    `<TaxType>${input.taxType ?? 1}</TaxType>` +
    `<TaxCalcType>1</TaxCalcType>` +
    `<PurposeType>${input.purposeType ?? 2}</PurposeType>` + // 기성 청구가 기본
    el("ModifyCode", input.modifyCode) +
    el("WriteDate", input.writeDate) +
    el("AmountTotal", input.amountTotal) +
    el("TaxTotal", input.taxTotal) +
    el("TotalAmount", input.totalAmount) +
    el("Remark1", input.remark1) +
    el("Remark2", input.remark2) +
    `<TaxInvoiceTradeLineItems>${items}</TaxInvoiceTradeLineItems>`
  );
}

/** 공동인증서 등록 상태 — 미등록(-31100)이면 발행 자체가 불가하므로 발행 전에 확인한다. */
export async function checkCertValid(): Promise<{ ok: boolean; code: string | null; message: string }> {
  const { certKey, corpNum } = getBarobillConfig();
  const xml = await soapCall("TI", "CheckCERTIsValid", { CERTKEY: certKey, CorpNum: corpNum });
  const result = methodResult(xml, "CheckCERTIsValid");
  if (result === "1") return { ok: true, code: null, message: "인증서 정상" };
  const code = isErrCode(result) ? result! : null;
  const message = code ? await getErrString(code) : `예상 밖 반환값: ${result}`;
  return { ok: false, code, message };
}

/** 즉시 발행 — 성공 시 공급받는자에게 바로빌이 메일을 보낸다. */
export async function registAndIssueTaxInvoice(
  input: TaxInvoiceInput,
  options?: { sendSms?: boolean; forceIssue?: boolean; mailTitle?: string },
): Promise<void> {
  const { certKey, corpNum } = getBarobillConfig();
  const xml = await soapCall("TI", "RegistAndIssueTaxInvoice", {
    CERTKEY: certKey,
    CorpNum: corpNum,
    Invoice: rawXml(invoiceXml(input)),
    SendSMS: options?.sendSms ? "true" : "false",
    ForceIssue: options?.forceIssue ? "true" : "false",
    MailTitle: options?.mailTitle ?? "",
  });
  await expectOk(xml, "RegistAndIssueTaxInvoice");
}

/** 수정세금계산서 사유 코드(국세청 규정 6종). */
export const MODIFY_CODES: Array<{ code: string; label: string; hint: string }> = [
  { code: "1", label: "기재사항 착오정정", hint: "금액 외 기재사항(상호·주소 등)을 잘못 적은 경우" },
  { code: "2", label: "공급가액 변동", hint: "정산·단가 조정 등으로 금액이 바뀐 경우 — 증감분만 발행" },
  { code: "3", label: "환입", hint: "재화가 반품된 경우 — 환입 금액만큼 음수 발행" },
  { code: "4", label: "계약의 해제", hint: "계약이 해제되어 당초 발행을 되돌리는 경우 — 음수 발행" },
  { code: "5", label: "내국신용장 사후개설", hint: "내국신용장이 사후 개설된 경우" },
  { code: "6", label: "착오에 의한 이중발급", hint: "같은 건을 두 번 발행한 경우 — 당초분 취소(음수)" },
];

/**
 * 수정세금계산서 발행 — RegistModifyTaxInvoice(CERTKEY, CorpNum, Invoice, OriginalNTSSendKey).
 * WSDL 실사(2026-08-16): 원본 국세청 승인번호를 별도 파라미터로 받는다(Remark1 아님).
 * Invoice 에는 ModifyCode 가 반드시 들어가야 한다.
 */
export async function registModifyTaxInvoice(input: TaxInvoiceInput, originalNtsSendKey: string): Promise<void> {
  if (!input.modifyCode) throw new BarobillError("수정 사유(ModifyCode)가 필요합니다.");
  const { certKey, corpNum } = getBarobillConfig();
  const xml = await soapCall("TI", "RegistModifyTaxInvoice", {
    CERTKEY: certKey,
    CorpNum: corpNum,
    Invoice: rawXml(invoiceXml(input)),
    OriginalNTSSendKey: originalNtsSendKey,
  });
  await expectOk(xml, "RegistModifyTaxInvoice");
}

export interface TaxInvoiceStateResult {
  mgtKey: string;
  barobillState: number; // 1000 임시 / 3014 발급완료 / 5031 발급 후 취소 …
  ntsSendState: number; // 1 전송전 ~ 4 전송완료 / 5 실패
  ntsSendKey: string | null; // 국세청 승인번호
  ntsSendResult: string | null;
  ntsSendDt: string | null;
  isOpened: number;
  invoiceKey: string | null;
}

export async function getTaxInvoiceState(mgtKey: string): Promise<TaxInvoiceStateResult> {
  const { certKey, corpNum } = getBarobillConfig();
  const xml = await soapCall("TI", "GetTaxInvoiceState", { CERTKEY: certKey, CorpNum: corpNum, MgtKey: mgtKey });
  const body = pick(xml, "GetTaxInvoiceStateResult");
  if (!body) throw new BarobillError("GetTaxInvoiceState 응답이 비었습니다.", undefined, "GetTaxInvoiceState");
  const num = (tag: string) => Number(pickText(body, tag) || 0);
  const text = (tag: string) => pickText(body, tag) || null;
  // 오류는 BarobillState 에 음수로 실려 온다.
  const state = num("BarobillState");
  if (state < 0) {
    throw new BarobillError(`GetTaxInvoiceState 실패(${state}): ${await getErrString(String(state))}`, String(state), "GetTaxInvoiceState");
  }
  return {
    mgtKey: text("MgtKey") ?? mgtKey,
    barobillState: state,
    ntsSendState: num("NTSSendState"),
    ntsSendKey: text("NTSSendKey"),
    ntsSendResult: text("NTSSendResult"),
    ntsSendDt: text("NTSSendDT"),
    isOpened: num("IsOpened"),
    invoiceKey: text("InvoiceKey"),
  };
}

/** 인쇄 화면 URL(바로빌 호스팅) — 보관용 PDF 캡처(converter Chromium)가 이 화면을 그대로 뜬다. */
export async function getTaxInvoicePrintUrl(mgtKey: string): Promise<string> {
  const { certKey, corpNum, id } = getBarobillConfig();
  const xml = await soapCall("TI", "GetTaxInvoicePrintURL", {
    CERTKEY: certKey,
    CorpNum: corpNum,
    MgtKey: mgtKey,
    ID: id,
    PWD: "",
  });
  return expectString(xml, "GetTaxInvoicePrintURL");
}

/** 발행 원본 보기 팝업 URL(바로빌 호스팅). */
export async function getTaxInvoicePopUpUrl(mgtKey: string): Promise<string> {
  const { certKey, corpNum, id } = getBarobillConfig();
  const xml = await soapCall("TI", "GetTaxInvoicePopUpURL", {
    CERTKEY: certKey,
    CorpNum: corpNum,
    MgtKey: mgtKey,
    ID: id,
    PWD: "",
  });
  return expectString(xml, "GetTaxInvoicePopUpURL");
}

/**
 * 임시저장 문서 삭제.
 * ★실측(2026-08-16): 발급완료(3014) 건은 국세청 전송 전이라도 -21003 으로 거부된다.
 *   발급분 정정은 수정세금계산서(RegistModifyTaxInvoice + ModifyCode)뿐이다.
 */
export async function deleteTaxInvoice(mgtKey: string): Promise<void> {
  const { certKey, corpNum } = getBarobillConfig();
  const xml = await soapCall("TI", "DeleteTaxInvoice", { CERTKEY: certKey, CorpNum: corpNum, MgtKey: mgtKey });
  await expectOk(xml, "DeleteTaxInvoice");
}

/** 바로빌 상태코드 → 화면 표기. */
export const BAROBILL_STATE_LABEL: Record<number, string> = {
  1000: "임시저장",
  3014: "발급완료",
  5031: "발급 후 취소",
};
export const NTS_SEND_STATE_LABEL: Record<number, string> = {
  1: "전송전",
  2: "전송중",
  3: "전송중",
  4: "전송완료",
  5: "전송실패",
};
