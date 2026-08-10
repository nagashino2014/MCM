// 계약서 표준 셋 카탈로그 — 코드 상수 시드 (클라/서버 공용: DB import 금지)
// 착수계 기본양식(lib/deliverable/catalog.ts) 관례와 동일하게, 표준 셋은 DB 에 시드하지 않고
// 코드 상수로 둔다. 기준 관리 화면에서 세분류별 목록을 만들 때 DB(agreement_templates)에
// 같은 (대분류, 세분류) 활성 행이 있으면 DB 가 우선하고, 없으면 이 시드가 폴백된다(seeded=true).
// 사용자가 시드를 편집하면 그 시점에 DB 로 복사(fork)된다.
//
// 실측 원본(2026-08-10 사용자 제공 hwpx 6종):
// - A형(표준 도급계약서): 국도화학 경인/부산 허가재검토(16개조)를 표준으로 삼고 사업장 고유
//   문구를 바인딩으로 일반화. 코리아써키트(15개조)식 변형 문구는 조항 라이브러리 후속(P4).
// - B형(HAPs 1장 갑지): "계약서 양식_HAPs 변경신고서" — 표 하나로 완결, 별지 조문 없음.

import type { DocBlock } from "@/lib/deliverable/types";
import type { AgreementClause, AgreementSpec, AgreementTemplateRow } from "./types";

// ── A형 갑지 — "도 급 계 약 서" (국도화학·코리아써키트 공통 골격) ──

const COVER_A: DocBlock[] = [
  {
    kind: "table",
    columns: [{ widthRatio: 0.12, align: "center" }, { widthRatio: 0.18, align: "center" }, { widthRatio: 0.7 }],
    rows: [
      [{ text: "도 급 계 약 서", colSpan: 3, align: "center", bold: true }, { merged: true }, { merged: true }],
      [
        { text: "계 약\n당사자", rowSpan: 3, align: "center", bold: true },
        { text: "발주자", align: "center" },
        { binding: "orderer.name" },
      ],
      [{ merged: true }, { text: "계약상대자\n상호", align: "center" }, { binding: "company.name" }],
      [{ merged: true }, { text: "사업자\n등록번호", align: "center" }, { binding: "company.bizNo" }],
      [
        { text: "계 약\n내 용", rowSpan: 6, align: "center", bold: true },
        { text: "계  약  명", align: "center" },
        { binding: "contract.title" },
      ],
      [{ merged: true }, { text: "계약금액\n공급가", align: "center" }, { binding: "amount.supplyLine" }],
      [{ merged: true }, { text: "세액", align: "center" }, { binding: "amount.vatLine" }],
      [{ merged: true }, { text: "합계", align: "center" }, { binding: "amount.totalLine" }],
      [{ merged: true }, { text: "대금 지급 조건", align: "center" }, { binding: "payment.summary", format: "multiline" }],
      [{ merged: true }, { text: "계 약 기 간", align: "center" }, { binding: "contract.period" }],
    ],
  },
  { kind: "spacer", heightPt: 10 },
  {
    kind: "para",
    text:
      "{{orderer.name}}(“발주자”)와 {{company.name}}(“계약상대자”)는 본 계약서와 첨부의 계약문서에 의하여 " +
      "상기 용역에 대한 계약을 체결하고 신의에 따라 성실히 계약상의 의무를 이행할 것을 확약하며 " +
      "이 계약의 증거로서 계약서를 작성하여 당사자가 기명날인한 후 각각 1통씩 보관한다.",
  },
  { kind: "spacer", heightPt: 8 },
  { kind: "dateLine", binding: "issue.date", format: "dateKorean", align: "center" },
  { kind: "para", text: "{{attach.line}}" },
  { kind: "spacer", heightPt: 16 },
  {
    kind: "table",
    columns: [
      { widthRatio: 0.15, align: "center" },
      { widthRatio: 0.35 },
      { widthRatio: 0.15, align: "center" },
      { widthRatio: 0.35 },
    ],
    rows: [
      [
        { text: "“발주자” :", bold: true },
        { binding: "orderer.signText", format: "multiline" },
        { text: "“계약상대자” :", bold: true },
        { binding: "company.signText", format: "multiline" },
      ],
    ],
  },
];

