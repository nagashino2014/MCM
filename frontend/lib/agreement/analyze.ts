// 발주처 자체양식(HWPX) 계약서 분석 — AgreementSpec 으로 변환한다(② 확정: spec 기본).
// 착수계 D4(lib/deliverable/template-analyze.ts)와 골격이 같지만 산출물이 다르다:
// 착수계는 원본 좌표 매핑(overlay)이고, 계약서는 조문 수정·삽입이 전제라 **조문 세트를
// 통째로 추출**해 편집 가능한 spec 으로 재구축한다. 갑지 레이아웃은 표준 골격(A형 표 /
// B형 목록형)에 태우고 값 자리는 {{바인딩}} 토큰으로 일반화한다 — 원본 서식 100% 보존이
// 필요한 발주처는 overlay 모드(후속 P4)로 대응한다(블루프린트 §6).

import { anthropicChatJson } from "@/lib/ai/llm-json";
import { parseHwpx } from "@/lib/deliverable/hwpx-doc";
import { outlineHwpx, serializeOutline } from "@/lib/deliverable/template-form";
import { SEED_TEMPLATES } from "./catalog";
import type { AgreementClause, AgreementSpec } from "./types";

const MODEL = process.env.SCRAPER_ANALYZE_MODEL || "claude-sonnet-5";

const BINDING_CATALOG = [
  "- {{contract.title}} (계약명·용역명)",
  "- {{contract.scope}} (용역범위·업무범위 서술)",
  "- {{contract.period}} (계약기간 문구)",
  "- {{orderer.name}} (발주처 상호)",
  "- {{orderer.address}} (발주처 주소)",
  "- {{orderer.ceo}} (발주처 대표자)",
  "- {{company.name}} (수급자=자사 상호)",
  "- {{amount.supplyLine}} (공급가 — 일금 한글 + 숫자)",
  "- {{amount.totalLine}} (합계 — VAT 포함)",
  "- {{payment.summary}} (지급 단계 요약 문구)",
].join("\n");

function buildPrompt(serialized: string): string {
  return (
    "다음은 발주처가 보내온 용역 계약서 양식(HWPX)을 문단·표 좌표로 직렬화한 것입니다. " +
    "이 계약서의 구조를 분석해 아래 JSON 으로 추출하세요.\n\n" +
    "## 추출 항목\n" +
    "1. terms: 당사자 호칭 — orderer(발주 측: 발주자|도급인|갑 등 원문 그대로), contractor(수급 측: 과업수행자|수급인|을 등).\n" +
    '2. clauseNoFormat: 조 번호 표기 — "paren"(제 1 조 (제목)) 또는 "bracket"(제1조 [제목]).\n' +
    "3. coverStyle: 갑지(첫 장) 유형 — \"table\"(표 갑지) 또는 \"list\"(1. 계약명: … 번호 목록형).\n" +
    "4. preamble: 조문 앞 전문(있으면 원문, 회사명·계약명 부분은 아래 바인딩 토큰으로 치환).\n" +
    "5. clauses: 조문 배열 — 각 조의 title(괄호 안 제목만)과 body(항·호 포함 전체 본문 원문 그대로, " +
    "줄바꿈 보존). 계약 건별로 달라지는 값(계약명·회사명·금액·기간·업무범위)은 바인딩 토큰으로 치환하세요. " +
    "대금 지급 방법을 정하는 조는 body 를 빈 문자열로 두고 binding 을 \"payment\" 로 표시하세요" +
    "(그 조는 지급 단계 데이터에서 자동 생성됩니다).\n" +
    "6. closing: 조문 말미의 체결 확약 문구(있으면 원문).\n" +
    "7. note: 분석하며 애매했던 판단·사용자 확인 필요 사항(한국어 한두 문장).\n\n" +
    "## 바인딩 토큰\n" +
    BINDING_CATALOG +
    "\n\n## 출력(JSON만, 설명 금지)\n" +
    '{"terms":{"orderer":"","contractor":""},"clauseNoFormat":"paren","coverStyle":"table",' +
    '"preamble":"","clauses":[{"title":"","body":"","binding":null}],"closing":"","note":""}\n\n' +
    "## 양식 직렬화\n" +
    serialized
  );
}

export interface AgreementAnalysis {
  spec: AgreementSpec;
  note: string | null;
}

let seq = 0;
const clauseId = (i: number) => `an-${Date.now().toString(36)}-${i}-${seq++}`;

/** HWPX 바이트 → AgreementSpec 초안(저장 없음 — 검수 화면에서 보정 후 custom 템플릿으로 저장) */
export async function analyzeAgreementHwpx(bytes: Uint8Array): Promise<AgreementAnalysis> {
  const outline = outlineHwpx(await parseHwpx(bytes));
  if (!outline.paras.length && !outline.tables.length) {
    throw new Error("양식에서 본문을 찾지 못했습니다. HWPX 파일인지 확인하세요.");
  }
  const raw = await anthropicChatJson<unknown>({
    user: buildPrompt(serializeOutline(outline)),
    model: MODEL,
    maxTokens: 16000,
    timeoutMs: 180_000,
  });
  const root = (raw ?? {}) as Record<string, unknown>;
  const termsRaw = (root.terms ?? {}) as Record<string, unknown>;
  const terms = {
    orderer: String(termsRaw.orderer ?? "").trim() || "발주자",
    contractor: String(termsRaw.contractor ?? "").trim() || "과업수행자",
  };
  const clauses: AgreementClause[] = (Array.isArray(root.clauses) ? root.clauses : [])
    .map((c, i): AgreementClause | null => {
      const o = (c ?? {}) as Record<string, unknown>;
      const title = String(o.title ?? "").trim();
      const body = String(o.body ?? "");
      const binding = o.binding === "payment" ? ("payment" as const) : null;
      if (!title) return null;
      if (!binding && !body.trim()) return null;
      return { id: clauseId(i), title, body: binding ? "" : body, binding };
    })
    .filter((c): c is AgreementClause => c !== null);
  if (!clauses.length) {
    throw new Error("양식에서 조문을 추출하지 못했습니다. 표준 셋 복제로 시작해 직접 입력해 주세요.");
  }

  // 갑지 골격 — 표준 A형(표)/B형(목록형에 가까운 1장 갑지) 재사용. 원본 서식 보존은 overlay(후속).
  const coverStyle = root.coverStyle === "list" ? "list" : "table";
  const baseSeed = coverStyle === "table" ? SEED_TEMPLATES[0] : SEED_TEMPLATES[1] ?? SEED_TEMPLATES[0];

  const spec: AgreementSpec = {
    coverBlocks: baseSeed.spec.coverBlocks,
    clausePage: {
      title: "용역 계약 조건",
      preamble: String(root.preamble ?? "").trim() || undefined,
      noFormat: root.clauseNoFormat === "bracket" ? "bracket" : "paren",
      clauses,
      closing: String(root.closing ?? "").trim() || undefined,
      signAfterClosing: true,
    },
    terms,
  };
  return { spec, note: String(root.note ?? "").trim() || null };
}
