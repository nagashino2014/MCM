/**
 * 회사 프로필 재무·신용 문서 LLM 파서 (Claude 멀티모달, credential-llm 과 동일 패턴).
 * - 재정상황: 홈택스 표준재무제표만 허용 — 표준재무제표가 아니면 isStandard=false 로 거부.
 *   연도별 자본금·자산총계·부채총계·자기자본(자본총계)·매출액·영업이익을 원 단위 숫자로 추출.
 * - 신용평가 등급: 평가등급서에서 신용평가회사·평가 종류·등급·평가일을 추출.
 */

import { PDFDocument } from "pdf-lib";
import { toContentBlock } from "@/lib/company/credential-llm";

const DEFAULT_MODEL = process.env.BUSINESS_CERT_MODEL || "claude-haiku-4-5-20251001";
// 재무제표는 숫자 정밀도가 중요(항목·열 혼동 시 실제값과 다른 금액이 들어감) — 상위 모델 기본.
const FINANCE_MODEL = process.env.FINANCE_PARSE_MODEL || "claude-sonnet-5";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

const str = (v: unknown): string => {
  if (v == null) return "";
  const s = String(v).trim();
  return s === "null" ? "" : s;
};

/**
 * PDF 를 앞 maxPages 페이지만 남긴 document 블록으로 변환(뒤쪽 약관·부속 페이지 토큰 절감).
 * PDF 가 아니거나 자르기 실패 시 기존 toContentBlock 경로(원본 그대로).
 */
async function toTrimmedPdfBlock(file: File, maxPages: number): Promise<Record<string, unknown>> {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  if (ext === "pdf") {
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      if (src.getPageCount() > maxPages) {
        const out = await PDFDocument.create();
        const pages = await out.copyPages(src, Array.from({ length: maxPages }, (_, i) => i));
        for (const p of pages) out.addPage(p);
        const bytes = await out.save();
        return {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: Buffer.from(bytes).toString("base64") },
        };
      }
    } catch {
      // 자르기 실패 — 원본 그대로 전송
    }
  }
  return toContentBlock(file);
}

