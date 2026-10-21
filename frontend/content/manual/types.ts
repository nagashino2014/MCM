/**
 * 사용 매뉴얼·? 도움말 데이터 모델 (docs/manual-help-blueprint.md §2.2).
 *
 * 문장 안 인라인 표기
 *  - [[버튼 이름]] : 화면에 보이는 버튼·라벨. 렌더 시 버튼 모양 글자로 그리고,
 *                    test:manual 이 sources 파일에 같은 문자열이 있는지 대조한다(화면 문구가 바뀌면 실패).
 *  - **강조**      : 굵게.
 *
 * ⚠ 화면·버튼·흐름을 바꾸는 커밋은 같은 커밋에서 해당 기사·도움말을 고치고 reviewedAt 을 갱신한다.
 */

export type ManualAudience = "staff" | "head" | "exec" | "admin";

export type ManualBlock =
  /** 문단 */
  | { kind: "p"; text: string }
  /** 번호 단계 */
  | { kind: "steps"; items: string[] }
  /** 글머리 목록 */
  | { kind: "list"; items: string[] }
  /** 팁 */
  | { kind: "tip"; text: string }
  /** 되돌릴 수 없는 동작·주의 */
  | { kind: "warn"; text: string }
  /** 표 */
  | { kind: "table"; head: string[]; rows: string[][] }
  /** "이 작업을 하면 → 어디에 반영" 연계 */
  | { kind: "flow"; items: { from: string; to: string }[] }
  /** 다른 기사 링크 */
  | { kind: "link"; article: string; section?: string; label?: string }
  /**
   * 화면 캡처 — src 는 public/ 기준 경로("/manual/shots/mail-list.webp").
   * 이름·금액·연락처는 가린 채로 찍는다(전 직원이 본다). 다시 찍는 절차: docs/manual-authoring-guide.md "화면 캡처".
   * 화면이 바뀌어 그림이 낡으면 같은 커밋에서 다시 찍거나 블록을 뺀다.
   */
  | { kind: "image"; src: string; alt: string; caption?: string };

export interface ManualSection {
  /** 기사 안에서 고유한 키(앵커). */
  id: string;
  title: string;
  blocks: ManualBlock[];
  /** 이 절만 보이는 데 필요한 권한키(하나라도). 생략 시 기사 기준. */
  requires?: readonly string[];
}

export interface ManualChapter {
  id: string;
  title: string;
  /** 사이드바 그룹과 같은 순서로 묶는다. */
  group: "start" | "home" | "collab" | "work" | "main" | "system" | "scenario" | "appendix";
}

export interface ManualArticle {
  /** 안정 키 — 메뉴 이름이 바뀌어도 유지한다(링크·도움말·변경 기록이 이 키를 참조). */
  id: string;
  chapter: string;
  title: string;
  /**
   * 이 기사가 설명하는 화면 경로. query 포함 가능("/finance?tab=vat").
   * 드로어는 현재 경로에 가장 구체적으로 맞는 기사를 연다. 시나리오처럼 화면이 없으면 빈 배열.
   * 기본은 하위 경로까지 포함, "*" 세그먼트는 아무 값(/todo/*), 끝의 "$" 는 정확히 그 경로만("/approval$").
   */
  routes: string[];
  /** 기사를 보는 데 필요한 권한키(하나라도). 생략 시 routes[0] 의 메뉴 권한표를 쓴다. 빈 배열 = 전원. */
  requires?: readonly string[];
  audience: ManualAudience[];
  /** "이 화면에서 할 수 있는 일" — 3~5줄. */
  summary: string[];
  sections: ManualSection[];
  /** 검색용 동의어. */
  keywords: string[];
  /** 이 기사가 설명하는 컴포넌트 파일(frontend/ 기준) — [[라벨]] 대조와 낡은 기사 보고에 쓴다. */
  sources: string[];
  /** 마지막으로 실제 화면과 대조한 날(YYYY-MM-DD). */
  reviewedAt: string;
}

export interface HelpTopic {
  id: string;
  /** ? 버튼의 접근성 이름 겸 팝업 제목("전자발행 도움말"). */
  label: string;
  blocks: ManualBlock[];
  /** "매뉴얼에서 자세히" 링크 대상. */
  more?: { article: string; section?: string };
  /** 이 도움말이 설명하는 컴포넌트 파일(frontend/ 기준). 첫 파일에 topic="id" 가 있어야 한다. */
  sources: string[];
  reviewedAt: string;
}

export interface ChangelogEntry {
  date: string;
  kind: "신규" | "개선" | "변경" | "수정";
  title: string;
  body?: string;
  /** 관련 기사 — 권한 필터에 그대로 쓴다(볼 수 없는 기능 소식은 숨김). 비면 전원. */
  articles: string[];
}
