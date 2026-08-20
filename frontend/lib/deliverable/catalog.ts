/*
 * 착수계·준공계 기본양식 카탈로그 — 5대 발전사 계열 자체양식 6종.
 * 설계: docs/contract-deliverables-blueprint.md §1(실측).
 * 근거 실물:
 *  - 착수계(당진발전본부 2024년 통합환경 변경관리 용역).hwp
 *  - 준공계(수도권매립지관리공사).hwp — 준공검사원·정산동의서·감독신청 3장
 *  - 인천공항에너지 준공 서류(스캔) — 준공내역서·용역결과보고서 2종
 * 라벨의 자간 공백("계   약   명")은 실물 표기이므로 문자열 그대로 보존한다.
 */

import {
  DEFAULT_BODY_PT,
  OMIT_ORDER_NO_KEY,
  parsePhotoRefs,
  type CellSpec,
  type DeliverableKind,
  type DeliverableSpec,
  type DeliverableValues,
  type FieldRow,
  type PhotoAsset,
} from "./types";

// ── 준공 3종 공통 조각 ──

/** 준공검사원·정산동의서·감독신청이 공유하는 머리 8항목(9번은 준공금액 표 캡션). */
const COMPLETION_HEADER_ROWS: FieldRow[] = [
  { label: "계   약   명", binding: "contract.title", format: "text" },
  { label: "계 약  금 액", binding: "contract.amount", format: "amountBoth" },
  { label: "준공기성금액", binding: "completion.currentAmount", format: "amountBoth" },
  { label: "누계준공금액", binding: "completion.cumulativeAmount", format: "amountBoth" },
  { label: "계   약   일", binding: "contract.date", format: "dateKorean" },
  { label: "착   수   일", binding: "contract.startDate", format: "dateKorean" },
  { label: "준공  예정일", binding: "contract.endDate", format: "dateKorean" },
  { label: "실  준 공 일", binding: "completion.actualDate", format: "dateKorean" },
];

/**
 * 준공금액 표 — 2단 헤더(구분 / 전회·금회·누계 × 공급가액·부가세) + 자사 행 + 합계 행.
 * 합계 행은 실물대로 공급가액+부가세를 병합 셀 1칸에 적는다.
 */
function completionAmountTable(): Extract<DeliverableSpec["blocks"][number], { kind: "table" }> {
  const h = (text: string, extra?: Partial<CellSpec>): CellSpec => ({
    text,
    align: "center",
    bold: true,
    ...extra,
  });
  const money = (binding: string): CellSpec => ({ binding, format: "amountNumber", align: "right" });
  return {
    kind: "table",
    caption: "9. 준 공  금 액(단위 : 원)",
    columns: [
      { widthRatio: 0.25, align: "center" }, // 상호가 2줄로 접히지 않도록 넉넉히
      { widthRatio: 0.125, align: "right" },
      { widthRatio: 0.125, align: "right" },
      { widthRatio: 0.125, align: "right" },
      { widthRatio: 0.125, align: "right" },
      { widthRatio: 0.125, align: "right" },
      { widthRatio: 0.125, align: "right" },
    ],
    rows: [
      [
        h("구 분", { rowSpan: 2 }),
        // 앞열 제목은 대금지급단계 수에 따라 달라진다(2단계=전회 / 3단계 이상=기지급) — data.ts 가 값을 채운다
        h("{{meta.priorLabel}}", { colSpan: 2 }),
        { merged: true },
        h("금회", { colSpan: 2 }),
        { merged: true },
        h("누계", { colSpan: 2 }),
        { merged: true },
      ],
      [
        { merged: true },
        h("공급가액"),
        h("부가세"),
        h("공급가액"),
        h("부가세"),
        h("공급가액"),
        h("부가세"),
      ],
      [
        { binding: "company.name", format: "text", align: "center" },
        money("completion.prevSupply"),
        money("completion.prevVat"),
        money("completion.curSupply"),
        money("completion.curVat"),
        money("completion.cumSupply"),
        money("completion.cumVat"),
      ],
      [
        h("합  계"),
        { binding: "completion.prevTotal", format: "amountNumber", align: "right", colSpan: 2 },
        { merged: true },
        { binding: "completion.curTotal", format: "amountNumber", align: "right", colSpan: 2 },
        { merged: true },
        { binding: "completion.cumTotal", format: "amountNumber", align: "right", colSpan: 2 },
        { merged: true },
      ],
    ],
  };
}

