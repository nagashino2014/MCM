// 제안서 양식 4종 — 원본 4종(포스코·서부발전·중부발전 보령·수도권매립지)의 목차를 따른 공통 원고.
// 새 문서는 최신 공통 원고를 복사해 만든다. 저장된 원고는 원고를 고쳐도 자동으로 덮어쓰지 않는다.
import type { ProposalDocument, ProposalSection, ProposalTemplateId, ProposalTheme } from "./types";
import { generalSections } from "./content/general";
import { powerSections } from "./content/power";
import { inspectionSections } from "./content/inspection";
import { sustainabilitySections } from "./content/sustainability";
import { newId } from "./edit";
import { sectionHash } from "./hash";
import { validateProposalDocument } from "./validate";

export const PROPOSAL_TEMPLATES: ReadonlyArray<{ id: ProposalTemplateId; label: string; family: "permit" | "sustainability"; theme: ProposalTheme; description: string }> = [
  { id: "permit-general", label: "통합환경허가 · 일반 산업", family: "permit", theme: "navy", description: "공통 본문 36쪽. 복수 공장 현황 구분, 설비목록·수지·영향분석·BAT 작성 방법, 적용 예시, 품질·일정·사후관리까지." },
  { id: "permit-power", label: "통합환경허가 · 발전 신규·변경", family: "permit", theme: "ocean", description: "본문 35쪽. 복수 건설사업소의 신규·증설 허가를 독립 트랙으로. 계획서 8개 장 작성, 설계·건설·시운전과 허가 일정, 허가 이후 관리·보안까지." },
  { id: "permit-inspection", label: "통합환경허가 · 정기검사 대응", family: "permit", theme: "slate", description: "본문 34쪽. 요약본 5쪽 + 기존 허가 이행 진단. 서류·현장 진단, 법규 리스크 평가, 검사 입회, 변경 필요성 검토, 허가재검토·수준평가까지." },
  { id: "sustainability", label: "지속가능경영보고서 발간", family: "sustainability", theme: "forest", description: "본문 34쪽. 공시 동향·추진 전략, 수준진단·벤치마킹, 이해관계자·이중 중대성 평가, 지표·원고, 디자인·제3자 검증·ISO 26000, 사업관리·사후 지원." },
];

const TITLES: Record<ProposalTemplateId, { title: string; projectName: string; duration: string }> = {
  "permit-general": { title: "통합환경허가 용역 추진 제안서", projectName: "통합환경허가 대행 용역", duration: "착수일로부터 30개월" },
  "permit-power": { title: "통합환경허가 대행 용역 제안서", projectName: "건설사업소 통합환경허가 대행 용역", duration: "착수일로부터 36개월" },
  "permit-inspection": { title: "통합환경허가 정기검사 대응 용역 제안서", projectName: "통합환경허가 정기검사 대응 용역", duration: "착수일로부터 12개월" },
  sustainability: { title: "지속가능경영보고서 발간 용역 제안서", projectName: "지속가능경영보고서 발간 용역", duration: "착수일로부터 6개월" },
};

const SECTIONS: Record<ProposalTemplateId, () => ProposalSection[]> = {
  "permit-general": generalSections,
  "permit-power": powerSections,
  "permit-inspection": inspectionSections,
  sustainability: sustainabilitySections,
};

export function createProposalTemplate(templateId: ProposalTemplateId): ProposalDocument {
  const meta = PROPOSAL_TEMPLATES.find((t) => t.id === templateId) ?? PROPOSAL_TEMPLATES[0];
  const t = TITLES[meta.id];
  const doc: ProposalDocument = {
    schemaVersion: 2,
    id: newId("prp"),
    title: t.title,
    client: "발주기관",
    projectName: t.projectName,
    submissionDate: new Date().toISOString().slice(0, 10),
    templateId: meta.id,
    theme: meta.theme,
    layout: "paged",
    contentVersion: `${meta.id}-2.1`,
    variables: { siteName: "대상 사업장", duration: t.duration, companyName: "㈜한국환경안전연구원" },
    options: { cover: "modern", dividers: false, toc: true },
    sections: structuredClone(SECTIONS[meta.id]()),
  };
  // 저장 검증과 같은 모양(빈 단위 생략 등)으로 맞춘 뒤 쪽마다 원고 지문을 남긴다 — 나중에 새 원고와 비교할 때 사용자가 고친 쪽을 가른다.
  const checked = validateProposalDocument(doc);
  return { ...checked, sections: checked.sections.map((s) => ({ ...s, sourceHash: sectionHash(s) })) };
}
