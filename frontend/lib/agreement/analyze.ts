// 발주처 자체양식(HWPX) 계약서 분석 — AgreementSpec 으로 변환한다(② 확정: spec 기본).
// 착수계 D4(lib/deliverable/template-analyze.ts)와 골격이 같지만 산출물이 다르다:
// 착수계는 원본 좌표 매핑(overlay)이고, 계약서는 조문 수정·삽입이 전제라 **조문 세트를
// 통째로 추출**해 편집 가능한 spec 으로 재구축한다. 갑지 레이아웃은 표준 골격(A형 표 /
// B형 목록형)에 태우고 값 자리는 {{바인딩}} 토큰으로 일반화한다 — 원본 서식 100% 보존이
// 필요한 발주처는 overlay 모드(후속 P4)로 대응한다(블루프린트 §6).

import { anthropicChatJson } from "@/lib/ai/llm-json";
import { parseHwpx } from "@/lib/deliverable/hwpx-doc";
import { outlineHwpx, serializeOutline } from "@/lib/deliverable/template-form";
import type { TemplateProfile, TemplateSlot } from "@/lib/deliverable/types";
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

// ── overlay 분석(148) — 원본 서식을 그대로 두고 값 자리 좌표만 찾는다 ──
// 착수계 D4(lib/deliverable/template-analyze.ts)와 같은 골격이며 산출도 TemplateProfile 로
// 통일한다 — 주입기(lib/deliverable/template-fill.ts fillTemplateHwpx)를 그대로 공유하기 위함.

/** overlay 슬롯이 쓸 수 있는 바인딩 — 값은 lib/agreement/compose.ts buildCoverValues 가 만든다 */
const OVERLAY_BINDINGS: { key: string; label: string }[] = [
  { key: "contract.title", label: "계약명·용역명" },
  { key: "contract.period", label: "계약기간" },
  { key: "contract.scope", label: "용역범위·업무범위(여러 줄)" },
  { key: "orderer.name", label: "발주처 상호" },
  { key: "orderer.ceo", label: "발주처 대표자" },
  { key: "orderer.address", label: "발주처 주소" },
  { key: "orderer.bizNo", label: "발주처 사업자등록번호" },
  { key: "orderer.phone", label: "발주처 전화번호" },
  { key: "orderer.signText", label: "발주처 날인 블록(상호/주소/대표이사, 여러 줄)" },
  { key: "company.name", label: "수급자(자사) 상호" },
  { key: "company.address", label: "자사 주소" },
  { key: "company.bizNo", label: "자사 사업자등록번호" },
  { key: "company.signText", label: "자사 날인 블록(여러 줄)" },
  { key: "amount.supplyLine", label: "공급가 — 일금 …원정 (₩…)" },
  { key: "amount.vatLine", label: "세액 — 일금 …원정 (₩…)" },
  { key: "amount.totalLine", label: "합계(VAT 포함) — 일금 …원정 (₩…)" },
  { key: "amount.totalVatSep", label: "총액(부가세별도 표기) — 금 …원정(₩…) (부가세별도)" },
  { key: "payment.summary", label: "대금 지급 조건 전체(단계별, 여러 줄)" },
  { key: "issue.dateKorean", label: "체결일 — YYYY년 MM월 DD일" },
];