/** 준공 3종 공통 서명 블록(계약상대자·주소·상호·대표자). */
const COMPLETION_SIGNATURE_ROWS: FieldRow[] = [
  { label: "계약상대자", binding: "company.name", format: "text" },
  { label: "주      소", binding: "company.address", format: "text" },
  { label: "상      호", binding: "company.name", format: "text" },
  { label: "대  표  자", binding: "company.ceo", format: "text", suffix: "(인)" },
];

/** 준공 3종은 표제·본문 문구만 다르고 나머지 구조가 같다. */
function completionDoc(docType: string, title: string, bodyText: string): DeliverableSpec {
  return {
    docType,
    title,
    kind: "completion",
    blocks: [
      { kind: "title", text: title, letterSpacingPt: 4 },
      { kind: "spacer", heightPt: 18 },
      { kind: "fields", numbering: "decimal", rows: COMPLETION_HEADER_ROWS, rowGapPt: 8 },
      { kind: "spacer", heightPt: 10 },
      completionAmountTable(),
      { kind: "spacer", heightPt: 16 },
      { kind: "para", text: bodyText, align: "left", indentPt: 10, lineHeightPct: 170 },
      { kind: "spacer", heightPt: 24 },
      { kind: "dateLine", binding: "issue.date", format: "dateSpaced", align: "center" },
      { kind: "spacer", heightPt: 18 },
      { kind: "signature", rows: COMPLETION_SIGNATURE_ROWS, align: "right", stamp: true },
      { kind: "spacer", heightPt: 22 },
      { kind: "receiver", binding: "orderer.name", suffix: "귀하", align: "left", bold: true },
    ],
  };
}

// ── 카탈로그 6종 ──

/** 1. 착수계 — 5대 발전사 계열 기본양식(실측: □ 4항목, 계약금액 2행) */
const START_NOTICE: DeliverableSpec = {
  docType: "start_notice",
  title: "착수계",
  kind: "start",
  blocks: [
    { kind: "title", text: "착수계", letterSpacingPt: 5 },
    { kind: "spacer", heightPt: 26 },
    {
      kind: "fields",
      numbering: "square",
      rowGapPt: 12,
      rows: [
        { label: "계 약 명", binding: "contract.title", format: "text" },
        {
          label: "계약금액",
          binding: "contract.amount",
          format: "amountHangul",
          // 실측 2행: "(￦171,500,000) VAT포함"
          secondLine: { text: "(￦{{contract.amount|amountNumber}}) {{meta.vatNote}}" },
        },
        { label: "착수일자", binding: "contract.startDate", format: "dateDotted" },
        { label: "완료일자", binding: "contract.endDate", format: "dateDotted" },
      ],
    },
    { kind: "spacer", heightPt: 22 },
    { kind: "para", text: "상기와 같이 용역을 착수하였기 신고서를 제출합니다.", align: "left" },
    { kind: "spacer", heightPt: 30 },
    { kind: "dateLine", binding: "issue.date", format: "dateDotted", align: "center" },
    { kind: "spacer", heightPt: 22 },
    {
      kind: "signature",
      align: "right",
      stamp: true,
      rows: [
        { label: "주  소", binding: "company.address", format: "text" },
        { label: "상  호", binding: "company.name", format: "text" },
        { label: "대표자", binding: "company.ceo", format: "text", suffix: "(인)" },
      ],
    },
    { kind: "spacer", heightPt: 26 },
    { kind: "receiver", binding: "orderer.name", suffix: "귀하", align: "left", bold: true },
  ],
};

/** 2~4. 준공 3종 세트 — 머리 8항목·준공금액 표 공유, 본문 문구만 상이(실측) */
// 문서명에는 자간용 공백을 넣지 않는다(사용자 확정) — 표제의 넓은 자간은 렌더러가 letterSpacingPt 로 만든다
const COMPLETION_INSPECTION = completionDoc(
  "completion_inspection",
  "준공검사원",
  "위 용역의 도급시행에 있어서 용역 전반에 걸쳐 설계서, 계약문서 및 기타 약정대로 어김없이 준공되었음을 확인하였기에 준공 검사원을 제출하오니 검사하여 주시기 바랍니다."
);

const COMPLETION_SETTLEMENT = completionDoc(
  "completion_settlement",
  "준공금액 정산동의서",
  "상기 계약명의 이행완료와 관련 귀사의 준공 정산금액에 대하여 이의 없이 동의함을 확인합니다."
);

const COMPLETION_SUPERVISION = completionDoc(
  "completion_supervision",
  "준공 감독 신청",
  "위 용역에 대하여 {{contract.date}}부터 {{completion.actualDate}}까지 설계서, 계약문서 및 기타 약정대로 준공되어 감독을 신청합니다."
);

