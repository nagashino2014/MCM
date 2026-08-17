// 연말정산 간소화 PDF → 공제 항목 자동 추출 (블루프린트 P8-①) — Claude 멀티모달 document.
// receipt-parser(P1) 패턴: ANTHROPIC_API_KEY 미설정·파싱 실패 시 null 반환(수동 입력 폴백).
// 간소화 PDF 첫머리의 "소득·세액공제 자료 총괄(요약)" 표를 우선 읽고, 없으면 항목별 페이지에서 합산한다.

import type { YearendInputs } from "@/lib/finance/yearend";

const MODEL = process.env.YEAREND_PARSE_MODEL || "claude-haiku-4-5-20251001";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

const PROMPT = `국세청 연말정산간소화 서비스 PDF입니다. 다음 공제 항목의 연간 합계 금액(원)을 추출해 JSON으로만 답하세요.
값이 없는 항목은 null. 요약(총괄) 표가 있으면 그 값을 우선 사용하세요.
{
  "insurancePremium": 보장성 보험료(일반) 납입액,
  "medicalExpense": 의료비 총액,
  "educationExpense": 교육비 총액,
  "donation": 기부금 총액,
  "pensionAccount": 연금저축계좌+퇴직연금(IRP) 본인 납입액 합계,
  "cardCredit": 신용카드 사용금액,
  "cardCheckCash": 직불카드(체크카드)+현금영수증 사용금액 합계,
  "cardTraditionalTransit": 전통시장+대중교통 사용금액 합계,
  "housingLoanDeduction": 주택임차차입금 원리금상환액+장기주택저당차입금 이자상환액 합계,
  "monthlyRent": 월세액,
  "personName": 자료 대상자 성명
}`;

export interface YearendPdfParseResult {
  inputs: Partial<YearendInputs>;
  personName: string | null;
  model: string;
}

const money = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};

/** 간소화 PDF(base64 없이 Buffer) 파싱. 키 미설정·실패 시 null. */
export async function parseSimplifiedPdf(pdf: Buffer): Promise<YearendPdfParseResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (pdf.length > 30 * 1024 * 1024) return null; // Anthropic document 제한(32MB) 보호
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const inputs: Partial<YearendInputs> = {
      insurancePremium: money(raw.insurancePremium),
      medicalExpense: money(raw.medicalExpense),
      educationExpense: money(raw.educationExpense),
      donation: money(raw.donation),
      pensionAccount: money(raw.pensionAccount),
      cardCredit: money(raw.cardCredit),
      cardCheckCash: money(raw.cardCheckCash),
      cardTraditionalTransit: money(raw.cardTraditionalTransit),
      housingLoanDeduction: money(raw.housingLoanDeduction),
      monthlyRent: money(raw.monthlyRent),
    };
    // undefined 정리
    for (const k of Object.keys(inputs) as Array<keyof YearendInputs>) {
      if (inputs[k] === undefined) delete inputs[k];
    }
    return {
      inputs,
      personName: raw.personName ? String(raw.personName).trim() || null : null,
      model: MODEL,
    };
  } catch {
    return null;
  }
}
