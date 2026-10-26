/*
 * 실적 대외 표기 제안(catalog.project_label, 블루프린트 §6-4 백필) 대상 고르기·제안 검사 — 클라이언트 안전.
 * 규칙 표기(buildDisplayTitle)가 어색한 행만 LLM 에 보낸다: 직접 정한 표기가 있거나 검토를 마친 행, 통합허가 규칙 문안은 대상이 아니다.
 */
import { buildDisplayTitle, type CatalogProjectRow } from "@/lib/catalog/appendix";
import { DASHBOARD_SERVICE_CATEGORIES } from "@/lib/ieps/contract-categories";
import { findSuperlatives } from "./patch";

/** 규칙 표기가 어색한 이유(없으면 빈 목록) */
const AWKWARD: Array<[RegExp, string]> = [
  [/[[\]{}<>_#]/, "내부 표식 기호"],
  [/\s{2,}/, "공백 반복"],
  [/변경\s*계약|\(변경\)|재계약|추가\s*계약|연장\s*계약/, "변경·재계약 표기"],
  [/\d+\s*차\s*(분|년도|변경)?(\s|$|\))/, "차수 표기"],
  [/긴급|급건|가계약|내부|테스트|임시/, "내부 메모"],
  [/PJT|P\/O|NO\.|No\.|#\d/, "내부 코드"],
  [/주식회사|\(주\)|㈜.*㈜/, "회사 형태 표기"],
  [/용역\s*용역|업무\s*용역\s*용역/, "같은 말 반복"],
  [/^\s*\d{2,4}[-./]\d{1,2}/, "날짜로 시작"],
  [/\s(건|외\s*\d+\s*건)\s*$/, "건수 꼬리"],
];

export function awkwardReasons(row: CatalogProjectRow): string[] {
  if (row.meta?.displayTitle.trim() || row.meta?.reviewedAt) return [];
  // 통합허가는 현행 소개서 문안 형식의 규칙 표기라 대상이 아니다
  if (row.category === DASHBOARD_SERVICE_CATEGORIES[0]) return [];
  const title = buildDisplayTitle(row);
  const out = AWKWARD.filter(([re]) => re.test(title)).map(([, why]) => why);
  const len = title.replace(/\s+/g, "").length;
  if (len > 60) out.push("너무 김");
  if (len < 6) out.push("너무 짧음");
  return out;
}

/** 제안 검사 — 원래 글에 없던 숫자·최상급·길이·비공개 고객 이름 */
export function checkLabel(title: string, row: { contractTitle: string; party: string; site: string; anonymized: boolean; partyName?: string }): { title: string; issues: string[] } {
  const t = title.replace(/[\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  const issues: string[] = [];
  const source = `${row.contractTitle} ${row.party} ${row.site}`;
  const nums = (t.match(/\d+/g) ?? []).filter((d) => !source.includes(d));
  if (nums.length) issues.push(`원래 계약명에 없는 숫자(${nums.join(", ")})`);
  const sup = findSuperlatives(t);
  if (sup.length) issues.push(`과장 표현(${sup.join(", ")})`);
  if (t.replace(/\s+/g, "").length > 60) issues.push("60자 초과");
  if (row.anonymized && row.partyName && t.includes(row.partyName)) issues.push("비공개 고객 이름이 들어감");
  if (/준공|수행\s*중/.test(t)) issues.push("상태 표현은 부록이 붙입니다");
  return { title: t, issues };
}