/** 5. 준공내역서 — 인천공항에너지 실측 5항목. 표기는 자사 관행(일금 …원정)으로 통일. */
const COMPLETION_STATEMENT: DeliverableSpec = {
  docType: "completion_statement",
  title: "준공내역서",
  kind: "completion",
  blocks: [
    { kind: "title", text: "준공내역서", letterSpacingPt: 4, underline: true },
    { kind: "spacer", heightPt: 22 },
    {
      kind: "fields",
      numbering: "decimal",
      rowGapPt: 10,
      // 라벨 자간은 렌더러가 최장 라벨 폭에 맞춰 양끝맞춤한다(2026-08-19) — 여기서는 원문만 둔다
      rows: [
        { label: "용역명", binding: "contract.title", format: "text" },
        { label: "용역금액", binding: "contract.amount", format: "amountBoth" },
        { label: "준공금액", binding: "completion.cumulativeAmount", format: "amountBoth" },
        { label: "착수년월일", binding: "contract.startDate", format: "dateKorean" },
        { label: "준공년월일", binding: "completion.actualDate", format: "dateKorean" },
      ],
    },
    { kind: "spacer", heightPt: 40 },
    { kind: "dateLine", binding: "issue.date", format: "dateSpaced", align: "center" },
    { kind: "spacer", heightPt: 20 },
    {
      kind: "signature",
      align: "right",
      stamp: true,
      rows: [
        { label: "주  소", binding: "company.address", format: "text" },
        { label: "상  호", binding: "company.name", format: "text" },
        { label: "대표자", binding: "company.ceo", format: "text", suffix: "(인)" },
      ],
    },
    { kind: "spacer", heightPt: 24 },
    { kind: "receiver", binding: "orderer.name", suffix: "귀하", align: "left", bold: true },
  ],
};

/** 6. 용역결과보고서 — 인천공항에너지 실측 7항목(발주번호·계약기간·첨부자료 포함) */
const SERVICE_RESULT_REPORT: DeliverableSpec = {
  docType: "service_result_report",
  title: "용역결과보고서",
  kind: "completion",
  blocks: [
    { kind: "title", text: "용역결과보고서" },
    { kind: "spacer", heightPt: 22 },
    {
      kind: "fields",
      numbering: "decimal",
      rowGapPt: 10,
      // 라벨 자간은 렌더러가 최장 라벨 폭에 맞춰 양끝맞춤한다(2026-08-19) — 여기서는 원문만 둔다.
      // '준공일'은 실제 준공한 날이므로 표기도 '실준공일'로 명확히 한다(사용자 확정).
      rows: [
        { label: "발주번호", binding: "contract.orderNo", format: "text" },
        { label: "용역명", binding: "contract.title", format: "text" },
        { label: "계약상대자", binding: "company.name", format: "text" },
        { label: "계약기간", binding: "contract.period", format: "period" },
        { label: "착수일", binding: "contract.startDate", format: "dateKorean" },
        { label: "실준공일", binding: "completion.actualDate", format: "dateKorean" },
        { label: "첨부자료", binding: "completion.attachList", format: "multiline" },
      ],
    },
    { kind: "spacer", heightPt: 20 },
    {
      kind: "para",
      text: "위 계약에 대하여 과업내용서에서 요구한 내용과 같이 용역 과업이 완료되었기에 본 용역결과 보고서를 제출합니다.",
      align: "left",
      lineHeightPct: 170,
    },
    { kind: "spacer", heightPt: 30 },
    { kind: "dateLine", binding: "issue.date", format: "dateSpaced", align: "center" },
    { kind: "spacer", heightPt: 20 },
    {
      kind: "signature",
      align: "right",
      stamp: true,
      rows: [
        { label: "업 체 명", binding: "company.name", format: "text" },
        { label: "주    소", binding: "company.address", format: "text" },
        { label: "대    표", binding: "company.ceo", format: "text", suffix: "(인)" },
      ],
    },
    { kind: "spacer", heightPt: 24 },
    { kind: "receiver", binding: "orderer.name", suffix: "대표이사 귀하", align: "left", bold: true },
  ],
};

/**
 * 값에 따른 서식 보정 — 준공금 100%(기지급 0) 계약은 준공금액 표에서 기지급 열을 아예 없애고
 * 금회·누계만 보인다(사용자 확정 2026-08-07). 남은 열은 같은 총폭을 균등 분할한다.
 */
