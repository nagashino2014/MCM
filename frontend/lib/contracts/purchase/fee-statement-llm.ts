import { anthropicChatJson, LlmError } from "@/lib/ai/llm-json";
import { hasClaudeApiKey } from "@/lib/ai/claude-client";
import { normalizeFeeStatementDetail, type FeeStatementDetail } from "./type-details";

/**
 * 관리비 명세서 PDF → 월별 청구 내역(333, 2026-11-03 사용자 요청) — Claude 멀티모달 document.
 * 실물 양식 2종(에이스 골드타워 SNSoft 명세서·과천상상자이 관리비 고지서)을 기준으로 당월 부과액계(납기내 금액)·
 * 공급가액·부가세·과세/비과세 합계·납부기한·항목별 금액(과세 구분)을 뽑는다.
 * receipt-parser 와 같이 키 미설정·실패 시 null 을 돌려주고 화면은 수동 입력으로 넘어간다.
 */
export interface FeeStatementParsed extends FeeStatementDetail {
  year: number | null;
  month: number | null;
  buildingName: string;
}

const PROMPT = `사무실 관리비 명세서(관리비 고지서) PDF입니다. 아래 JSON 형식으로만 답하세요(설명 금지).
- year, month: 명세서가 가리키는 부과 연·월("2026년 9월분" → 2026, 9).
- amountDue: "납기내 금액"(= 당월 부과액계, 미납·연체료 제외). 숫자(원).
- supplyAmount / vat: 공급가액, 부가가치세(부가세). taxableTotal: 과세 합계(공급가액+부가세). nontaxTotal: 비과세(면세) 합계.
- dueDate: 납부기한 YYYY-MM-DD.
- buildingName: 건물·관리사무소 이름.
- items: 항목별 금액 목록. 부가세 대상(과세) 항목은 taxType "taxable", 부가세 제외·비과세 항목은 "nontax", 면세 항목은 "exempt".
  항목명은 명세서에 적힌 그대로(예: 전기기본요금, 전기개별(454 kwh), 일반관리비, 수도개별, 장기수선충당금, 승강기유지비, 건물보험료).
  소계·합계·부가가치세·당월부과액계 같은 합산 줄은 items 에 넣지 마세요.
{
  "year": 2026, "month": 9, "amountDue": 497140, "supplyAmount": 416710, "vat": 41670,
  "taxableTotal": 458380, "nontaxTotal": 38760, "dueDate": "2026-11-02", "buildingName": "에이스 골드타워 관리위원회",
  "items": [{ "name": "전기기본요금", "amount": 54736, "taxType": "taxable" }, { "name": "전력기금", "amount": 6068, "taxType": "nontax" }]
}
값을 알 수 없는 칸은 null 로 두세요.`;

export async function parseFeeStatement(pdf: Buffer, opts?: { userId?: string | null; purchaseContractId?: string }): Promise<FeeStatementParsed | null> {
  if (!hasClaudeApiKey()) return null;
  if (pdf.length > 30 * 1024 * 1024) return null; // Anthropic document 제한(32MB) 보호
  try {
    const raw = await anthropicChatJson<Record<string, unknown>>({
      feature: "purchase.fee_statement_parse",
      model: "claude-sonnet-5",
      user: PROMPT,
      attachments: [{ kind: "pdf", base64: pdf.toString("base64") }],
      maxTokens: 3000,
      timeoutMs: 120000,
      userId: opts?.userId ?? null,
      subject: opts?.purchaseContractId ? { type: "purchase_contract", id: opts.purchaseContractId } : null,
    });
    const detail = normalizeFeeStatementDetail(raw);
    const year = toInt(raw.year);
    const month = toInt(raw.month);
    return {
      ...detail,
      year: year != null && year >= 2000 && year <= 2100 ? year : null,
      month: month != null && month >= 1 && month <= 12 ? month : null,
      buildingName: raw.buildingName == null ? "" : String(raw.buildingName).trim(),
    };
  } catch (err) {
    if (err instanceof LlmError) return null;
    throw err;
  }
}

function toInt(v: unknown): number | null {
  const n = Number(String(v ?? "").replace(/[^0-9-]/g, ""));
  return Number.isFinite(n) && v != null && v !== "" ? Math.floor(n) : null;
}
