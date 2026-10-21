/** 상단 검색 내용 검색 — 결과 종류와 화면 표기(클라이언트·서버 공용, DB 코드 없음). */
export type SearchKind = "mail" | "approval" | "people" | "contract" | "facility" | "todo";

export interface SearchResultItem {
  kind: SearchKind;
  id: string;
  title: string;
  /** 보조 줄(보낸 사람·문서번호·부서·거래처 등) */
  detail: string | null;
  href: string;
}

export const SEARCH_KIND_LABEL: Record<SearchKind, string> = {
  mail: "메일",
  approval: "결재 문서",
  people: "주소록",
  contract: "계약",
  facility: "사업장",
  todo: "할 일",
};
