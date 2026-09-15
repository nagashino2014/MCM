/**
 * 통합환경 허가 검토결과서 LLM 파서(2026-08-24, Claude 멀티모달 — finance-llm 과 동일 패턴).
 * 계약 상세 > 허가 정보의 검토결과서 업로드가 호출한다. PDF 를 document 블록으로 넘겨
 * 허가번호(결정번호)·허가일자·대기/수질 종규모와 배출량·주요 생산품(품목·연간 생산량)을 추출한다.
 * 핵심 정보는 대부분 개요부에 있어 앞 20페이지만 전송한다(토큰 절감·100페이지 제한 회피).
 * ANTHROPIC_API_KEY 미설정 시 null 반환(호출부는 업로드만 하고 파싱 생략을 안내).
 */

import { PDFDocument } from "pdf-lib";
import { claudeMessages } from "@/lib/ai/claude-client";

// 표(종규모·생산량) 정확도가 중요 — 상위 모델 기본.
const MODEL = process.env.PERMIT_REVIEW_MODEL || "claude-sonnet-5";
const MAX_PAGES = 20;

export interface PermitReviewProduct {
  name: string;
  /** 연간 생산량(숫자) — 문서에 없으면 null. */
  amount: number | null;
  unit: string;
}

export interface PermitReviewFields {
  /** 허가(결정)번호 — 예: "제2026-123호". 문서 표기 그대로. */
  permitNo: string;
  /** 허가일자 YYYY-MM-DD. */
  permitDate: string;
  airClass: number | null;
  /** 대기오염물질 발생량(톤/년). */
  airAmount: number | null;
  waterClass: number | null;
  /** 폐수 배출량(㎥/일). */
  waterAmount: number | null;
  products: PermitReviewProduct[];
  model: string;
}

const str = (v: unknown): string => {
  if (v == null) return "";
  const s = String(v).trim();
  return s === "null" ? "" : s;
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** 날짜 정규화 — "2026. 3. 15." / "2026-03-15" / "2026년 3월 15일" → YYYY-MM-DD. */
function normalizeDate(v: unknown): string {
  const s = str(v);
  const m = s.match(/(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})/);
  if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
}

async function toTrimmedPdfBlock(buf: Buffer): Promise<Record<string, unknown>> {
  let data = buf;
  try {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    if (src.getPageCount() > MAX_PAGES) {
      const out = await PDFDocument.create();
      const pages = await out.copyPages(src, Array.from({ length: MAX_PAGES }, (_, i) => i));
      for (const p of pages) out.addPage(p);
      data = Buffer.from(await out.save());
    }
  } catch {
    // 자르기 실패 — 원본 그대로 전송
  }
  return {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: data.toString("base64") },
  };
}

const PROMPT = `이 문서는 한국 통합환경허가(환경오염시설의 통합관리에 관한 법률)의 허가 검토결과서입니다.
문서에 실제로 인쇄된 내용만으로 아래 JSON 을 채워 응답하세요. 설명 없이 JSON 만 출력합니다.

{
  "permitNo": "",        // 허가번호(결정번호) — 문서 표기 그대로 (예: 제2026-123호)
  "permitDate": "",      // 허가일자(결정일자) YYYY-MM-DD
  "airClass": null,      // 대기 종규모(사업장 종별) — 1~5 숫자만. 문서에 없으면 null
  "airAmount": null,     // 대기오염물질 발생량(톤/년) — 숫자만. 없으면 null
  "waterClass": null,    // 수질(폐수) 종규모 — 1~5 숫자만. 없으면 null
  "waterAmount": null,   // 폐수 배출량(㎥/일) — 숫자만. 없으면 null
  "products": [          // 주요 생산품 — 문서의 표 행 그대로, 순서 유지
    { "name": "", "amount": null, "unit": "" }   // 품목명 / 연간 생산량 숫자 / 단위(톤/년 등)
  ]
}

규칙:
- 문서에 없는 값은 빈 문자열 또는 null 로 둡니다. 추측·일반화 금지.
- 종규모는 "1종"이면 1 처럼 숫자만 넣습니다.
- 생산량 숫자는 천단위 구분기호를 제거한 숫자만 넣습니다.
- 생산품 표의 행을 임의로 병합하거나 빼지 않습니다.`;

export async function parsePermitReviewWithLlm(buf: Buffer): Promise<PermitReviewFields | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const block = await toTrimmedPdfBlock(buf);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const r = await claudeMessages({
      feature: "contract.permit_review_parse",
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }],
      signal: controller.signal,
    });
    if (!r.ok) {
      console.warn("[permit-review-llm] HTTP", r.status, r.errorText ?? "");
      return null;
    }
    const text = r.text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const products = (Array.isArray(raw.products) ? raw.products : [])
      .map((p) => ({
        name: str((p as Record<string, unknown>)?.name),
        amount: num((p as Record<string, unknown>)?.amount),
        unit: str((p as Record<string, unknown>)?.unit),
      }))
      .filter((p) => p.name);
    return {
      permitNo: str(raw.permitNo),
      permitDate: normalizeDate(raw.permitDate),
      airClass: num(raw.airClass),
      airAmount: num(raw.airAmount),
      waterClass: num(raw.waterClass),
      waterAmount: num(raw.waterAmount),
      products,
      model: MODEL,
    };
  } catch (err) {
    console.warn("[permit-review-llm] parse error", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