// ── A형 조문 16개조 — 국도화학 실측을 표준으로 일반화 ──
// id 는 조항 라이브러리(P4)에서의 안정 키. 번호는 렌더 시 순서대로 재부여된다.

const CLAUSES_A: AgreementClause[] = [
  {
    id: "purpose",
    title: "계약의 목적",
    body: "본 계약은 과업수행자가 발주자의 “{{contract.title}}” 업무(이하 “업무”라 함)를 수행함에 있어 필요한 제반사항을 정함을 목적으로 한다.",
  },
  {
    id: "scope",
    title: "계약의 업무범위",
    body:
      "① 과업수행자가 발주자에게 제공하는 업무의 범위는 다음과 같다.\n" +
      "{{contract.scope}}\n" +
      "② 업무 수행에 필요한 자료 및 증빙서류 등은 발주자가 제공한다. 단 본 용역에 필요한 추가 자가측정 및 도면작성 등은 당사자간 협의를 통해 별도의 계약으로 추진한다.",
  },
  {
    id: "period",
    title: "계약기간",
    body: "본 계약기간은 {{contract.period}}로 한다.",
  },
  {
    id: "commence",
    title: "용역의 착수",
    body:
      "① 과업수행자는 용역계약 체결일로부터 1개월 이내에 아래의 내용이 포함된 관련서류를 제출하여 발주자의 승인을 득한 후 용역을 착수하여야 한다.\n" +
      "  1. 용역수행 계획서(용역범위, 수행내용, 공정예정표, 수행인력 및 조직, 직무 및 책임)\n" +
      "  2. 보안서약서(용역수행 및 참여자 전원)\n" +
      "② 과업수행자는 계약이행 중 업무내용, 수행인력 등 주요 내용의 변경으로 제1항의 규정에 의하여 제출한 서류의 변경이 필요한 때에는 사전에 발주자에게 승인을 득한 후 관련 서류를 변경하여 제출하여야 한다.\n" +
      "③ 발주자는 과업수행자가 제출한 각종 자료의 내용이 발주자가 요구하는 과업의 목적에 적합하지 않거나 미흡한 경우에는 수정 및 보완을 요구할 수 있으며, 과업수행자는 해당 사항을 즉시 시정하여야 한다.",
  },
  {
    id: "qualification",
    title: "과업수행자의 자격",
    body:
      "① 과업수행자는 이 용역의 효과적 수행을 위하여 발주자가 요구하는 해당분야에 충분한 경험과 지식을 가지고 있는 전문인력을 투입하여야 한다.\n" +
      "② 과업수행자는 발주자와 협의 하에 사업담당 책임자를 임명하여 계약기간 중 공정관리 및 기타 본 용역에 관련되는 제반 부대사항을 책임 수행하도록 한다.\n" +
      "③ 발주자가 과업수행자의 투입인력(사업담당 책임자 포함)에 대하여 본 용역의 수행에 부적합하다고 판단하여 교체를 요구한 경우에는 정당한 사유가 없는 한 즉시 교체하여야 한다.",
  },
  {
    id: "materials",
    title: "자료의 제공",
    body:
      "① 과업수행자가 용역수행에 필요한 자료를 발주자에게 요청할 경우에 발주자는 이에 협조해야 하며, 과업수행자는 자료를 충분히 검토, 확인 후 계획서에 반영하여야 한다.\n" +
      "② 과업수행자는 본 용역수행을 위해 발주자로부터 제공받은 모든 자료를 본 용역 이외의 어떠한 목적으로도 사용할 수 없다.\n" +
      "③ 과업수행자는 본 용역과 관련하여 수집한 자료와 도서 등에 대해 발주자가 요청 시 특별한 사유가 없는 한 제출하여야 한다.\n" +
      "④ 과업수행자는 본 계약기간 종료 후에도 발주자가 관련 자료의 제출, 용역결과 내용에 대한 설명을 요청할 경우에는 이에 적극 협조하여야 한다.",
  },
  {
    id: "management",
    title: "용역관리",
    body:
      "① 발주자는 과업수행자의 용역수행 과정을 진도 보고 등을 통해 점검할 수 있다.\n" +
      "② 발주자는 과업수행자의 용역수행 과정이 본 용역계약 내용에 부합 한지를 관리‧감독할 수 있으며, 이에 과업수행자는 성실하게 응대하여야 한다.",
  },
  {
    id: "completion",
    title: "용역의 완료",
    body: "용역의 완료는 발주자가 승인한 성과물을 관계기관에 제출하여 최종 검토결과서 등을 받음으로써 완료된다.",
  },
  {
    id: "final-report",
    title: "용역결과의 최종보고",
    body:
      "① 용역의 최종 결과물과 관련한 제출서류는 발주자의 승인을 받아 작성되어야 하며, 과업수행자는 최종결과물 작성 시 수록내용에 대해 발주자의 과업담당자와 사전협의 후 작성·제출하여야 한다.\n" +
      "② 제1항에 의한 최종결과물은 초안을 발주자에게 제출하여 사전검토를 받아야 하며, 과업수행자는 최종 완료된 성과물에 대하여는 파일로 납품하여야 한다.\n" +
      "③ 발주자는 제1항 및 제2항에 의해 제출된 최종결과물의 검토 및 평가과정에서 도출된 의견이 보고서에 반영될 수 있도록 과업수행자에게 보고서 내용의 보완 또는 수정을 요구할 수 있으며, 과업수행자는 발주자가 요구하는 바를 보완 또는 수정하여 제출하여야 한다.",
  },
  {
    id: "payment",
    title: "용역금액의 지급방법",
    body: "",
    binding: "payment",
  },
  {
    id: "warranty",
    title: "하자 보증 및 자료의 보증",
    body:
      "① 과업수행자는 발주자에게 제공한 용역 결과물에 대하여 일체의 하자가 없음을 보증한다.\n" +
      "② 과업수행자가 제공한 용역 결과물에 하자가 발견(부실작성) 또는 발생되었을 경우에는 과업수행자는 자신의 책임과 부담으로 지체 없이 하자를 보완하여야 한다.",
  },
  {
    id: "no-transfer",
    title: "권리의무 등 양도금지",
    body:
      "① 양 당사자는 서면에 의한 상대방의 사전 서면 승낙 없이 기본계약에 의한 어떠한 권리, 의무의 전부 또는 일부를 제3자에게 양도, 담보제공, 기타 어떠한 처분행위를 할 수 없다.\n" +
      "② 과업수행자는 계약된 업무를 하도급 하거나 재위탁하여서는 아니 된다. 다만 성과물 작성의 신속성과 효율성을 위하여 하도급, 재위탁이 필요한 경우에는 사전에 발주자의 승인을 득하여야 한다.",
  },
  {
    id: "security",
    title: "보안",
    body:
      "① 과업수행자는 본 사업 계약 체결 후 사업장에서 제공받아 습득한 일체의 정보는 직무상 기밀사항임을 인식하고, 이 기밀이 외부로 누설되거나 공개되지 않도록 한다.\n" +
      "② 과업수행자는 본 계약 관계를 유지하는 동안 과업수행자로서 의무를 수행하고 발주자와 계약한 업무의 수행에 필요한 내용에 한정하여 취급하여야 하며, 그 정보에 접근하는 자를 본 사업의 참여자로 한정하여야 한다.\n" +
      "③ 과업수행자는 계약된 업무와 관련하여 정보의 공개가 반드시 필요한 경우, 발주자의 적법한 권한을 가진 임원의 승인을 받은 후 공개할 수 있다.\n" +
      "④ 과업수행자는 본 조항을 위반한 경우, 이로 인한 발주자가 입게 된 손해를 배상하고 모든 민형사상 책임을 지게 될 수 있음을 인지하고, 반드시 지켜질 수 있도록 한다.",
  },
  {
    id: "liability",
    title: "책임, 기타",
    body:
      "① 용역을 수행함에 있어 과업수행자의 고의, 과실, 위약 등으로 발생되는 발주자의 인적, 물적 손실을 보상하여야 한다.\n" +
      "② 과업수행자는 용역수행 중 과업내용서의 세부내용이 불분명하거나 상호 모순되는 사항이 있을 경우에는 발주자와 협의하여 해당 내용을 수정할 수 있다.\n" +
      "③ 과업내역에 명시되지 않은 사항일지라도 용역 진행상 부가적으로 시행되어야 할 경미한 사항에 대하여는 이 용역의 업무 범위에 포함된 것으로 본다.\n" +
      "④ 과업수행에 필요한 기본 자료는 최신 정보를 수집하여 반영하되 출처 및 근거를 명확히 한다.",
  },
  {
    id: "termination",
    title: "계약의 해제 또는 해지",
    body:
      "“발주자” 또는 “과업수행자”는 상대방이 본 계약 사항을 위반하는 경우, 서면통지로써 계약을 해지할 수 있으며, 상대방은 계약 해지로 “발주자” 또는 “과업수행자”가 입은 손해를 배상하여야 한다. " +
      "계약당사자의 고의 또는 중과실로 인하여 상대방에게 손해를 가한 경우, 위반자는 해당 손해를 배상하여야 하며, 손해배상액은 당사자 사이의 총 계약금을 한도로 한다.",
  },
  {
    id: "jurisdiction",
    title: "합의관할",
    body:
      "본 계약과 관련하여 분쟁이 발생하는 경우에 상호 협의에 의해 원만히 해결하는 것을 원칙으로 하되, 만일 소송이 진행될 경우에는 “발주자”의 소송지 관할 법원을 관할 법원으로 한다.",
  },
];

