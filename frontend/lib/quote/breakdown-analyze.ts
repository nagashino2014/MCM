// 산출내역서(엑셀) → 업무 항목 트리 자동 구성 (2026-10-01, 복수 업무 견적의 '항목 입력(자동)').
// 발주처가 제시한 산출내역서의 세부 업무단위·등급별 투입인력(인·일)을 LLM 으로 항목화한다.
// 결과는 작성 화면의 항목 트리 편집기에 채워질 뿐 저장하지 않는다(사용자가 확인·수정 후 역산).

import * as XLSX from "xlsx";
import { anthropicChatJson } from "@/lib/ai/llm-json";
import { LABOR_GRADES, sortGrades, type QuoteTreeRow, type QuoteWorkTag } from "@/lib/quote/types";

const MODEL = process.env.QUOTE_BREAKDOWN_MODEL || "claude-sonnet-5";
const MAX_ROWS_PER_SHEET = 400;
const MAX_CHARS = 90_000;

export interface BreakdownAnalysis {
  grades: string[];
  rows: QuoteTreeRow[];
  note: string;
}

type Cell = string | number | boolean | null;

function cellText(v: Cell): string {
  if (v == null) return "";
  // 수식 캐시 값의 부동소수 꼬리(19.199999999999996) 정리
  if (typeof v === "number") return String(Math.round(v * 1000) / 1000);
  return String(v).replace(/\s+/g, " ").trim();
}

/** 통합문서 → LLM 입력 텍스트. 시트별 `R{행}: 셀 | 셀` (빈 행 생략, 수식은 캐시된 값) */
export function serializeWorkbook(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name], { header: 1, raw: true, defval: null });
    const lines: string[] = [];
    rows.slice(0, MAX_ROWS_PER_SHEET).forEach((row, ri) => {
      const cells = (row ?? []).map(cellText);
      while (cells.length && !cells[cells.length - 1]) cells.pop();
      if (cells.some(Boolean)) lines.push(`R${ri + 1}: ${cells.join(" | ")}`);
    });
    if (lines.length) parts.push(`### 시트 "${name}"\n${lines.join("\n")}`);
  }
  return parts.join("\n\n").slice(0, MAX_CHARS);
}

function buildPrompt(serialized: string, works: QuoteWorkTag[]): string {
  const worksHint = works.length
    ? "## 이 견적의 구성 업무(사용자 지정 — 세분류 × 횟수)\n" +
      works.map((w) => `- ${w.subtype} × ${w.count}회`).join("\n") +
      "\n구성 업무는 대항목 구분과 건수 해석의 참고 정보입니다. 산출내역서의 수량과 다르면 산출내역서를 따르고 note 에 차이를 적으세요.\n\n"
    : "";
  return (
    "다음은 환경 인허가 용역 발주처가 제시한 산출내역서(엑셀)를 시트·행 단위로 직렬화한 것입니다. " +
    "직접인건비 산출 근거가 되는 **세부 업무단위와 기술등급별 투입인력(인·일, MD)** 을 추출해 견적 업무 항목 트리로 정리하세요.\n\n" +
    worksHint +
    "## 규칙\n" +
    "1. 트리는 2단계입니다. 업무 구분(예: 변경허가·신고 / 사후관리 / 재검토)은 대항목(isParent=true, md 는 빈 객체), " +
    "그 아래 세부 업무단위는 세부항목(isParent=false)으로, 문서에 나온 순서대로 나열하세요. 세부항목은 직전 대항목에 소속됩니다.\n" +
    `2. 기술등급은 ${LABOR_GRADES.join("·")} 중 산출내역서에 실제로 MD 가 배정된 등급만 grades 에 넣으세요(문서의 열 머리 기준). ` +
    "기술자 등급 표기가 다르면(예: 책임·선임) 가장 가까운 등급으로 옮기고 note 에 적으세요.\n" +
    "3. 세부항목의 md 는 **용역 전체 기간·전체 건수 기준의 총 투입 MD** 입니다. 세부내역이 '1건당'·'1회당'·'연간' 단가로 적혀 있고 " +
    "종합표(합계)에서 건수·횟수·연수를 곱해 합산한다면, 세부항목에 그 배수를 곱한 값을 넣어 등급별 합계가 종합표의 합계와 일치하게 하세요.\n" +
    "4. 소계·합계·금액·노임단가·제경비·기술료·직접경비(인쇄비·출장비)·손해배상 공제료 행은 항목으로 만들지 마세요. " +
    "단가 산출 근거로만 쓰인 참고 시트(과거 실행 내역 등)의 행도 항목으로 만들지 마세요.\n" +
    "5. label 은 문서의 업무명을 그대로 쓰되 앞의 기호(○, -, 가., 가) 등)는 떼고, 대항목은 '1. ', 세부항목은 '1.1 ' 형식의 번호를 붙이세요. " +
    "건수·횟수가 곱해진 항목은 label 끝에 '(6건)'처럼 수량을 적으세요.\n" +
    "6. MD 는 숫자(소수 둘째 자리까지)로, 0 인 등급은 생략하세요.\n" +
    "7. note 에는 등급별 MD 합계와 종합표 대조 결과, 해석이 필요했던 부분을 한국어 1~3문장으로 적으세요. " +
    "업무 항목·투입인력을 찾을 수 없으면 items 를 빈 배열로 두고 note 에 이유를 적으세요.\n\n" +
    "## 출력(JSON만, 설명 금지)\n" +
    '{"grades":["특급","고급"],"items":[{"label":"1. 대항목","isParent":true,"md":{}},{"label":"1.1 세부항목","isParent":false,"md":{"특급":1.5,"고급":3}}],"note":""}\n\n' +
    "## 산출내역서 직렬화\n" +
    serialized
  );
}

function sanitize(raw: unknown): BreakdownAnalysis {
  const root = (raw ?? {}) as Record<string, unknown>;
  const valid = new Set<string>(LABOR_GRADES);
  const rows: QuoteTreeRow[] = (Array.isArray(root.items) ? root.items : [])
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      const isParent = o.isParent === true;
      const baseMd: Record<string, number> = {};
      if (!isParent) {
        for (const [g, v] of Object.entries((o.md ?? {}) as Record<string, unknown>)) {
          const n = Math.round(Number(v) * 100) / 100;
          if (valid.has(g) && Number.isFinite(n) && n > 0) baseMd[g] = n;
        }
      }
      return { label: String(o.label ?? "").trim().slice(0, 200), isParent, baseMd };
    })
    .filter((r) => r.label && (r.isParent || Object.keys(r.baseMd).length > 0))
    .slice(0, 120);
  // 등급 축 = 실제 MD 가 있는 등급(LLM 이 선언한 grades 는 참고 — 값 없는 등급 열을 만들지 않는다)
  const used = new Set(rows.flatMap((r) => Object.keys(r.baseMd)));
  return { grades: sortGrades([...used]), rows, note: String(root.note ?? "").trim().slice(0, 600) };
}

export async function analyzeBreakdownXlsx(buffer: Buffer, works: QuoteWorkTag[], userId?: string | null): Promise<BreakdownAnalysis> {
  const serialized = serializeWorkbook(buffer);
  if (!serialized.trim()) return { grades: [], rows: [], note: "엑셀에서 읽을 수 있는 내용이 없습니다." };
  const raw = await anthropicChatJson({
    feature: "quote.breakdown_analyze",
    model: MODEL,
    user: buildPrompt(serialized, works),
    maxTokens: 12000,
    timeoutMs: 150_000,
    userId,
  });
  return sanitize(raw);
}
