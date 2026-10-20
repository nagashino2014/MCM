import type { ChangelogEntry } from "./types";

/**
 * 사용자에게 보이는 기능 변화 기록 — 최신이 위. 기능을 추가·변경하는 커밋은 여기에 한 줄을 남긴다.
 * articles 의 권한으로 노출을 거르므로, 관리자 전용 기능은 관리자 기사를 연결한다.
 */
export const MANUAL_CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-10-20",
    kind: "신규",
    title: "사용 매뉴얼과 ? 도움말",
    body: "상단 [매뉴얼] 버튼이나 F1 키로 지금 보고 있는 화면의 사용법을 볼 수 있습니다. 헷갈리기 쉬운 항목 옆에는 ? 버튼이 붙었습니다.",
    articles: ["start.manual"],
  },
  {
    date: "2026-10-20",
    kind: "신규",
    title: "부재·대결 설정과 전결",
    body: "출장·휴가로 자리를 비울 때 결재를 대결자에게 넘기거나 다음 결재자로 건너뛰게 할 수 있습니다.",
    articles: ["approval.absence"],
  },
];