const SPEC_A: AgreementSpec = {
  coverBlocks: COVER_A,
  clausePage: {
    title: "용역계약 조건",
    preamble:
      "{{orderer.name}}(이하 “발주자”라 함)과 {{company.name}}(이하 “과업수행자”라 함) 간에 " +
      "“{{contract.title}}” 대행에 관한 계약(이하 “본 계약”이라 함)을 다음과 같이 체결한다.",
    noFormat: "paren",
    clauses: CLAUSES_A,
    closing: "위와 같이 계약하며, 발주자와 과업수행자가 기명날인한 후 각각 1부씩 보관한다.",
    signAfterClosing: true,
  },
  terms: { orderer: "발주자", contractor: "과업수행자" },
};

// ── B형 갑지 — HAPs 1장 계약서 (표 하나로 완결, 별지 없음) ──

const COVER_B: DocBlock[] = [
  {
    kind: "table",
    columns: [{ widthRatio: 0.1, align: "center" }, { widthRatio: 0.22, align: "center" }, { widthRatio: 0.68 }],
    rows: [
      [{ text: "용 역 계 약 서", colSpan: 3, align: "center", bold: true }, { merged: true }, { merged: true }],
      [
        { text: "계\n약\n자", rowSpan: 6, align: "center", bold: true },
        { text: "발주자(갑) 상호", align: "center" },
        { binding: "orderer.name" },
      ],
      [{ merged: true }, { text: "사업자등록번호", align: "center" }, { binding: "orderer.bizNo" }],
      [{ merged: true }, { text: "대표자 / 전화번호", align: "center" }, { binding: "orderer.ceoPhone" }],
      [{ merged: true }, { text: "주 소", align: "center" }, { binding: "orderer.address" }],
      [{ merged: true }, { text: "수급자(을) 상호", align: "center" }, { binding: "company.nameWithBizNo" }],
      [{ merged: true }, { text: "주 소", align: "center" }, { binding: "company.address" }],
      [
        { text: "계\n약\n내\n용", rowSpan: 5, align: "center", bold: true },
        { text: "용  역  명", align: "center" },
        { binding: "contract.title" },
      ],
      [{ merged: true }, { text: "총 계약금액", align: "center" }, { binding: "amount.totalVatSep" }],
      [{ merged: true }, { text: "결 재 조 건", align: "center" }, { binding: "payment.summary", format: "multiline" }],
      [{ merged: true }, { text: "용 역 기 간", align: "center" }, { binding: "contract.period" }],
      [{ merged: true }, { text: "기 타 사 항", align: "center" }, { binding: "contract.scope", format: "multiline" }],
    ],
  },
  { kind: "spacer", heightPt: 10 },
  {
    kind: "para",
    text:
      "“갑” {{orderer.name}}와 “을” {{company.name}}은 상기내용과 같이 계약을 체결하고 신의에 따라 상호간에 " +
      "계약서상의 의무를 성실히 이행할 것을 확약하며, 이 계약을 증명하기 위해 본 계약서를 작성하여 당사자가 " +
      "기명날인 후 각각 1통씩 보관하기로 한다. 용역 진행 중 사업상 비밀, 용역성과물 등의 자료는 비밀로 유지하며, " +
      "제3자에게 자료를 제공해서는 아니 된다.",
  },
  { kind: "spacer", heightPt: 8 },
  { kind: "dateLine", binding: "issue.date", format: "dateKorean", align: "center" },
  { kind: "spacer", heightPt: 16 },
  {
    kind: "table",
    columns: [
      { widthRatio: 0.13, align: "center" },
      { widthRatio: 0.37 },
      { widthRatio: 0.13, align: "center" },
      { widthRatio: 0.37 },
    ],
    rows: [
      [
        { text: "[발주자]", bold: true },
        { binding: "orderer.signText", format: "multiline" },
        { text: "[수급자]", bold: true },
        { binding: "company.signText", format: "multiline" },
      ],
    ],
  },
];

