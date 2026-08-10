// 계약서 파생값 조립 (클라/서버 공용: DB import 금지)
// AgreementFieldValues(문서 원본)에서 갑지 바인딩 값(flat map)·조문 전개(번호 재부여·
// 지급방법 조 자동 생성)를 만든다. 갑지 "대금 지급 조건"과 "지급방법" 조문은 payments 배열
// 하나에서 양쪽 문구가 나온다(단일 원천 — 블루프린트 §1 관찰 3).

import { COMPANY_ADDRESS, COMPANY_BIZ_NO, COMPANY_CEO, COMPANY_KO, COMPANY_PHONE } from "@/lib/letter/types";
import { spreadName } from "@/lib/deliverable/format";
import { toHangulAmount } from "@/lib/quote/hangul-amount";
import type { DeliverableValues } from "@/lib/deliverable/types";
import {
  clauseHeading,
  type AgreementClause,
  type AgreementFieldValues,
  type AgreementSpec,
  type PaymentStep,
} from "./types";

export function computeAmounts(supply: number): { supply: number; vat: number; total: number } {
  const s = Math.max(0, Math.floor(supply || 0));
  const vat = Math.floor(s * 0.1);
  return { supply: s, vat, total: s + vat };
}

const fmtWon = (n: number): string => `₩${Math.floor(n).toLocaleString("ko-KR")}`;

/** "일금 육천오백만 원정 (₩65,000,000)" — A형 갑지 금액 행 */
export function amountLine(n: number): string {
  return `일금 ${toHangulAmount(n)} 원정 (${fmtWon(n)})`;
}

/** "금 삼백만원정(₩3,000,000) (부가세별도)" — B형 총 계약금액 행 */
export function amountLineVatSep(n: number): string {
  return `금 ${toHangulAmount(n)}원정(${fmtWon(n)}) (부가세별도)`;
}

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮";

/** 비율 입력 → 금액 자동 분배(마지막 단계가 잔차 흡수) */
export function distributePayments(supply: number, steps: PaymentStep[]): PaymentStep[] {
  const withRatio = steps.filter((p) => p.ratio != null);
  if (!withRatio.length) return steps;
  let used = 0;
  return steps.map((p, i) => {
    if (p.ratio == null) return p;
    const isLastRatio = withRatio[withRatio.length - 1] === steps[i];
    const amount = isLastRatio
      ? Math.max(0, supply - used - steps.filter((q, j) => j > i && q.ratio == null).reduce((a, q) => a + q.amount, 0))
      : Math.floor((supply * p.ratio) / 100);
    used += amount;
    return { ...p, amount };
  });
}

/** 갑지 "대금 지급 조건" 멀티라인 — 실측: "착수금(30%) - 일천구백오십만 원정(₩19,500,000, VAT별도)\n : 계약 완료 후 현금 지급" */
export function paymentSummary(payments: PaymentStep[]): string {
  return payments
    .map((p) => {
      const ratio = p.ratio != null ? `(${p.ratio}%)` : "";
      const head = `${p.label}${ratio} - ${toHangulAmount(p.amount)} 원정(${fmtWon(p.amount)}, VAT별도)`;
      return p.condition ? `${head}\n : ${p.condition}` : head;
    })
    .join("\n");
}

/** "지급방법" 조 본문 자동 생성 — 실측 국도화학 제10조 문형 */
export function paymentClauseBody(payments: PaymentStep[], terms: AgreementSpec["terms"]): string {
  return payments
    .map((p, i) => {
      const mark = CIRCLED[i] ?? `${i + 1}.`;
      const when = p.condition ? `${p.condition.replace(/\s*현금\s*지급\s*$/, "")} ` : "";
      return (
        `${mark} (${p.label} 지불) “${terms.orderer}”는 ${when}일금 ${toHangulAmount(p.amount)} 원정` +
        `(${fmtWon(p.amount)}, VAT별도)을 “${terms.contractor}”가 요청한 계좌로 현금으로 지불하기로 한다.`
      );
    })
    .join("\n");
}

/** 날인 블록 텍스트 — "상호\n주소\n대표이사 이 유 억 (인)" */
function signText(name: string, address: string, ceo: string): string {
  const ceoLine = ceo ? `대표이사 ${spreadName(ceo)}  (인)` : "대표이사              (인)";
  return [name, address, ceoLine].filter(Boolean).join("\n");
}

/** 갑지 렌더용 flat 바인딩 값 — deliverable format.ts(renderTemplate/renderBinding)가 소비한다 */
export function buildCoverValues(fv: AgreementFieldValues): DeliverableValues {
  const { supply, vat, total } = computeAmounts(fv.amountSupply);
  const o = fv.orderer;
  return {
    "orderer.name": o.name,
    "orderer.ceo": o.ceo,
    "orderer.ceoPhone": [o.ceo, o.phone].filter(Boolean).join(" / "),
    "orderer.address": o.address,
    "orderer.bizNo": o.bizNo,
    "orderer.phone": o.phone,
    "orderer.signText": signText(o.name, o.address, o.ceo),
    "company.name": COMPANY_KO,
    "company.nameWithBizNo": `${COMPANY_KO} (${COMPANY_BIZ_NO})`,
    "company.address": COMPANY_ADDRESS,
    "company.ceo": COMPANY_CEO,
    "company.bizNo": COMPANY_BIZ_NO,
    "company.phone": COMPANY_PHONE,
    "company.signText": signText(COMPANY_KO, COMPANY_ADDRESS, COMPANY_CEO),
    "contract.title": fv.title,
    "contract.period": fv.periodText,
    "contract.scope": fv.scopeText,
    "amount.supplyLine": amountLine(supply),
    "amount.vatLine": amountLine(vat),
    "amount.totalLine": amountLine(total),
    "amount.totalVatSep": amountLineVatSep(supply),
    "payment.summary": paymentSummary(fv.payments),
    "issue.date": fv.issueDate,
    "attach.line": fv.attachNote ? `첨부 : ${fv.attachNote}` : "",
  };
}

export interface ResolvedClause {
  no: number;
  heading: string; // "제 1 조 (계약의 목적)"
  body: string; // {{바인딩}} 치환·payment 자동 생성 완료본
}

/** 조문 전개 — 순서대로 번호 재부여 + payment 조 본문 자동 생성 + {{바인딩}} 치환 */
export function resolveClauses(
  clauses: AgreementClause[],
  spec: Pick<AgreementSpec, "terms"> & { clausePage?: { noFormat: "paren" | "bracket" } },
  fv: AgreementFieldValues,
  values: DeliverableValues
): ResolvedClause[] {
  const noFormat = spec.clausePage?.noFormat ?? "paren";
  return clauses.map((c, i) => {
    const raw = c.binding === "payment" ? paymentClauseBody(fv.payments, spec.terms) : c.body;
    const body = raw.replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => String(values[key] ?? ""));
    return { no: i + 1, heading: clauseHeading(i + 1, c.title, noFormat), body };
  });
}