async function callLlm(
  block: Record<string, unknown>,
  prompt: string,
  maxTokens: number,
  model: string = DEFAULT_MODEL
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`문서 분석 API 오류 (HTTP ${res.status}) ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("문서 분석 결과를 해석하지 못했습니다.");
  return JSON.parse(match[0]) as Record<string, unknown>;
}

export interface FinanceParsedRow {
  year: string;
  capital: string;
  totalAssets: string;
  totalLiabilities: string;
  equity: string;
  revenue: string;
  operatingProfit: string;
}

const FINANCE_PROMPT =
  "이 파일이 한국 국세청 홈택스에서 출력한 표준재무제표증명(표준재무상태표·표준손익계산서 등 '표준' 서식)인지 먼저 판별하세요. " +
  "일반 재무제표·감사보고서·결산서 등 표준재무제표가 아니면 isStandard=false 로만 답하세요.\n" +
  "표준재무제표가 맞으면 아래 항목을 **지정된 서식의 지정된 행에서만** 추출해 JSON만 출력하세요(설명·코드블록 금지).\n" +
  "추출 규칙(매우 중요):\n" +
  "· 문서에 인쇄된 숫자만 사용하세요. 표준재무제표증명의 금액은 원 단위입니다(콤마 제거한 정수 문자열로. 단, 문서가 천원 단위로 표기됐으면 1000을 곱해 원 단위로 환산).\n" +
  "· 각 서식에는 당기(YYYY년)·전기(YYYY년) 두 열이 있습니다 — **연도별로 해당 연도 열의 값만** 사용해 rows 에 연도당 1행씩 만드세요.\n" +
  "· 서로 다른 항목에 같은 금액을 넣게 되면 행을 잘못 읽은 것입니다. 해당 행 라벨을 다시 확인하세요.\n" +
  "· 추출 후 자체 검증: totalAssets = totalLiabilities + equity (자산총계=부채총계+자본총계)가 성립해야 합니다. 다르면 다시 읽으세요.\n" +
  "항목 정의:\n" +
  "- year: 회계연도(YYYY). 예: '제9기 2024.01.01~2024.12.31' → \"2024\".\n" +
  "- capital: **표준재무상태표**의 자본 부(部)에 있는 '자본금' 행. ('자산총계'·'부채및자본총계'가 아님)\n" +
  "- totalAssets: 표준재무상태표 '자산총계' 행.\n" +
  "- totalLiabilities: 표준재무상태표 '부채총계' 행.\n" +
  "- equity: 표준재무상태표 '자본총계' 행(자기자본). ('부채및자본총계'·'자산총계'와 혼동 금지)\n" +
  "- revenue: **표준손익계산서**의 '매출액' 행.\n" +
  "- operatingProfit: 표준손익계산서의 '영업이익' 행. ('당기순이익'·'매출총이익'이 아님)\n" +
  "값이 문서에 없으면 빈 문자열.\n" +
  '{"isStandard":true,"rows":[{"year":"","capital":"","totalAssets":"","totalLiabilities":"","equity":"","revenue":"","operatingProfit":""}]}';

/** 홈택스 표준재무제표 파싱(정밀도 위해 상위 모델). 키 미설정이면 null. 표준이 아니면 isStandard=false. */
export async function parseFinancialStatementWithLlm(
  file: File
): Promise<{ isStandard: boolean; rows: FinanceParsedRow[] } | null> {
  const raw = await callLlm(await toContentBlock(file), FINANCE_PROMPT, 3000, FINANCE_MODEL);
  if (!raw) return null;
  const isStandard = raw.isStandard === true;
  const rowsRaw = Array.isArray(raw.rows) ? raw.rows : [];
  const rows: FinanceParsedRow[] = rowsRaw
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return {
        year: str(o.year),
        capital: str(o.capital),
        totalAssets: str(o.totalAssets),
        totalLiabilities: str(o.totalLiabilities),
        equity: str(o.equity),
        revenue: str(o.revenue),
        operatingProfit: str(o.operatingProfit),
      };
    })
    .filter((r) => r.year);
  return { isStandard, rows };
}

export interface CreditParsedFields {
  agency: string;
  ratingType: string;
  creditGrade: string;
  ratedAt: string;
}

const creditPrompt = (fileName: string): string =>
  "이 파일은 한국 신용평가기관이 발급한 기업 신용평가 등급확인서(평가등급서)입니다. " +
  "아래 필드를 추출해 JSON만 출력하세요(설명·코드블록 금지). 문서에 인쇄된 글자만 사용하고 값이 없으면 빈 문자열.\n" +
  `참고: 업로드 파일명은 "${fileName}" 이며, 관례상 파일명 맨 앞에 신용평가회사명이 표기됩니다 — ` +
  "agency 판단에 참고하되 문서 내 표기가 있으면 문서를 우선하세요.\n" +
  "- agency: 신용평가회사명(예: 나이스평가정보, 이크레더블, 한국평가데이터).\n" +
  "- ratingType: 평가 종류(예: 기업신용평가등급, 조달청 신용평가등급 등 문서의 평가 구분 표기).\n" +
  "- creditGrade: 신용등급(예: BBB0, BB+, A- 등 표기 그대로).\n" +
  "- ratedAt: 평가일 또는 발급일 (YYYY-MM-DD).\n" +
  '{"agency":"","ratingType":"","creditGrade":"","ratedAt":""}';

/** 신용평가 등급서 파싱 — 필요한 항목은 1~3페이지에만 있어 PDF 앞 3페이지만 전송. 키 미설정이면 null. */
export async function parseCreditRatingWithLlm(file: File): Promise<CreditParsedFields | null> {
  const raw = await callLlm(await toTrimmedPdfBlock(file, 3), creditPrompt(file.name), 800);
  if (!raw) return null;
  return {
    agency: str(raw.agency),
    ratingType: str(raw.ratingType),
    creditGrade: str(raw.creditGrade),
    ratedAt: str(raw.ratedAt),
  };
}