export function adjustSpecForValues(spec: DeliverableSpec, values: Record<string, unknown>): DeliverableSpec {
  // 용역결과보고서 발주번호 제외 토글(2026-08-19 사용자 확정) — 행 자체를 빼고 번호를 당긴다
  if (spec.docType === "service_result_report" && Number(values[OMIT_ORDER_NO_KEY] ?? 0) === 1) {
    spec = {
      ...spec,
      blocks: spec.blocks.map((b) =>
        b.kind === "fields" ? { ...b, rows: b.rows.filter((r) => r.binding !== "contract.orderNo") } : b
      ),
    };
  }
  const prevTotal = Number(values["completion.prevTotal"] ?? 0);
  if (!Number.isFinite(prevTotal) || prevTotal > 0) return spec;
  let touched = false;
  const blocks = spec.blocks.map((b) => {
    if (b.kind !== "table" || b.columns.length !== 7) return b;
    touched = true;
    const dropped = [1, 2]; // 기지급 공급가액·부가세 열
    const keep = <T,>(arr: T[]) => arr.filter((_, i) => !dropped.includes(i));
    const gradeW = (1 - b.columns[0].widthRatio) / 4;
    return {
      ...b,
      columns: [b.columns[0], ...Array.from({ length: 4 }, (_, i) => ({ ...b.columns[i + 3], widthRatio: gradeW }))],
      rows: b.rows.map((row) => keep(row)),
    };
  });
  return touched ? { ...spec, blocks } : spec;
}

/**
 * 7. 대금청구서 — 실측: 2026-대외-01032 동봉본(수도권매립지관리공사 준공 기성금 청구).
 * 준공계 공문에 대부분 함께 요구되어 준공 서류 목록 **마지막**에 둔다(2026-08-19 사용자 확정).
 * ⚠ 실제 산출은 원본 템플릿 경로(payment-hwpx.ts — public/hwpx/payment.hwpx 토큰 치환)가
 * 담당한다. 이 spec 은 목록 노출(제목·docType·바인딩 수집)과 템플릿 실패 시 폴백용 근사다.
 * 청구금액 = 금회 준공 기성금(completion.currentAmount, 기성 자동 채움 값 재사용).
 */
const PAYMENT_REQUEST: DeliverableSpec = {
  docType: "payment_request",
  title: "대금청구서",
  kind: "completion",
  blocks: [
    { kind: "title", text: "대금청구서", letterSpacingPt: 4 },
    { kind: "spacer", heightPt: 26 },
    {
      kind: "table",
      columns: [
        { widthRatio: 0.2, align: "center" },
        { widthRatio: 0.8, align: "left" },
      ],
      rows: [
        [{ text: "계약건명", align: "center", bold: true }, { text: "{{contract.title}}" }],
        [
          { text: "계약금액", align: "center", bold: true },
          { text: "{{contract.amount|amountHangul}}" + "\n" + "(￦{{contract.amount|amountNumber}} {{meta.vatNote}})" },
        ],
        [
          { text: "청구금액", align: "center", bold: true },
          {
            text: "{{meta.stageLabel}} : {{completion.currentAmount|amountHangul}}" + "\n" + "(￦{{completion.currentAmount|amountNumber}} {{meta.vatNote}})",
          },
        ],
        [
          { text: "청 구 인", align: "center", bold: true },
          {
            text: "1) 상    호 : {{company.name}}" + "\n" + "2) 주    소 : {{company.address}}" + "\n" + "3) 대표이사 : {{company.ceo|nameSpread}}   (인)",
            stamp: true,
          },
        ],
      ],
    },
    { kind: "spacer", heightPt: 18 },
    { kind: "para", text: "별 첨 : {{payment.attachNote}}", align: "left", indentPt: 6 },
    { kind: "spacer", heightPt: 26 },
    { kind: "para", text: "위 금액을 정히 청구합니다.", align: "center" },
    { kind: "spacer", heightPt: 26 },
    { kind: "dateLine", binding: "issue.date", format: "dateDotted", align: "center" },
    { kind: "spacer", heightPt: 30 },
    { kind: "receiver", binding: "orderer.name", suffix: "귀하", align: "left", bold: true },
  ],
};

/**
 * 성과품 사진 별첨 페이지(2026-08-19 사용자 확정) — 용역결과보고서 뒤에 붙는 별도 페이지.
 * 좌상단 "첨부자료" 표기 + (명칭 셀 위 / 사진 셀 아래) 표. 사진 비율에 따라 페이지당 1~4장:
 *   · 1~2장          → 1열(2x1 / 4x1 세로 스택) — 방향 불문(2026-08-19 확정: 2열은 3매부터)
 *   · 세로 사진 3~4장 → 2열(4x2 — 2열 x 2세트)
 * 치수는 로드된 사진(PhotoAsset)에서 오므로 generate.ts 가 로드 후 호출한다.
 * 같은 방향(가로/세로)이 연속되는 사진끼리만 한 페이지에 묶는다(순서 보존).
 */
