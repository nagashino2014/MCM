/**
 * 홍보·채용공고 — 템플릿/공고의 공통 데이터 모델.
 *
 * 클로드 디자인 핸드오프(.dc.html)를 파싱해 만든 "노드트리"가 디자인이자 콘텐츠다.
 * - 템플릿.design_tree: 업로드 시 파싱·정제된 원본 트리
 * - 공고.content_tree: 템플릿 트리의 사본이 편집으로 진화한 것
 * 렌더링은 React 가 이 트리를 그린다(innerHTML 미사용 → 업로드 HTML 의 스크립트가 실행될 수 없다).
 */

export interface DocNode {
  /** 트리 내 고유 id — 편집 조작(텍스트 수정·항목 추가/삭제/이동)의 대상 지정용. */
  id: string;
  /** 화이트리스트 태그. 텍스트 노드는 "#text". */
  tag: string;
  /** 인라인 스타일(camelCase). sanitize 화이트리스트 통과분만 저장. */
  style?: Record<string, string>;
  /** tag === "#text" 일 때의 텍스트 원문. */
  text?: string;
  children?: DocNode[];
  /** a 태그 전용 — http(s) URL 만 허용. */
  href?: string;
  /**
   * 반복 그룹 id. 같은 부모 아래 동일 repeatGroup 을 가진 형제들이
   * "추가/삭제/순서변경 가능한 리스트 항목"으로 취급된다(파서가 구조 유사도로 자동 감지).
   */
  repeatGroup?: string;
  /** 반복 항목 사이 구분자(예: 전형절차의 "→"). 항목과 함께 복제·삭제된다. */
  separator?: boolean;
}

/** 템플릿·공고가 공유하는 테마 상태. 핸드오프의 data-props 에서 추출. */
export interface DocTheme {
  /** 액센트 컬러(hex). --accent/--accent-deep/--accent-soft 가 이 값에서 파생된다. */
  accentColor?: string;
  /** 핸드오프가 제안한 팔레트(스와치로 노출). */
  accentOptions?: string[];
  /** 섹션 세로 패딩 축소 토글(--secpad 52px → 34px). */
  compact?: boolean;
  /** helmet <style> :root 에서 추출한 CSS 변수 기본값(파생 대상이 아닌 변수의 폴백). */
  cssVars?: Record<string, string>;
  /** 문서 바깥 데스크 배경색. */
  deskColor?: string;
}

/** 핸드오프 패키지 파싱 결과(클라이언트 parse.ts 산출물 = 템플릿 등록 페이로드). */
export interface ParsedTemplate {
  tree: DocNode;
  theme: DocTheme;
  /** 문서 고정 폭(px). 루트 노드 width 에서 추출, 기본 900. */
  docWidth: number;
  /** 편집 가능 텍스트 필드 수 / 감지된 반복 그룹 수 — 업로드 미리보기 요약용. */
  stats: { textCount: number; groupCount: number };
}

export interface RecruitTemplateRow {
  templateId: string;
  name: string;
  description: string | null;
  designTree: DocNode;
  theme: DocTheme;
  docWidth: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecruitPostingRow {
  postingId: string;
  templateId: string;
  templateName?: string;
  title: string;
  contentTree: DocNode;
  theme: DocTheme;
  docWidth?: number;
  status: "draft" | "final";
  createdAt: string;
  updatedAt: string;
  updatedBy?: string | null;
}