const SPEC_B: AgreementSpec = {
  coverBlocks: COVER_B,
  terms: { orderer: "갑", contractor: "을" },
};

// ── 시드 매핑 — 실측 양식이 있는 세분류만. 나머지는 기준 관리 화면에서 "미지정"으로 노출된다. ──

export interface SeedTemplate {
  templateId: string; // 'agt-std-' + slug — DB 로 fork 되기 전의 가상 id
  name: string;
  serviceType: string;
  serviceSubtypes: string[]; // 이 시드가 폴백으로 걸리는 세분류들
  spec: AgreementSpec;
}

export const SEED_TEMPLATES: SeedTemplate[] = [
  {
    templateId: "agt-std-permit-general",
    name: "통합환경 도급계약서(표준)",
    serviceType: "통합허가",
    serviceSubtypes: ["최초허가", "변경허가", "변경신고", "통합교육", "사후관리", "재검토"],
    spec: SPEC_A,
  },
  {
    templateId: "agt-std-haps-cover",
    name: "HAPs 갑지 계약서(표준)",
    serviceType: "HAPs",
    serviceSubtypes: ["HAPs", "HAPs최초", "HAPs변경", "HAPs연간", "시설구축", "명판부착", "배출저감", "정기점검대응"],
    spec: SPEC_B,
  },
];

/** 세분류의 코드 시드 폴백 — 없으면 null (기준 관리 화면 "미지정") */
export function seedForSubtype(serviceType: string, serviceSubtype: string): SeedTemplate | null {
  return (
    SEED_TEMPLATES.find((t) => t.serviceType === serviceType && t.serviceSubtypes.includes(serviceSubtype)) ?? null
  );
}

/** 시드를 템플릿 행 형태로 노출(목록·작성 화면 공용) */
export function seedAsTemplateRow(seed: SeedTemplate, serviceSubtype: string): AgreementTemplateRow {
  return {
    templateId: seed.templateId,
    name: seed.name,
    kind: "standard",
    serviceType: seed.serviceType,
    serviceSubtype,
    version: 0,
    status: "active",
    originFacilityId: null,
    originFacilityName: null,
    spec: seed.spec,
    sourceKind: null,
    sourceKey: null,
    analyzedAt: null,
    analyzeNote: null,
    createdAt: "",
    updatedAt: "",
    seeded: true,
  };
}