export function buildPhotoAttachmentSpecs(values: DeliverableValues, photos: PhotoAsset[]): DeliverableSpec[] {
  const refs = parsePhotoRefs(values);
  if (!refs.length) return [];
  const caption = (i: number) => refs[i]?.name?.trim() || `성과품 사진 ${i + 1}`;
  // 치수를 모르는 사진(로드 실패)은 가로로 간주 — 크게 한 장씩 배치돼 안전하다
  const isPortrait = (i: number) => {
    const p = photos[i];
    return !!p && p.w > 0 && p.h > p.w;
  };

  // 방향이 같은 연속 구간으로 나눈 뒤, 페이지 용량(가로 2 / 세로 4)씩 끊는다
  const pages: { cols: 1 | 2; idxs: number[] }[] = [];
  let run: number[] = [];
  let runPortrait = false;
  const flush = () => {
    if (!run.length) return;
    const cap = runPortrait ? 4 : 2;
    for (let i = 0; i < run.length; i += cap) {
      const chunk = run.slice(i, i + cap);
      // 2열은 3매 이상부터(2026-08-19 사용자 확정) — 1~2매는 방향 불문 1열(위아래)
      pages.push({ cols: runPortrait && chunk.length >= 3 ? 2 : 1, idxs: chunk });
    }
    run = [];
  };
  refs.forEach((_, i) => {
    const portrait = isPortrait(i);
    if (run.length && portrait !== runPortrait) flush();
    runPortrait = portrait;
    run.push(i);
  });
  flush();

  return pages.map((pg, pi) => ({
    docType: `service_result_photo:${pi}`,
    title: "첨부자료(성과품 사진)",
    kind: "completion",
    blocks: [
      { kind: "note", text: "첨부자료" },
      { kind: "spacer", heightPt: 8 },
      { kind: "photoGrid", cols: pg.cols, items: pg.idxs.map((i) => ({ caption: caption(i), photoIndex: i })) },
    ],
  }));
}

/**
 * HWPX 원본 템플릿이 장(section)을 보유한 서식 — 이 목록만 템플릿 치환 경로(hwpx.ts)로 간다.
 * 준공내역서·용역결과보고서(인천공항에너지 실측)는 템플릿에 장이 없어 spec 렌더(pdf.ts)로
 * 만들고 산출물을 병합한다(generate.ts). ⚠이 분리가 없으면 두 서식이 산출물에서 조용히 빠진다.
 */
export const HWPX_TEMPLATE_DOC_TYPES: Record<DeliverableKind, string[]> = {
  start: ["start_notice"],
  completion: ["completion_inspection", "completion_settlement", "completion_supervision"],
};

/**
 * 발주처 자체양식에도 조합 선택할 수 있는 기본 추가 서식(2026-08-19 사용자 확정) —
 * 발주처 양식이 준공계만 담고 있어도 준공내역서·용역결과보고서(사진 별첨)·대금청구서는
 * 자사 기본 서식으로 함께 낸다(동두천드림파워 실사례). 대금청구서는 별도 원본 템플릿 경로.
 */
export const CATALOG_EXTRA_COMPLETION_TYPES = ["completion_statement", "service_result_report"] as const;
export const CATALOG_ADDON_TYPES = [...CATALOG_EXTRA_COMPLETION_TYPES, "payment_request"] as const;

export const DELIVERABLE_CATALOG: DeliverableSpec[] = [
  START_NOTICE,
  COMPLETION_INSPECTION,
  COMPLETION_SETTLEMENT,
  COMPLETION_SUPERVISION,
  COMPLETION_STATEMENT,
  SERVICE_RESULT_REPORT,
  PAYMENT_REQUEST, // 준공 서류 목록 마지막(사용자 확정)
];

export const CATALOG_BY_TYPE: Record<string, DeliverableSpec> = Object.fromEntries(
  DELIVERABLE_CATALOG.map((d) => [d.docType, d])
);

/** 종류별 기본 선택 서식 — 작성 화면 진입 시 미리 체크된다(가장 흔한 조합). */
export const DEFAULT_DOC_TYPES: Record<DeliverableKind, string[]> = {
  start: ["start_notice"],
  completion: ["completion_inspection", "completion_settlement", "completion_supervision"],
};

export function catalogByKind(kind: DeliverableKind): DeliverableSpec[] {
  return DELIVERABLE_CATALOG.filter((d) => d.kind === kind);
}

/** 문서 표제 폭 산출 등 렌더 공용 기본값 */
export const CATALOG_BODY_PT = DEFAULT_BODY_PT;