function buildOverlayPrompt(serialized: string): string {
  return (
    "다음은 발주처가 보내온 용역 계약서 양식(HWPX)을 문단·표 좌표로 직렬화한 것입니다. " +
    "이 양식의 **값이 들어갈 자리**를 찾아 아래 바인딩 키에 매핑하세요.\n" +
    "양식을 다시 만드는 것이 아니라, 원본 서식을 그대로 두고 값을 채워 넣을 좌표를 찾는 작업입니다.\n\n" +
    "## 바인딩 키\n" +
    OVERLAY_BINDINGS.map((b) => `- ${b.key} (${b.label})`).join("\n") +
    "\n\n## 매핑 규칙\n" +
    '1. 표 안의 값 자리는 target="cell" 로 {table,row,col} 을 지정합니다. ' +
    "'계 약 명', '공급가' 같은 **라벨 셀은 값 자리가 아닙니다** — 그 라벨에 대응하는 " +
    "빈 셀 또는 샘플 값이 든 셀이 대상입니다.\n" +
    '2. 표 밖 문단의 값 자리는 target="para" 로 {para} 를 지정하고, label 에 **값 앞에 인쇄된 ' +
    '라벨을 원문 그대로**(자간 공백 포함) 적으세요. 주입 시 그 라벨 뒤부터를 값으로 교체합니다.\n' +
    '2-1. 값 뒤에 고정 문구가 붙는 자리는 suffix 에 그 문구를 원문 그대로 적으세요.\n' +
    "3. 라벨만 있고 값이 비어 있어도 매핑 대상입니다(빈 양식을 주는 발주처가 많습니다).\n" +
    "4. **조문(제N조 …)은 매핑하지 마세요** — overlay 는 조문을 원본 그대로 둡니다. " +
    "갑지(첫 장 표·머리 항목)와 말미 서명·날인 블록만 대상입니다.\n" +
    "5. 계약금액이 공급가/세액/합계로 나뉘어 있으면 각각 amount.supplyLine / amount.vatLine / " +
    "amount.totalLine 로, 한 칸에 총액만 있으면 amount.totalVatSep 또는 amount.totalLine 중 " +
    "양식 표기에 가까운 것으로 매핑하세요.\n" +
    "6. 날인 블록처럼 여러 줄이 한 칸에 든 자리는 orderer.signText / company.signText 로 매핑하세요.\n" +
    "7. 확신이 없어도 가장 그럴듯한 매핑을 내세요 — 사용자가 화면에서 확인합니다. " +
    "다만 값 자리가 아닌 것이 분명한 곳(안내 문구, 고정 문장)은 매핑하지 마세요.\n" +
    "8. 애매했던 판단은 note 에 한국어 한두 문장으로 적으세요.\n\n" +
    "## 출력(JSON만, 설명 금지)\n" +
    '{"slots":[{"target":"cell","table":0,"row":0,"col":0,"binding":"","label":""},' +
    '{"target":"para","para":0,"binding":"","label":"","suffix":""}],"note":""}\n\n' +
    "## 양식 직렬화\n" +
    serialized
  );
}

export interface AgreementOverlayAnalysis {
  profile: TemplateProfile;
  /** 매핑되지 않은 주요 바인딩 — 검수 화면 경고용 */
  unmapped: string[];
  note: string | null;
}

/** HWPX 바이트 → overlay 슬롯 매핑(저장 없음). 좌표 실체와 대조해 허위 매핑을 버린다. */
export async function analyzeAgreementOverlay(bytes: Uint8Array): Promise<AgreementOverlayAnalysis> {
  const outline = outlineHwpx(await parseHwpx(bytes));
  if (!outline.paras.length && !outline.tables.length) {
    throw new Error("양식에서 본문을 찾지 못했습니다. HWPX 파일인지 확인하세요.");
  }
  const raw = await anthropicChatJson<unknown>({
    user: buildOverlayPrompt(serializeOutline(outline)),
    model: MODEL,
    maxTokens: 8000,
    timeoutMs: 180_000,
  });
  const root = (raw ?? {}) as Record<string, unknown>;
  const int = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  const seen = new Set<string>();
  const slots: TemplateSlot[] = (Array.isArray(root.slots) ? root.slots : [])
    .map((s): TemplateSlot | null => {
      const x = (s ?? {}) as Record<string, unknown>;
      const binding = String(x.binding ?? "").trim();
      const label = String(x.label ?? "").trim();
      if (!binding) return null;
      if (x.target === "cell") {
        const table = int(x.table);
        const row = int(x.row);
        const col = int(x.col);
        if (table == null || row == null || col == null) return null;
        const t = outline.tables[table];
        if (!t || !t.cells.some((c) => c.row === row && c.col === col)) return null; // 없는 셀
        return { target: "cell" as const, table, row, col, binding, label };
      }
      const para = int(x.para);
      if (para == null || !outline.paras[para]) return null;
      const suffix = String(x.suffix ?? "").trim() || undefined;
      if (!label && !suffix) return null; // 값 범위를 정할 수 없다
      return { target: "para" as const, para, binding, label, suffix };
    })
    .filter((s): s is TemplateSlot => s !== null)
    .filter((s) => {
      const key = s.target === "cell" ? `c${s.table}:${s.row}:${s.col}` : `p${s.para}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (!slots.length) {
    throw new Error("양식에서 값을 넣을 자리를 찾지 못했습니다. spec 모드로 등록하거나 화면에서 직접 지정해 주세요.");
  }

  const mapped = new Set(slots.map((s) => s.binding));
  const CORE = ["contract.title", "orderer.name", "amount.totalLine", "amount.supplyLine", "payment.summary", "contract.period"];
  const unmapped = CORE.filter((k) => !mapped.has(k));

  return {
    profile: {
      analyzedAt: new Date().toISOString(),
      model: MODEL,
      docs: [{ docType: "custom:agreement", title: "계약서", slots }],
      note: String(root.note ?? "").trim() || undefined,
    },
    unmapped,
    note: String(root.note ?? "").trim() || null,
  };
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
    // A형 갑지 골격이면 HWPX 도 실측 표준 템플릿 보존 경로를 탄다
    hwpxTemplate: baseSeed.spec.hwpxTemplate,
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
